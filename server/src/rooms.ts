import { MAP_PRESETS, generateMap, type MapType } from './map.js';
import * as rules from './rules.js';
import type { GameState, HexState, PlayerState } from './rules.js';
import { chooseAiAction, type AiAction } from './ai.js';
import type { GoogleProfile } from './auth.js';
import { verifyGoogleIdToken } from './auth.js';
import { config, type Difficulty } from './config.js';
import { GameStatsRecorder } from './stats.js';

export type RoomStatus = 'waiting' | 'playing';

export interface RoomSlot {
  id: number;
  name: string;
  isAi: boolean;
  connId: number | null;
  disconnected: boolean;
}

export interface ViewPlayer {
  id: number;
  name: string;
  points: number | null;
  hexCount: number;
  income: number | null;
  limit: number | null;
  isAi: boolean;
  capital: { q: number; r: number } | null;
  eliminated: boolean;
  relation: 'self' | 'ally' | 'enemy';
}

export interface ViewGame {
  players: ViewPlayer[];
  hexes: HexState[];
  winnerId: number | null;
  captureTicks: number;
  pendingProposals: { from: number; kind: 'peace' | 'alliance' }[];
}

export interface RoomView {
  id: number;
  name: string;
  mapType: MapType;
  maxPlayers: number;
  status: RoomStatus;
  aiMode: boolean;
  hostPlayerId: number | null;
  slots: { id: number; name: string; isAi: boolean }[];
  paused: boolean;
  game: ViewGame | null;
  log: string[];
}

export type ActionResult = { type: 'state' } | { type: 'error'; message: string };

export interface RoomLobbyInfo {
  id: number;
  name: string;
  mapType: MapType;
  maxPlayers: number;
  humans: number;
}

export class Room {
  status: RoomStatus = 'waiting';
  hostPlayerId: number | null = null;
  paused = false;
  finishedAt: number | null = null;

  private slots: RoomSlot[] = [];
  private connToSlot = new Map<number, number>();
  private state: GameState | null = null;
  private log: string[] = [];
  private eliminationSpawned = new Set<number>();
  private aiLastActionAt = new Map<number, number>();
  private lastCapturerId: number | null = null;
  private pendingProposals: { from: number; to: number; kind: 'peace' | 'alliance' }[] = [];
  private scoutCache: { hexCount: number; points: number; updatedAt: number } | null = null;
  private peaceCooldowns = new Map<string, number>();

  readonly stats: GameStatsRecorder;
  private statsWritten = false;
  private tickCounter = 0;
  private startedAt = 0;
  private attackStartedAt = new Map<string, number>();

  constructor(
    readonly id: number,
    readonly name: string,
    readonly mapType: MapType,
    readonly maxPlayers: number,
    readonly aiMode: boolean,
    private readonly aiCount: number,
    private readonly rng: () => number = Math.random,
    readonly difficulty: Difficulty = 'medium',
  ) {
    this.stats = new GameStatsRecorder(this.id);
  }

  get gameState(): GameState | null {
    return this.state;
  }

  get slotsCount(): number {
    return this.slots.length;
  }

  get humanCount(): number {
    return this.slots.filter((s) => !s.isAi).length;
  }

  get isEmpty(): boolean {
    return this.slots.length === 0;
  }

  addHuman(name: string, connId: number): number | null {
    if (this.status !== 'waiting' || this.slots.length >= this.maxPlayers) return null;
    const id = this.nextSlotId();
    this.slots.push({ id, name, isAi: false, connId, disconnected: false });
    this.connToSlot.set(connId, id);
    if (this.hostPlayerId === null) this.hostPlayerId = id;
    this.addLog(`${name} присоединился к комнате`);
    return id;
  }

  slotForConn(connId: number): number | null {
    return this.connToSlot.get(connId) ?? null;
  }

  removeHuman(connId: number): void {
    const id = this.connToSlot.get(connId);
    if (id === undefined) return;
    this.connToSlot.delete(connId);
    const slot = this.slots.find((s) => s.id === id);
    if (!slot) return;
    this.addLog(`${slot.name} вышел из комнаты`);
    this.slots = this.slots.filter((s) => s.id !== id);
    if (this.hostPlayerId === id) {
      const next = this.slots.find((s) => !s.isAi);
      this.hostPlayerId = next ? next.id : null;
    }
  }

