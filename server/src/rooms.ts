import { MAP_PRESETS, generateMap, type MapType } from './map.js';
import * as rules from './rules.js';
import type { GameState, HexState, PlayerState } from './rules.js';
import { chooseAiAction, type AiAction } from './ai.js';
import type { GoogleProfile } from './auth.js';
import { verifyGoogleIdToken } from './auth.js';
import { config } from './config.js';

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
  points: number;
  hexCount: number;
  income: number;
  limit: number;
  isAi: boolean;
}

export interface ViewGame {
  players: ViewPlayer[];
  hexes: HexState[];
  winnerId: number | null;
  captureTicks: number;
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

  constructor(
    readonly id: number,
    readonly name: string,
    readonly mapType: MapType,
    readonly maxPlayers: number,
    readonly aiMode: boolean,
    private readonly aiCount: number,
    private readonly rng: () => number = Math.random,
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
    const preset = MAP_PRESETS[this.mapType];
    this.state = { players, hexes, columns: preset.columns, rows: preset.rows, winnerId: null, qOffset: preset.qOffset };
    this.status = 'playing';
    this.paused = false;
    this.addLog('Новая игра началась');
    return { ok: true };
  }

  tick(): void {
    if (this.status !== 'playing' || this.paused) return;
    const state = this.state;
    if (!state) return;
    if (state.winnerId !== null) {
      if (this.finishedAt === null) this.finishedAt = Date.now();
      return;
    }
    rules.applyIncome(state);
    const results = rules.tickBattles(state);
    for (const result of results) {
      if (result.winnerId === null) {
        this.addLog(`Битва за (${result.q}, ${result.r}) окончена — ничья`);
      } else {
        this.addLog(`Битва за (${result.q}, ${result.r}) окончена — победил ${this.playerName(result.winnerId)}`);
      }
    }
    for (const result of results) {
      if (result.loserId === undefined) continue;
      const elim = rules.eliminateIfCapitalLost(state, result.loserId, this.rng);
      if (elim) {
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
      } else {
        const cut = rules.applyCut(state, result.loserId);
        if (cut.length > 0) {
          this.addLog(`${this.playerName(result.loserId)} отрезан: ${cut.length} клеток стали нейтральными`);
        }
      }
    }
    const claims = rules.applyEnclosure(state);
    for (const claim of claims) {
      this.addLog(`${this.playerName(claim.ownerId)} окружил и захватил ${claim.hexes.length} клеток`);
    }
    const now = Date.now();
    for (const player of state.players) {
      if (!player.isAi || player.eliminated) continue;
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
      game: this.state
        ? {
            players: this.state.players.map((p) => ({
              id: p.id,
              name: p.name ?? `Игрок ${p.id}`,
              points: p.points,
              hexCount: rules.hexCount(this.state!, p.id),
              income: rules.playerIncome(this.state!, p.id),
              limit: rules.pointLimit(rules.hexCount(this.state!, p.id)),
              isAi: p.isAi ?? false,
              capital: p.capital ?? null,
              eliminated: p.eliminated ?? false,
            })),
            hexes: this.state.hexes,
            winnerId: this.state.winnerId,
            captureTicks: rules.CAPTURE_TICKS,
          }
        : null,
      log: this.log,
    };
  }

  private nextSlotId(): number {
    return Math.max(0, ...this.slots.map((s) => s.id)) + 1;
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

  createSolo(connId: number, mapType: MapType, aiCount: number): { ok: true } | { ok: false; error: string } {
    if (this.connToRoom.has(connId)) return { ok: false, error: 'Вы уже в комнате' };
    const preset = MAP_PRESETS[mapType];
    if (!preset) return { ok: false, error: 'Неизвестный тип карты' };
    if (!Number.isInteger(aiCount) || aiCount < 1 || aiCount > preset.maxPlayers - 1) {
      return { ok: false, error: `Компьютеров должно быть от 1 до ${preset.maxPlayers - 1}` };
    }
    const room = new Room(this.nextRoomId++, randomCountryName(), mapType, preset.maxPlayers, true, aiCount);
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

  handleAction(connId: number, msg: { type: string; q?: number; r?: number; points?: number; army?: number }): ActionResult {
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
    this.rooms.delete(room.id);
    for (const [conn, roomId] of this.connToRoom) {
      if (roomId === room.id) this.connToRoom.delete(conn);
    }
  }

  private connName(connId: number): string {
    return this.authProfiles.get(connId)?.name ?? 'Игрок';
  }
}
