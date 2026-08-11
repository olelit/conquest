import { MAP_PRESETS, generateMap, type MapType } from './map.js';
import * as rules from './rules.js';
import type { GameState, HexState, PlayerState } from './rules.js';
import { chooseAiAction, type AiAction } from './ai.js';

export type RoomStatus = 'waiting' | 'playing';

export interface RoomSlot {
  id: number;
  name: string;
  isAi: boolean;
  connId: number | null;
  disconnected: boolean;
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
  game: GameState | null;
  log: string[];
}

export type ActionResult = { type: 'state' } | { type: 'error'; message: string };

export class Room {
  status: RoomStatus = 'waiting';
  hostPlayerId: number | null = null;
  paused = false;

  private slots: RoomSlot[] = [];
  private connToSlot = new Map<number, number>();
  private state: GameState | null = null;
  private log: string[] = [];

  constructor(
    readonly id: number,
    readonly name: string,
    readonly mapType: MapType,
    readonly maxPlayers: number,
    readonly aiMode: boolean,
    private readonly aiCount: number,
  ) {}

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
    const id = this.slots.length + 1;
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
    this.renumberSlots();
  }

  start(connId: number): { ok: true } | { ok: false; error: string } {
    if (this.status !== 'waiting') return { ok: false, error: 'Игра уже началась' };
    if (this.slotForConn(connId) !== this.hostPlayerId) {
      return { ok: false, error: 'Только хозяин может начать игру' };
    }
    const aiToAdd = this.aiMode ? this.aiCount : this.maxPlayers - this.slots.length;
    for (let i = 0; i < aiToAdd; i++) {
      const id = this.slots.length + 1;
      this.slots.push({ id, name: randomCountryName(), isAi: true, connId: null, disconnected: false });
    }
    const players: PlayerState[] = this.slots.map((s) => ({
      id: s.id,
      name: s.name,
      points: rules.BASE_POINTS,
      isAi: s.isAi,
    }));
    const hexes: HexState[] = generateMap(this.mapType).map((h) => ({
      q: h.q,
      r: h.r,
      terrain: h.terrain,
      ownerId: null,
      attackerId: null,
      defenderId: null,
      attackInvestment: 0,
      defenseInvestment: 0,
      battleProgress: 0,
    }));
    this.state = { players, hexes, winnerId: null };
    this.status = 'playing';
    this.paused = false;
    this.addLog('Новая игра началась');
    return { ok: true };
  }

  tick(): void {
    if (this.status !== 'playing' || this.paused) return;
    const state = this.state;
    if (!state || state.winnerId !== null) return;
    rules.applyIncome(state);
    const results = rules.tickBattles(state);
    for (const result of results) {
      if (result.winnerId === null) {
        this.addLog(`Битва за (${result.q}, ${result.r}) окончена — ничья`);
      } else {
        this.addLog(`Битва за (${result.q}, ${result.r}) окончена — победил ${this.playerName(result.winnerId)}`);
      }
    }
    const claims = rules.applyEnclosure(state);
    for (const claim of claims) {
      this.addLog(`${this.playerName(claim.ownerId)} окружил и захватил ${claim.hexes.length} клеток`);
    }
    for (const player of state.players) {
      if (!player.isAi) continue;
      const action = chooseAiAction(state, player.id);
      if (action) this.applyAiAction(player.id, action);
    }
    rules.computeWinner(state);
  }

  handleAction(connId: number, type: string, msg: { q?: number; r?: number; points?: number; army?: number }): ActionResult {
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
        const hex = rules.findHex(this.state, msg.q, msg.r)!;
        const cost = rules.hexCount(this.state, playerId) === 0 ? 0 : rules.terrainCost(hex.terrain);
        rules.applyCapture(this.state, playerId, msg.q, msg.r);
        this.addLog(`${this.playerName(playerId)} захватил (${msg.q}, ${msg.r}) за ${cost} очков`);
        return { type: 'state' };
      }
      case 'attack': {
        validation = rules.validateAttack(this.state, playerId, msg.q, msg.r, Number(msg.points));
        if (!validation.ok) return { type: 'error', message: validation.error };
        rules.applyAttack(this.state, playerId, msg.q, msg.r, Number(msg.points));
        this.addLog(`${this.playerName(playerId)} вложил ${Number(msg.points)} очков в атаку на (${msg.q}, ${msg.r})`);
        return { type: 'state' };
      }
      case 'defend': {
        validation = rules.validateDefend(this.state, playerId, msg.q, msg.r, Number(msg.points));
        if (!validation.ok) return { type: 'error', message: validation.error };
        rules.applyDefend(this.state, playerId, msg.q, msg.r, Number(msg.points));
        this.addLog(`${this.playerName(playerId)} защищает (${msg.q}, ${msg.r}): +${Number(msg.points)}`);
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
    if (player) player.isAi = true;
    this.addLog(`${slot.name} покинул игру — его место занял компьютер`);
  }

  updateName(connId: number, name: string): void {
    const id = this.connToSlot.get(connId);
    if (id === undefined) return;
    const slot = this.slots.find((s) => s.id === id);
    if (slot) slot.name = name;
  }

  view(): RoomView {
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
      game: this.state,
      log: this.log,
    };
  }

  private renumberSlots(): void {
    this.slots.forEach((s, i) => {
      s.id = i + 1;
    });
    this.connToSlot.clear();
    for (const s of this.slots) {
      if (s.connId !== null) this.connToSlot.set(s.connId, s.id);
    }
  }

  private applyAiAction(playerId: number, action: AiAction): void {
    const state = this.state!;
    const name = this.playerName(playerId);
    switch (action.type) {
      case 'capture':
        if (rules.validateCapture(state, playerId, action.q, action.r).ok) {
          const hex = rules.findHex(state, action.q, action.r)!;
          const cost = rules.hexCount(state, playerId) === 0 ? 0 : rules.terrainCost(hex.terrain);
          rules.applyCapture(state, playerId, action.q, action.r);
          this.addLog(`${name} захватил (${action.q}, ${action.r}) за ${cost} очков`);
        }
        break;
      case 'attack':
        if (rules.validateAttack(state, playerId, action.q, action.r, action.points).ok) {
          rules.applyAttack(state, playerId, action.q, action.r, action.points);
          this.addLog(`${name} вложил ${action.points} очков в атаку на (${action.q}, ${action.r})`);
        }
        break;
      case 'defend':
        if (rules.validateDefend(state, playerId, action.q, action.r, action.points).ok) {
          rules.applyDefend(state, playerId, action.q, action.r, action.points);
          this.addLog(`${name} защищает (${action.q}, ${action.r}): +${action.points}`);
        }
        break;
    }
  }

  private playerName(playerId: number): string {
    return this.slots.find((s) => s.id === playerId)?.name ?? `Игрок ${playerId}`;
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