  start(connId: number): { ok: true } | { ok: false; error: string } {
    if (this.status !== 'waiting') return { ok: false, error: 'Игра уже началась' };
    if (this.hostPlayerId === null) return { ok: false, error: 'Нет хозяина' };
    if (this.slotForConn(connId) !== this.hostPlayerId) {
      return { ok: false, error: 'Только хозяин может начать игру' };
    }
    const aiToAdd = this.aiMode ? this.aiCount : this.maxPlayers - this.slots.length;
    const usedNames = new Set(this.slots.map((s) => s.name));
    for (let i = 0; i < aiToAdd; i++) {
      this.slots.push({
        id: this.nextSlotId(),
        name: uniqueCountryName(usedNames),
        isAi: true,
        connId: null,
        disconnected: false,
      });
    }
    const players = this.buildPlayers();
    const hexes = this.buildHexes();
    const preset = MAP_PRESETS[this.mapType];
    this.state = { players, hexes, columns: preset.columns, rows: preset.rows, winnerId: null, qOffset: preset.qOffset };
    this.state.diplomacy = new Map();
    this.pendingProposals = [];
    this.status = 'playing';
    this.paused = false;
    this.lastCapturerId = null;
    this.addLog('Новая игра началась');
    this.startedAt = Date.now();
    this.statsWritten = false;
    this.tickCounter = 0;
    this.stats.record({
      type: 'start',
      t: this.startedAt,
      mapType: this.mapType,
      players: players.map((p) => ({
        id: p.id,
        name: p.name ?? `Игрок ${p.id}`,
        isAi: p.isAi ?? false,
        incomeMultiplier: p.incomeMultiplier ?? 1,
      })),
    });
    return { ok: true };
  }

  private buildPlayers(): PlayerState[] {
    return this.slots.map((s) => ({
      id: s.id,
      name: s.name,
      points: rules.BASE_POINTS,
      isAi: s.isAi,
      ...(s.isAi ? { incomeMultiplier: config.aiIncomeMultipliers[this.difficulty] } : {}),
    }));
  }

  private buildHexes(): HexState[] {
    return generateMap(this.mapType).map((h) => ({
      q: h.q,
      r: h.r,
      terrain: h.terrain,
      ownerId: null,
      attackerId: null,
      defenderId: null,
      attackInvestment: 0,
      defenseInvestment: 0,
      battleProgress: 0,
      fortress: false,
    }));
  }

  restart(): { ok: true } | { ok: false; error: string } {
    if (!this.aiMode) return { ok: false, error: 'Перезапуск доступен только в игре с компьютером' };
    if (this.status !== 'playing' || !this.state) return { ok: false, error: 'Игра ещё не началась' };
    this.slots = this.slots.filter((s) => !this.eliminationSpawned.has(s.id));
    const players = this.buildPlayers();
    const preset = MAP_PRESETS[this.mapType];
    this.state = { players, hexes: this.buildHexes(), columns: preset.columns, rows: preset.rows, winnerId: null, qOffset: preset.qOffset };
    this.state.diplomacy = new Map();
    this.pendingProposals = [];
    this.scoutCache = null;
    this.peaceCooldowns.clear();
    this.paused = false;
    this.finishedAt = null;
    this.aiLastActionAt.clear();
    this.log = [];
    this.eliminationSpawned.clear();
    this.lastCapturerId = null;
    this.stats.clear();
    this.startedAt = Date.now();
    this.statsWritten = false;
    this.tickCounter = 0;
    this.stats.record({
      type: 'start',
      t: this.startedAt,
      mapType: this.mapType,
      players: players.map((p) => ({
        id: p.id,
        name: p.name ?? `Игрок ${p.id}`,
        isAi: p.isAi ?? false,
        incomeMultiplier: p.incomeMultiplier ?? 1,
      })),
    });
    this.addLog('Игра перезапущена');
    return { ok: true };
  }

