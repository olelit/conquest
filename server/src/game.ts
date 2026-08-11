import { chooseAiAction, type AiAction } from './ai.js';
import { verifyGoogleIdToken, type GoogleProfile } from './auth.js';
import { config } from './config.js';
import { gameRepository, hexesRepository, playersRepository } from './db.js';
import * as rules from './rules.js';
import type { GameState, HexState } from './rules.js';

export type Phase = 'menu' | 'waiting' | 'game';
export type Mode = 'ai' | 'human';

export interface ServerGameState {
  phase: Phase;
  mode: Mode;
  players: { id: number; name: string; points: number; hexCount: number; income: number; isAi: boolean }[];
  winnerId: number | null;
  paused: boolean;
  captureTicks: number;
  log: string[];
  hexes: HexState[];
}

interface ActionMessage {
  type: string;
  q: number;
  r: number;
  points?: number;
  army?: number;
}

type ActionResult = { type: 'state'; game: ServerGameState } | { type: 'error'; message: string };

export class GameService {
  readonly humanId: number;
  readonly aiId: number;
  private state: GameState;
  private phase: Phase = 'menu';
  private mode: Mode = 'ai';
  private paused = false;
  private log: string[] = [];
  private slotPlayers = new Map<number, number>();
  private waitingConnId: number | null = null;
  private connections = new Set<number>();
  private authProfiles = new Map<number, GoogleProfile>();

  private constructor(humanId: number, aiId: number, state: GameState) {
    this.humanId = humanId;
    this.aiId = aiId;
    this.state = state;
  }

  static async create(): Promise<GameService> {
    await gameRepository.migrate();
    await hexesRepository.ensureMines();
    const state = await gameRepository.load();
    if (state.players.length < 2) {
      throw new Error('players table must contain at least two players');
    }
    const [p1, p2] = state.players;
    for (const p of state.players) {
      if (!p.name || p.name === 'player' || p.name === 'ai') {
        p.name = randomCountryName();
        await playersRepository.updateName(p.id, p.name);
      }
    }
    const service = new GameService(p1.id, p2.id, state);
    service.resetState();
    return service;
  }

  getState(): ServerGameState {
    const players = this.state.players.map((p) => {
      const meta = this.playerMeta(p.id);
      const count = rules.hexCount(this.state, p.id);
      return {
        id: p.id,
        name: meta.name,
        points: p.points,
        hexCount: count,
        income: rules.playerIncome(this.state, p.id),
        isAi: meta.isAi,
      };
    });
    return {
      phase: this.phase,
      mode: this.mode,
      players,
      winnerId: this.state.winnerId,
      paused: this.paused,
      captureTicks: rules.CAPTURE_TICKS,
      log: this.log,
      hexes: this.state.hexes,
    };
  }

  viewerPlayerId(connId: number): number | null {
    if (this.phase !== 'game') return null;
    if (this.mode === 'ai') return this.humanId;
    return this.slotPlayers.get(connId) ?? null;
  }

  actionPlayerId(connId: number): number | null {
    return this.viewerPlayerId(connId);
  }

  authProfileFor(connId: number): GoogleProfile | null {
    return this.authProfiles.get(connId) ?? null;
  }

  async handleAuth(connId: number, token: string): Promise<{ ok: boolean; error?: string }> {
    const clientId = config.googleClientId;
    if (!clientId) {
      return { ok: false, error: 'Google-вход не настроен на сервере' };
    }
    if (!token) {
      return { ok: false, error: 'Пустой токен' };
    }
    try {
      const profile = await verifyGoogleIdToken(token, clientId);
      if (!profile) {
        return { ok: false, error: 'Не удалось проверить токен Google' };
      }
      this.authProfiles.set(connId, profile);
      await this.applyProfileToSlot(connId);
      return { ok: true };
    } catch (err) {
      console.error('google auth failed:', err);
      return { ok: false, error: 'Ошибка проверки токена' };
    }
  }