  tick(): void {
    if (this.status !== 'playing' || this.paused) return;
    const state = this.state;
    if (!state) return;
    if (state.winnerId !== null) {
      if (this.finishedAt === null) {
        this.finishedAt = Date.now();
        this.stats.record({ type: 'end', t: this.finishedAt, winnerId: state.winnerId, durationMs: this.finishedAt - this.startedAt });
        this.writeStatsIfNeeded();
      }
      return;
    }
    rules.applyIncome(state);
    this.tickCounter++;
    if (this.tickCounter % 10 === 0) {
      this.stats.record({
        type: 'snapshot',
        t: Date.now(),
        players: state.players.map((p) => ({ id: p.id, hexCount: rules.hexCount(state, p.id), points: p.points })),
      });
    }
    const results = rules.tickBattles(state);
    for (const result of results) {
      this.stats.record({ type: 'battle', t: Date.now(), q: result.q, r: result.r, winnerId: result.winnerId });
      this.attackStartedAt.delete(`${result.q},${result.r}`);
      if (result.winnerId === null) {
        this.addLog(`Битва за (${result.q}, ${result.r}) окончена — ничья`);
      } else {
        this.addLog(`Битва за (${result.q}, ${result.r}) окончена — победил ${this.playerName(result.winnerId)}`);
      }
    }
    for (const result of results) {
      if (result.loserId !== undefined) this.handlePlayerLoss(result.loserId);
    }
    for (const result of results) {
      if (result.loserId === undefined || result.winnerId === null) continue;
      const loser = state.players.find((p) => p.id === result.loserId);
      if (loser?.capital && loser.capital.q === result.q && loser.capital.r === result.r) {
        this.lastCapturerId = result.winnerId;
      }
    }
    const claims = rules.applyEnclosure(state);
    for (const claim of claims) {
      this.addLog(`${this.playerName(claim.ownerId)} окружил и захватил ${claim.hexes.length} клеток`);
    }
    for (const claim of claims) {
      if (claim.prevOwnerId !== null) this.handlePlayerLoss(claim.prevOwnerId);
    }
    for (const player of state.players) {
      if (!player.eliminated) continue;
      for (const hex of state.hexes) {
        if (hex.ownerId === player.id) {
          hex.ownerId = null;
          hex.fortress = false;
        }
      }
    }
    if (
      state.winnerId === null &&
      this.lastCapturerId !== null &&
      state.players.every((p) => p.eliminated)
    ) {
      state.winnerId = this.lastCapturerId;
    }
    for (const hex of state.hexes) {
      if (hex.attackerId === null && hex.defenderId === null) {
        this.attackStartedAt.delete(`${hex.q},${hex.r}`);
      }
    }
    const now = Date.now();
    for (const [key, started] of this.attackStartedAt) {
      if (now - started >= 30000) this.attackStartedAt.delete(key);
    }
    this.updateScoutCache(state);
    for (const aiPlayer of state.players) {
      if (!aiPlayer.isAi || aiPlayer.eliminated) continue;
      const incoming = this.pendingProposals.filter((p) => p.to === aiPlayer.id);
      for (const proposal of incoming) {
        this.pendingProposals.splice(this.pendingProposals.indexOf(proposal), 1);
        const proposer = state.players.find((p) => p.id === proposal.from);
        if (!proposer || proposer.eliminated) continue;
        if (this.aiAcceptsProposal(state, aiPlayer.id, proposal.from)) {
          if (proposal.kind === 'peace') {
            rules.makePeace(state, aiPlayer.id, proposal.from);
            this.peaceCooldowns.set(`${aiPlayer.id}-${proposal.from}`, Date.now() + 60000);
          } else {
            rules.makeAlliance(state, aiPlayer.id, proposal.from);
          }
          this.addLog(`${this.playerName(aiPlayer.id)} и ${this.playerName(proposal.from)} заключили ${proposal.kind === 'peace' ? 'мир' : 'союз'}`);
        } else {
          this.addLog(`${this.playerName(aiPlayer.id)} отклонил предложение ${this.playerName(proposal.from)}`);
        }
      }
    }
    for (const player of state.players) {
      if (!player.isAi || player.eliminated) continue;
      this.maybeDeclareWar(state, player.id);
      const last = this.aiLastActionAt.get(player.id) ?? 0;
      if (now - last < config.aiActionIntervalMs) continue;
      const action = chooseAiAction(state, player.id);
      if (action) {
        this.aiLastActionAt.set(player.id, now);
        this.applyAiAction(player.id, action);
      }
    }
    rules.computeWinner(state);
  }

  private aiAcceptsProposal(state: GameState, aiId: number, proposerId: number): boolean {
    const proposer = state.players.find((p) => p.id === proposerId);
    if (!proposer || proposer.eliminated) return false;
    const proposerHexes = rules.hexCount(state, proposerId);
    const aiHexes = rules.hexCount(state, aiId);
    const atWar = state.players.some((p) => p.id !== aiId && rules.relation(state, aiId, p.id) === 'war');
    return proposerHexes >= aiHexes * 0.8 || atWar;
  }

  private updateScoutCache(state: GameState): void {
    const now = Date.now();
    if (this.scoutCache !== null && now - this.scoutCache.updatedAt < 30000) return;
    const human = state.players.find((p) => !p.isAi && !p.eliminated);
    if (!human) {
      this.scoutCache = null;
      return;
    }
    this.scoutCache = { hexCount: rules.hexCount(state, human.id), points: human.points, updatedAt: now };
  }

  private maybeDeclareWar(state: GameState, aiId: number): void {
    const sideStrength = (id: number) => {
      const side = [id, ...rules.alliesOf(state, id)];
      return {
        hexes: side.reduce((sum, pid) => sum + rules.hexCount(state, pid), 0),
        points: side.reduce((sum, pid) => sum + (state.players.find((p) => p.id === pid)?.points ?? 0), 0),
      };
    };
    const aiSide = sideStrength(aiId);
    for (const target of state.players) {
      if (target.id === aiId || target.eliminated) continue;
      const rel = rules.relation(state, aiId, target.id);
      if (rel === 'war' || rel === 'alliance') continue;
      const cooldownUntil = this.peaceCooldowns.get(`${aiId}-${target.id}`);
      if (cooldownUntil !== undefined && Date.now() < cooldownUntil) continue;
      const targetSide = target.isAi ? sideStrength(target.id) : { hexes: this.scoutCache?.hexCount ?? 0, points: this.scoutCache?.points ?? 0 };
      if (aiSide.hexes > targetSide.hexes || aiSide.points > targetSide.points) {
        rules.declareWar(state, aiId, target.id);
        this.addLog(`${this.playerName(aiId)} объявил войну ${this.playerName(target.id)}`);
      }
    }
  }

  private handlePlayerLoss(playerId: number): void {
    const state = this.state!;
    const elim = rules.eliminateIfCapitalLost(state, playerId, this.rng);
    if (elim) {
      this.pendingProposals = this.pendingProposals.filter((p) => p.from !== elim.eliminatedId && p.to !== elim.eliminatedId);
      for (const [key] of this.peaceCooldowns) {
        if (key.startsWith(`${elim.eliminatedId}-`) || key.endsWith(`-${elim.eliminatedId}`)) {
          this.peaceCooldowns.delete(key);
        }
      }
      this.addLog(`${this.playerName(elim.eliminatedId)} потерял столицу и выбыл из игры`);
      if (elim.neutralHexes.length > 0) {
        this.addLog(`Территория ${this.playerName(elim.eliminatedId)} стала нейтральной`);
      }
      if (elim.newAis.length > 0) {
        const usedNames = new Set(this.slots.map((s) => s.name));
        const names: string[] = [];
        for (const ai of elim.newAis) {
          const name = uniqueCountryName(usedNames);
          names.push(name);
          state.players.push({
            id: ai.id,
            name,
            points: rules.BASE_POINTS,
            isAi: true,
            incomeMultiplier: config.aiIncomeMultipliers[this.difficulty],
            capital: { q: ai.hexes[0].q, r: ai.hexes[0].r },
          });
          this.slots.push({ id: ai.id, name, isAi: true, connId: null, disconnected: false });
          this.eliminationSpawned.add(ai.id);
        }
        this.addLog(`Территория ${this.playerName(elim.eliminatedId)} разделена между: ${names.join(', ')}`);
      }
      if (this.aiMode) {
        const human = this.slots.find((s) => s.connId !== null);
        if (human?.id === elim.eliminatedId && elim.capturerId !== null) {
          state.winnerId = elim.capturerId;
        }
      }
      if (elim.capturerId !== null) this.lastCapturerId = elim.capturerId;
    } else {
      const cut = rules.applyCut(state, playerId);
      if (cut.length > 0) {
        this.addLog(`${this.playerName(playerId)} отрезан: ${cut.length} клеток стали нейтральными`);
      }
    }
  }