  isWaiter(connId: number): boolean {
    return this.phase === 'waiting' && this.waitingConnId === connId;
  }

  async connectionOpened(connId: number): Promise<void> {
    this.connections.add(connId);
    if (this.phase === 'waiting') {
      await this.startHumanGame(connId);
    } else if (this.phase === 'game' && this.mode === 'ai') {
      await this.convertToHuman(connId);
    }
  }

  async startVsAi(): Promise<void> {
    await this.configurePlayers([false, true]);
    this.mode = 'ai';
    this.phase = 'game';
    this.paused = false;
  }

  async requestVsHuman(connId: number): Promise<{ status: 'waiting' } | { status: 'started'; playerId: number }> {
    if (this.phase === 'waiting') {
      if (this.waitingConnId === connId || this.waitingConnId === null) {
        return this.becomeWaiter(connId);
      }
      const started = await this.startHumanGame(connId);
      return started ? { status: 'started', playerId: started.playerId } : { status: 'waiting' };
    }
    if (this.phase === 'game' && this.mode === 'human') {
      const existing = this.slotPlayers.get(connId);
      if (existing !== undefined) return { status: 'started', playerId: existing };
      return this.becomeWaiter(connId);
    }
    return this.becomeWaiter(connId);
  }

  async cancelWaiting(connId: number): Promise<void> {
    if (this.phase === 'waiting' && this.waitingConnId === connId) {
      this.phase = 'menu';
      this.waitingConnId = null;
      this.slotPlayers.delete(connId);
    }
  }

  async connectionClosed(connId: number): Promise<void> {
    await this.cancelWaiting(connId);
    this.slotPlayers.delete(connId);
    this.connections.delete(connId);
    this.authProfiles.delete(connId);
    if (this.phase === 'game' && this.mode === 'human' && this.slotPlayers.size === 0) {
      this.phase = 'menu';
      this.paused = false;
    }
  }

  async toMenu(): Promise<void> {
    this.phase = 'menu';
    this.waitingConnId = null;
    this.slotPlayers.clear();
    this.paused = false;
    await gameRepository.persist(this.state);
  }

  async handleAction(msg: ActionMessage, playerId: number | null): Promise<ActionResult> {
    if (msg.type === 'menu') {
      await this.toMenu();
    } else if (msg.type === 'pause') {
      if (this.phase === 'game') this.paused = !this.paused;
    } else {
      if (playerId === null) {
        return { type: 'error', message: 'Игра не активна для вас' };
      }
      if (typeof msg.q !== 'number' || typeof msg.r !== 'number') {
        return { type: 'error', message: 'Некорректные координаты' };
      }
      let validation: rules.ActionValidation;
      switch (msg.type) {
        case 'capture': {
          validation = rules.validateCapture(this.state, playerId, msg.q, msg.r, Math.max(0, Math.floor(Number(msg.army) || 0)));
          if (!validation.ok) return { type: 'error', message: validation.error };
          const hex = rules.findHex(this.state, msg.q, msg.r)!;
          const cost = rules.hexCount(this.state, playerId) === 0 ? 0 : rules.terrainCost(hex.terrain);
          rules.applyCapture(this.state, playerId, msg.q, msg.r);
          this.addLog(`${this.playerMeta(playerId).name} захватил (${msg.q}, ${msg.r}) за ${cost} очков`);
          break;
        }
        case 'attack':
          validation = rules.validateAttack(this.state, playerId, msg.q, msg.r, Number(msg.points));
          if (!validation.ok) return { type: 'error', message: validation.error };
          rules.applyAttack(this.state, playerId, msg.q, msg.r, Number(msg.points));
          this.addLog(`${this.playerMeta(playerId).name} вложил ${Number(msg.points)} очков в атаку на (${msg.q}, ${msg.r})`);
          break;
        case 'defend':
          validation = rules.validateDefend(this.state, playerId, msg.q, msg.r, Number(msg.points));
          if (!validation.ok) return { type: 'error', message: validation.error };
          rules.applyDefend(this.state, playerId, msg.q, msg.r, Number(msg.points));
          this.addLog(`${this.playerMeta(playerId).name} защищает (${msg.q}, ${msg.r}): +${Number(msg.points)}`);
          break;
        default:
          return { type: 'error', message: `Неизвестный тип сообщения: ${msg.type}` };
      }
    }
    try {
      await gameRepository.persist(this.state);
    } catch (err) {
      console.error('persist failed after action:', err);
      return { type: 'error', message: 'Не удалось сохранить состояние' };
    }
    return { type: 'state', game: this.getState() };
  }