  handleAction(connId: number, type: string, msg: { q?: number; r?: number; points?: number; army?: number; kind?: string; accept?: boolean }): ActionResult {
    const playerId = this.slotForConn(connId);
    if (type === 'pause') {
      if (!this.aiMode) return { type: 'error', message: 'В игре с людьми пауза недоступна' };
      if (this.status === 'playing') this.paused = !this.paused;
      return { type: 'state' };
    }
    if (playerId === null) return { type: 'error', message: 'Вы не в этой комнате' };
    if (this.status !== 'playing' || !this.state) return { type: 'error', message: 'Игра ещё не началась' };
    if (typeof msg.q !== 'number' || typeof msg.r !== 'number') {
      return { type: 'error', message: 'Некорректные координаты' };
    }
    let validation: rules.ActionValidation;
    switch (type) {
      case 'capture': {
        validation = rules.validateCapture(this.state, playerId, msg.q, msg.r, Math.max(0, Math.floor(Number(msg.army) || 0)));
        if (!validation.ok) return { type: 'error', message: validation.error };
        rules.applyCapture(this.state, playerId, msg.q, msg.r);
        this.stats.record({ type: 'action', t: Date.now(), playerId, action: 'capture', q: msg.q, r: msg.r });
        return { type: 'state' };
      }
      case 'attack': {
        validation = rules.validateAttack(this.state, playerId, msg.q, msg.r, Number(msg.points));
        if (!validation.ok) return { type: 'error', message: validation.error };
        rules.applyAttack(this.state, playerId, msg.q, msg.r, Number(msg.points));
        this.addLog(`${this.playerName(playerId)} вложил ${Number(msg.points)} очков в атаку на (${msg.q}, ${msg.r})`);
        this.stats.record({ type: 'action', t: Date.now(), playerId, action: 'attack', q: msg.q, r: msg.r });
        this.noteAttack(msg.q, msg.r, Date.now());
        return { type: 'state' };
      }
      case 'defend': {
        validation = rules.validateDefend(this.state, playerId, msg.q, msg.r, Number(msg.points));
        if (!validation.ok) return { type: 'error', message: validation.error };
        rules.applyDefend(this.state, playerId, msg.q, msg.r, Number(msg.points));
        this.addLog(`${this.playerName(playerId)} защищает (${msg.q}, ${msg.r}): +${Number(msg.points)}`);
        this.stats.record({ type: 'action', t: Date.now(), playerId, action: 'defend', q: msg.q, r: msg.r });
        this.recordReaction(playerId, msg.q, msg.r, Date.now());
        return { type: 'state' };
      }
      case 'build-fortress': {
        validation = rules.validateBuildFortress(this.state, playerId, msg.q, msg.r);
        if (!validation.ok) return { type: 'error', message: validation.error };
        rules.buildFortress(this.state, playerId, msg.q, msg.r);
        this.addLog(`${this.playerName(playerId)} построил крепость на (${msg.q}, ${msg.r})`);
        return { type: 'state' };
      }
      case 'remove-fortress': {
        validation = rules.validateRemoveFortress(this.state, playerId, msg.q, msg.r);
        if (!validation.ok) return { type: 'error', message: validation.error };
        rules.removeFortress(this.state, playerId, msg.q, msg.r);
        this.addLog(`${this.playerName(playerId)} снёс крепость на (${msg.q}, ${msg.r})`);
        return { type: 'state' };
      }
      case 'declare-war': {
        const target = this.targetPlayerId(playerId, msg);
        if (target === null) return { type: 'error', message: 'Владелец гекса не найден' };
        if (rules.relation(this.state!, playerId, target) === 'war') {
          return { type: 'error', message: 'Уже в войне' };
        }
        rules.declareWar(this.state, playerId, target);
        this.addLog(`${this.playerName(playerId)} объявил войну ${this.playerName(target)}`);
        return { type: 'state' };
      }
      case 'propose': {
        const target = this.targetPlayerId(playerId, msg);
        if (target === null) return { type: 'error', message: 'Владелец гекса не найден' };
        const kind = msg.kind;
        if (kind !== 'peace' && kind !== 'alliance') return { type: 'error', message: 'Неизвестный тип предложения' };
        const rel = rules.relation(this.state!, playerId, target);
        if (kind === 'peace' && rel !== 'war') return { type: 'error', message: 'Мир можно предложить только во время войны' };
        if (kind === 'alliance' && (rel === 'alliance' || rel === 'war')) {
          return { type: 'error', message: 'Союз невозможен при текущих отношениях' };
        }
        if (this.pendingProposals.some((p) => p.from === playerId && p.to === target && p.kind === kind)) {
          return { type: 'error', message: 'Предложение уже отправлено' };
        }
        this.pendingProposals.push({ from: playerId, to: target, kind });
        this.addLog(`${this.playerName(playerId)} предлагает ${kind === 'peace' ? 'мир' : 'союз'} ${this.playerName(target)}`);
        return { type: 'state' };
      }
      case 'respond-proposal': {
        const proposer = this.targetPlayerId(playerId, msg);
        if (proposer === null) return { type: 'error', message: 'Владелец гекса не найден' };
        const idx = this.pendingProposals.findIndex((p) => p.from === proposer && p.to === playerId);
        if (idx === -1) return { type: 'error', message: 'Нет предложения от этого игрока' };
        const [proposal] = this.pendingProposals.splice(idx, 1);
        if (msg.accept) {
          if (proposal.kind === 'peace') rules.makePeace(this.state!, playerId, proposer);
          else rules.makeAlliance(this.state!, playerId, proposer);
          this.addLog(`${this.playerName(playerId)} и ${this.playerName(proposer)} заключили ${proposal.kind === 'peace' ? 'мир' : 'союз'}`);
        } else {
          this.addLog(`${this.playerName(playerId)} отклонил предложение ${this.playerName(proposer)}`);
        }
        return { type: 'state' };
      }
      default:
        return { type: 'error', message: `Неизвестный тип сообщения: ${type}` };
    }
  }

  humanDisconnected(connId: number): void {
    if (this.status === 'waiting') {
      this.removeHuman(connId);
      return;
    }
    const id = this.connToSlot.get(connId);
    if (id === undefined) return;
    this.connToSlot.delete(connId);
    const slot = this.slots.find((s) => s.id === id);
    if (!slot) return;
    slot.connId = null;
    slot.disconnected = true;
    slot.isAi = true;
    const player = this.state?.players.find((p) => p.id === id);
    if (player) {
      player.isAi = true;
      player.incomeMultiplier = config.aiIncomeMultipliers[this.difficulty];
    }
    this.addLog(`${slot.name} покинул игру — его место занял компьютер`);
  }

  updateName(connId: number, name: string): void {
    const id = this.connToSlot.get(connId);
    if (id === undefined) return;
    const slot = this.slots.find((s) => s.id === id);
    if (slot) slot.name = name;
  }

  view(playerId: number | null = null): RoomView {
    const state = this.state;
    return {
      id: this.id,
      name: this.name,
      mapType: this.mapType,
      maxPlayers: this.maxPlayers,
      status: this.status,
      aiMode: this.aiMode,
      hostPlayerId: this.hostPlayerId,
      slots: this.slots.map((s) => ({ id: s.id, name: s.name, isAi: s.isAi })),
      paused: this.paused,
      game: state
        ? {
            players: state.players.map((p) => {
              const rel = p.id === playerId ? 'self' : playerId !== null && rules.relation(state, playerId, p.id) === 'alliance' ? 'ally' : 'enemy';
              const hidden = playerId !== null && rel === 'enemy';
              return {
                id: p.id,
                name: p.name ?? `Игрок ${p.id}`,
                points: hidden ? null : p.points,
                hexCount: rules.hexCount(state, p.id),
                income: hidden ? null : rules.playerIncome(state, p.id),
                limit: hidden ? null : rules.pointLimit(rules.hexCount(state, p.id), rules.fortressCount(state, p.id)),
                isAi: p.isAi ?? false,
                capital: p.capital ?? null,
                eliminated: p.eliminated ?? false,
                relation: rel,
              };
            }),
            hexes: state.hexes,
            winnerId: state.winnerId,
            captureTicks: rules.CAPTURE_TICKS,
            pendingProposals: playerId !== null ? this.pendingProposals.filter((p) => p.to === playerId).map((p) => ({ from: p.from, kind: p.kind })) : [],
          }
        : null,
      log: this.log,
    };
  }

  private nextSlotId(): number {
    return Math.max(0, ...this.slots.map((s) => s.id)) + 1;
  }

  private noteAttack(q: number, r: number, now: number): void {
    const hex = rules.findHex(this.state!, q, r);
    if (hex && hex.ownerId !== null) this.attackStartedAt.set(`${q},${r}`, now);
  }

  private recordReaction(playerId: number, q: number, r: number, now: number): void {
    const started = this.attackStartedAt.get(`${q},${r}`);
    if (started === undefined) return;
    this.attackStartedAt.delete(`${q},${r}`);
    const ms = now - started;
    if (ms >= 0 && ms < 30000) {
      this.stats.record({ type: 'reaction', t: now, playerId, ms });
    }
  }

  writeStatsIfNeeded(): void {
    if (this.statsWritten) return;
    this.statsWritten = true;
    try {
      const path = this.stats.writeSummary(config.statsDir);
      if (path === '') return;
    } catch (err) {
      console.error('stats write failed:', err);
    }
  }