  private async becomeWaiter(connId: number): Promise<{ status: 'waiting' }> {
    this.phase = 'waiting';
    this.waitingConnId = connId;
    this.slotPlayers.set(connId, this.state.players[0].id);
    await this.applyProfileToSlot(connId);
    return { status: 'waiting' };
  }

  private async startHumanGame(secondConnId: number): Promise<{ playerId: number } | null> {
    const firstConnId = this.waitingConnId;
    if (firstConnId === null || firstConnId === secondConnId) return null;
    await this.configurePlayers([false, false]);
    this.mode = 'human';
    this.phase = 'game';
    this.paused = false;
    const firstPlayerId = this.slotPlayers.get(firstConnId) ?? this.state.players[0].id;
    const secondPlayerId = this.state.players.find((p) => p.id !== firstPlayerId)!.id;
    this.slotPlayers.set(secondConnId, secondPlayerId);
    this.waitingConnId = null;
    await this.applyProfileToSlot(secondConnId);
    return { playerId: secondPlayerId };
  }

  private async convertToHuman(connId: number): Promise<void> {
    const [p1, p2] = this.state.players;
    await playersRepository.updateAiFlags(p1.id, false, p2.id, false);
    p1.isAi = false;
    p2.isAi = false;
    this.mode = 'human';
    for (const existing of this.connections) {
      if (existing !== connId && !this.slotPlayers.has(existing)) {
        this.slotPlayers.set(existing, p1.id);
      }
    }
    this.slotPlayers.set(connId, p2.id);
    this.addLog(`${this.playerMeta(p2.id).name} присоединился к игре — ИИ покинул поле боя`);
    await this.applyProfileToSlot(connId);
    for (const existing of this.connections) {
      if (existing !== connId) await this.applyProfileToSlot(existing);
    }
    await gameRepository.persist(this.state);
  }

  private async applyProfileToSlot(connId: number): Promise<void> {
    const profile = this.authProfiles.get(connId);
    const playerId = this.viewerPlayerId(connId);
    if (!profile || playerId === null) return;
    const player = this.state.players.find((p) => p.id === playerId);
    if (!player) return;
    player.name = profile.name;
    await playersRepository.updateName(player.id, profile.name);
  }

  private async configurePlayers(isAi: [boolean, boolean]): Promise<void> {
    const [p1, p2] = this.state.players;
    await playersRepository.updateAiFlags(p1.id, isAi[0], p2.id, isAi[1]);
    p1.isAi = isAi[0];
    p2.isAi = isAi[1];
    const names = [randomCountryName(), randomCountryName()];
    if (names[1] === names[0]) names[1] += ' 2';
    for (let i = 0; i < this.state.players.length; i++) {
      this.state.players[i].name = names[i];
      await playersRepository.updateName(this.state.players[i].id, names[i]);
    }
    this.resetState();
  }

  private resetState(): void {
    for (const player of this.state.players) {
      player.points = rules.BASE_POINTS;
    }
    for (const hex of this.state.hexes) {
      hex.ownerId = null;
      hex.attackerId = null;
      hex.defenderId = null;
      hex.attackInvestment = 0;
      hex.defenseInvestment = 0;
      hex.battleProgress = 0;
    }
    this.state.winnerId = null;
    this.log = [];
    this.addLog('Новая игра началась');
  }