  private applyAiAction(playerId: number, action: AiAction): void {
    const state = this.state!;
    const name = this.playerName(playerId);
    switch (action.type) {
      case 'capture':
        if (rules.validateCapture(state, playerId, action.q, action.r).ok) {
          rules.applyCapture(state, playerId, action.q, action.r);
          this.stats.record({ type: 'action', t: Date.now(), playerId, action: 'capture', q: action.q, r: action.r });
          this.recordReaction(playerId, action.q, action.r, Date.now());
        }
        break;
      case 'attack':
        if (rules.validateAttack(state, playerId, action.q, action.r, action.points).ok) {
          rules.applyAttack(state, playerId, action.q, action.r, action.points);
          this.addLog(`${name} вложил ${action.points} очков в атаку на (${action.q}, ${action.r})`);
          this.stats.record({ type: 'action', t: Date.now(), playerId, action: 'attack', q: action.q, r: action.r });
          this.noteAttack(action.q, action.r, Date.now());
        }
        break;
      case 'defend':
        if (rules.validateDefend(state, playerId, action.q, action.r, action.points).ok) {
          rules.applyDefend(state, playerId, action.q, action.r, action.points);
          this.addLog(`${name} защищает (${action.q}, ${action.r}): +${action.points}`);
          this.stats.record({ type: 'action', t: Date.now(), playerId, action: 'defend', q: action.q, r: action.r });
          this.recordReaction(playerId, action.q, action.r, Date.now());
        }
        break;
    }
  }

  private playerName(playerId: number): string {
    return this.slots.find((s) => s.id === playerId)?.name ?? `Игрок ${playerId}`;
  }

  private targetPlayerId(playerId: number, msg: { q?: number; r?: number }): number | null {
    const hex = rules.findHex(this.state!, msg.q ?? 0, msg.r ?? 0);
    if (!hex || hex.ownerId === null || hex.ownerId === playerId) return null;
    return hex.ownerId;
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

export function randomCountryName(): string {
  const prefix = COUNTRY_PREFIXES[Math.floor(Math.random() * COUNTRY_PREFIXES.length)];
  const suffix = COUNTRY_SUFFIXES[Math.floor(Math.random() * COUNTRY_SUFFIXES.length)];
  return prefix + suffix;
}

function uniqueCountryName(used: Set<string>): string {
  let name = randomCountryName();
  let suffix = 2;
  while (used.has(name)) {
    name = `${randomCountryName()} ${suffix}`;
    suffix++;
  }
  used.add(name);
  return name;
}

export class RoomManager {
  private rooms = new Map<number, Room>();
  private connToRoom = new Map<number, number>();
  private authProfiles = new Map<number, GoogleProfile>();
  private nextRoomId = 1;

  constructor(private readonly finishedRoomGraceMs = 60_000) {}

  get roomCount(): number {
    return this.rooms.size;
  }

  roomForConn(connId: number): Room | null {
    const roomId = this.connToRoom.get(connId);
    if (roomId === undefined) return null;
    return this.rooms.get(roomId) ?? null;
  }

  viewerPlayerId(connId: number): number | null {
    return this.roomForConn(connId)?.slotForConn(connId) ?? null;
  }

  authProfileFor(connId: number): GoogleProfile | null {
    return this.authProfiles.get(connId) ?? null;
  }

  async handleAuth(connId: number, token: string): Promise<{ ok: boolean; error?: string }> {
    const clientId = config.googleClientId;
    if (!clientId) return { ok: false, error: 'Google-вход не настроен на сервере' };
    if (!token) return { ok: false, error: 'Пустой токен' };
    try {
      const profile = await verifyGoogleIdToken(token, clientId);
      if (!profile) return { ok: false, error: 'Не удалось проверить токен Google' };
      this.authProfiles.set(connId, profile);
      this.roomForConn(connId)?.updateName(connId, profile.name);
      return { ok: true };
    } catch (err) {
      console.error('google auth failed:', err);
      return { ok: false, error: 'Ошибка проверки токена' };
    }
  }

  createRoom(connId: number, mapType: MapType, maxPlayers: number): { ok: true } | { ok: false; error: string } {
    if (this.connToRoom.has(connId)) return { ok: false, error: 'Вы уже в комнате' };
    const preset = MAP_PRESETS[mapType];
    if (!preset) return { ok: false, error: 'Неизвестный тип карты' };
    if (!Number.isInteger(maxPlayers) || maxPlayers < preset.minPlayers || maxPlayers > preset.maxPlayers) {
      return { ok: false, error: `Игроков должно быть от ${preset.minPlayers} до ${preset.maxPlayers}` };
    }
    const room = new Room(this.nextRoomId++, randomCountryName(), mapType, maxPlayers, false, 1);
    const slot = room.addHuman(this.connName(connId), connId);
    if (slot === null) return { ok: false, error: 'Комната заполнена' };
    this.rooms.set(room.id, room);
    this.connToRoom.set(connId, room.id);
    return { ok: true };
  }

  createSolo(connId: number, mapType: MapType, aiCount: number, difficulty: Difficulty = 'medium'): { ok: true } | { ok: false; error: string } {
    if (this.connToRoom.has(connId)) return { ok: false, error: 'Вы уже в комнате' };
    const preset = MAP_PRESETS[mapType];
    if (!preset) return { ok: false, error: 'Неизвестный тип карты' };
    if (!Number.isInteger(aiCount) || aiCount < 1 || aiCount > preset.maxPlayers - 1) {
      return { ok: false, error: `Компьютеров должно быть от 1 до ${preset.maxPlayers - 1}` };
    }
    if (!['easy', 'medium', 'hard'].includes(difficulty)) {
      return { ok: false, error: 'Неизвестная сложность' };
    }
    const room = new Room(this.nextRoomId++, randomCountryName(), mapType, preset.maxPlayers, true, aiCount, undefined, difficulty);
    const slot = room.addHuman(this.connName(connId), connId);
    if (slot === null) return { ok: false, error: 'Комната заполнена' };
    this.rooms.set(room.id, room);
    this.connToRoom.set(connId, room.id);
    return room.start(connId);
  }

  joinRoom(connId: number, roomId: number): { ok: true } | { ok: false; error: string } {
    if (this.connToRoom.has(connId)) return { ok: false, error: 'Вы уже в комнате' };
    const room = this.rooms.get(roomId);
    if (!room || room.status !== 'waiting') return { ok: false, error: 'Комната не найдена' };
    const slot = room.addHuman(this.connName(connId), connId);
    if (slot === null) return { ok: false, error: 'Комната заполнена' };
    this.connToRoom.set(connId, room.id);
    return { ok: true };
  }

  leaveRoom(connId: number): void {
    const room = this.roomForConn(connId);
    if (!room) return;
    this.connToRoom.delete(connId);
    room.humanDisconnected(connId);
    this.cleanupRoom(room);
  }

  startRoom(connId: number): { ok: true } | { ok: false; error: string } {
    const room = this.roomForConn(connId);
    if (!room) return { ok: false, error: 'Вы не в комнате' };
    return room.start(connId);
  }

  restart(connId: number): { ok: true } | { ok: false; error: string } {
    const room = this.roomForConn(connId);
    if (!room) return { ok: false, error: 'Вы не в комнате' };
    return room.restart();
  }

  handleAction(connId: number, msg: { type: string; q?: number; r?: number; points?: number; army?: number; kind?: string; accept?: boolean }): ActionResult {
    const room = this.roomForConn(connId);
    if (!room) return { type: 'error', message: 'Вы не в комнате' };
    return room.handleAction(connId, msg.type, msg);
  }

  lobby(): RoomLobbyInfo[] {
    const list: RoomLobbyInfo[] = [];
    for (const room of this.rooms.values()) {
      if (room.status !== 'waiting' || room.aiMode) continue;
      list.push({
        id: room.id,
        name: room.name,
        mapType: room.mapType,
        maxPlayers: room.maxPlayers,
        humans: room.humanCount,
      });
    }
    return list;
  }

  tickAll(): void {
    const toRemove: Room[] = [];
    for (const room of this.rooms.values()) {
      room.tick();
      if (room.status !== 'playing') continue;
      if (room.humanCount === 0) {
        toRemove.push(room);
        continue;
      }
      if (room.finishedAt !== null && Date.now() - room.finishedAt >= this.finishedRoomGraceMs) {
        toRemove.push(room);
      }
    }
    for (const room of toRemove) {
      this.removeRoom(room);
    }
  }

  connectionClosed(connId: number): void {
    this.leaveRoom(connId);
    this.authProfiles.delete(connId);
  }

  private cleanupRoom(room: Room): void {
    if (room.status === 'waiting' && room.isEmpty) {
      this.removeRoom(room);
    }
  }

  private removeRoom(room: Room): void {
    room.writeStatsIfNeeded();
    this.rooms.delete(room.id);
    for (const [conn, roomId] of this.connToRoom) {
      if (roomId === room.id) this.connToRoom.delete(conn);
    }
  }

  private connName(connId: number): string {
    return this.authProfiles.get(connId)?.name ?? 'Игрок';
  }
}