  async tick(): Promise<void> {
    if (this.phase !== 'game' || this.paused) return;
    if (this.state.winnerId === null) {
      rules.applyIncome(this.state);
      const results = rules.tickBattles(this.state);
      for (const result of results) {
        if (result.winnerId === null) {
          this.addLog(`Битва за (${result.q}, ${result.r}) окончена — ничья`);
        } else {
          this.addLog(`Битва за (${result.q}, ${result.r}) окончена — победил ${this.playerMeta(result.winnerId).name}`);
        }
      }
      const claims = rules.applyEnclosure(this.state);
      for (const claim of claims) {
        this.addLog(`${this.playerMeta(claim.ownerId).name} окружил и захватил ${claim.hexes.length} клеток`);
      }
      if (this.mode === 'ai') {
        const aiAction = chooseAiAction(this.state, this.aiId);
        if (aiAction) {
          this.applyAiAction(aiAction);
        }
      }
      rules.computeWinner(this.state);
    }
    try {
      await gameRepository.persist(this.state);
    } catch (err) {
      console.error('persist failed in tick:', err);
    }
  }

  private applyAiAction(action: AiAction): void {
    const name = this.playerMeta(this.aiId).name;
    switch (action.type) {
      case 'capture':
        if (rules.validateCapture(this.state, this.aiId, action.q, action.r).ok) {
          const hex = rules.findHex(this.state, action.q, action.r)!;
          const cost = rules.hexCount(this.state, this.aiId) === 0 ? 0 : rules.terrainCost(hex.terrain);
          rules.applyCapture(this.state, this.aiId, action.q, action.r);
          this.addLog(`${name} захватил (${action.q}, ${action.r}) за ${cost} очков`);
        }
        break;
      case 'attack':
        if (rules.validateAttack(this.state, this.aiId, action.q, action.r, action.points).ok) {
          rules.applyAttack(this.state, this.aiId, action.q, action.r, action.points);
          this.addLog(`${name} вложил ${action.points} очков в атаку на (${action.q}, ${action.r})`);
        }
        break;
      case 'defend':
        if (rules.validateDefend(this.state, this.aiId, action.q, action.r, action.points).ok) {
          rules.applyDefend(this.state, this.aiId, action.q, action.r, action.points);
          this.addLog(`${name} защищает (${action.q}, ${action.r}): +${action.points}`);
        }
        break;
    }
  }

  private playerMeta(id: number): { name: string; isAi: boolean } {
    const player = this.state.players.find((p) => p.id === id);
    if (!player) return { name: 'Игрок', isAi: false };
    const isAi = this.mode === 'ai' && player.isAi === true;
    return { name: player.name ?? 'Игрок', isAi };
  }

  private addLog(message: string): void {
    this.log.unshift(message);
    if (this.log.length > 100) this.log.pop();
  }
}

const COUNTRY_PREFIXES = [
  'Рейш', 'Аван', 'Вельд', 'Гросс', 'Карт', 'Торв', 'Эльд', 'Морх', 'Силв', 'Брейн',
  'Ост', 'Драг', 'Кэл', 'Верд', 'Норд', 'Зарт', 'Квир', 'Хальт', 'Дорн', 'Фаст',
];
const COUNTRY_SUFFIXES = [
  'олия', 'столь', 'ландия', 'марк', 'ния', 'вия', 'гон', 'дер', 'стия', 'альд',
  'мор', 'тия', 'вальд', 'гания',
];

function randomCountryName(): string {
  const prefix = COUNTRY_PREFIXES[Math.floor(Math.random() * COUNTRY_PREFIXES.length)];
  const suffix = COUNTRY_SUFFIXES[Math.floor(Math.random() * COUNTRY_SUFFIXES.length)];
  return prefix + suffix;
}
