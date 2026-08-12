import type { Terrain } from './map.js';
import { config } from './config.js';

export const TERRAIN_COSTS: Record<Terrain, number> = config.terrainCosts;

export const BASE_POINTS = config.basePoints;
export const LIMIT_PER_HEX = config.limitPerHex;
export const INCOME_PER_HEX = config.incomePerHex;
export const MINE_INCOME_BONUS = config.mineIncomeBonus;
export const CAPTURE_TICKS = config.captureTicks;
export const DRAIN_PER_TICK = config.drainPerTick;

export interface PlayerState {
  id: number;
  name?: string;
  points: number;
  isAi?: boolean;
  capital?: { q: number; r: number } | null;
}

export interface HexState {
  q: number;
  r: number;
  terrain: Terrain;
  ownerId: number | null;
  attackerId: number | null;
  defenderId: number | null;
  attackInvestment: number;
  defenseInvestment: number;
  battleProgress: number;
}

export interface GameState {
  players: PlayerState[];
  hexes: HexState[];
  columns: number;
  rows: number;
  winnerId: number | null;
  qOffset?: number;
}

const NEIGHBOR_OFFSETS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, -1],
  [-1, 1],
];

export function findHex(state: GameState, q: number, r: number): HexState | undefined {
  return state.hexes.find((h) => h.q === q && h.r === r);
}

export function hexCount(state: GameState, playerId: number): number {
  return state.hexes.reduce((n, h) => n + (h.ownerId === playerId ? 1 : 0), 0);
}

export function isInBounds(state: GameState, q: number, r: number): boolean {
  const q0 = state.qOffset ?? 0;
  return q >= q0 && q < q0 + state.columns && r >= 0 && r < state.rows;
}

export function isAdjacent(a: { q: number; r: number }, b: { q: number; r: number }): boolean {
  return NEIGHBOR_OFFSETS.some(([dq, dr]) => a.q + dq === b.q && a.r + dr === b.r);
}

export function hasAdjacentOwner(state: GameState, q: number, r: number, playerId: number): boolean {
  return NEIGHBOR_OFFSETS.some(([dq, dr]) => {
    const nq = q + dq;
    const nr = r + dr;
    if (!isInBounds(state, nq, nr)) return false;
    const hex = findHex(state, nq, nr);
    return hex !== undefined && hex.ownerId === playerId;
  });
}

export function pointLimit(hexCount: number): number {
  return BASE_POINTS + hexCount * LIMIT_PER_HEX;
}

export function winHexCount(totalHexes: number): number {
  return Math.floor(totalHexes / 2) + 1;
}

export function terrainCost(terrain: Terrain): number {
  return TERRAIN_COSTS[terrain];
}

function hasGameWinner(state: GameState): boolean {
  return state.winnerId !== null;
}

function isValidPoints(points: unknown): points is number {
  return typeof points === 'number' && Number.isInteger(points) && points >= 1;
}

export type ActionValidation = { ok: true } | { ok: false; error: string };

export function validateCapture(state: GameState, playerId: number, q: number, r: number, army = 0): ActionValidation {
  if (hasGameWinner(state)) return { ok: false, error: 'Игра окончена' };
  const hex = findHex(state, q, r);
  if (!hex) return { ok: false, error: 'Гекс не найден' };
  if (hex.ownerId !== null) return { ok: false, error: 'Гекс уже занят' };
  if (hex.attackerId !== null) return { ok: false, error: 'За гекс уже идёт борьба' };
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { ok: false, error: 'Игрок не найден' };
  const count = hexCount(state, playerId);
  if (count === 0) {
    if (hex.terrain === 'water') return { ok: false, error: 'Первый гекс не может быть на воде' };
    if (hasAdjacentOtherOwner(state, q, r, playerId) && player.points - army < terrainCost(hex.terrain)) {
      return { ok: false, error: 'Не хватает очков для битвы у границы врага' };
    }
    return { ok: true };
  }
  if (!hasAdjacentOwner(state, q, r, playerId)) return { ok: false, error: 'Гекс не соседний' };
  if (player.points - army < terrainCost(hex.terrain)) return { ok: false, error: 'Не хватает очков (часть занята армией)' };
  return { ok: true };
}

export function validateAttack(state: GameState, playerId: number, q: number, r: number, points: number): ActionValidation {
  if (hasGameWinner(state)) return { ok: false, error: 'Игра окончена' };
  if (!isValidPoints(points)) return { ok: false, error: 'Вложение должно быть целым числом ≥ 1' };
  const hex = findHex(state, q, r);
  if (!hex) return { ok: false, error: 'Гекс не найден' };
  if (hex.ownerId !== null && hex.ownerId === playerId) return { ok: false, error: 'Нельзя атаковать свой гекс' };
  if (hex.ownerId === null && hex.attackerId !== playerId) return { ok: false, error: 'Нейтральный гекс захватывается, а не атакуется' };
  if (hex.attackerId !== null && hex.attackerId !== playerId) return { ok: false, error: 'Битву уже ведёт соперник' };
  if (hex.attackerId !== playerId && !hasAdjacentOwner(state, q, r, playerId)) return { ok: false, error: 'Гекс не соседний' };
  if (hex.attackerId !== playerId && points < terrainCost(hex.terrain)) {
    return { ok: false, error: 'Минимальное вложение в атаку — стоимость гекса' };
  }
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { ok: false, error: 'Игрок не найден' };
  if (player.points < points) return { ok: false, error: 'Не хватает очков' };
  return { ok: true };
}

export function validateDefend(state: GameState, playerId: number, q: number, r: number, points: number): ActionValidation {
  if (hasGameWinner(state)) return { ok: false, error: 'Игра окончена' };
  if (!isValidPoints(points)) return { ok: false, error: 'Вложение должно быть целым числом ≥ 1' };
  const hex = findHex(state, q, r);
  if (!hex) return { ok: false, error: 'Гекс не найден' };
  if (hex.attackerId === null) return { ok: false, error: 'Битвы нет' };
  if (hex.attackerId === playerId) return { ok: false, error: 'Нельзя защищать свою же атаку' };
  if (hex.ownerId === playerId) {
    // владелец защищает свой гекс
  } else if (hex.ownerId === null) {
    if (!hasAdjacentOwner(state, q, r, playerId)) return { ok: false, error: 'Гекс не соседний' };
  } else {
    return { ok: false, error: 'Гекс принадлежит другому' };
  }
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { ok: false, error: 'Игрок не найден' };
  if (player.points < points) return { ok: false, error: 'Не хватает очков' };
  return { ok: true };
}

export function applyCapture(state: GameState, playerId: number, q: number, r: number): void {
  const hex = findHex(state, q, r)!;
  const player = state.players.find((p) => p.id === playerId)!;
  const isFirst = hexCount(state, playerId) === 0;
  const cost = isFirst ? 0 : terrainCost(hex.terrain);
  player.points -= cost;
  if (hasAdjacentOtherOwner(state, q, r, playerId)) {
    const pool = cost > 0 ? cost : terrainCost(hex.terrain);
    if (pool !== cost) player.points -= pool - cost;
    hex.attackerId = playerId;
    hex.attackInvestment = pool;
    hex.defenderId = null;
    hex.defenseInvestment = 0;
    hex.battleProgress = 0;
  } else {
    hex.ownerId = playerId;
    if (isFirst && !player.capital) player.capital = { q, r };
  }
}

function hasAdjacentOtherOwner(state: GameState, q: number, r: number, playerId: number): boolean {
  return NEIGHBOR_OFFSETS.some(([dq, dr]) => {
    const nq = q + dq;
    const nr = r + dr;
    if (!isInBounds(state, nq, nr)) return false;
    const hex = findHex(state, nq, nr);
    return hex !== undefined && hex.ownerId !== null && hex.ownerId !== playerId;
  });
}

export function applyAttack(state: GameState, playerId: number, q: number, r: number, points: number): void {
  const hex = findHex(state, q, r)!;
  const player = state.players.find((p) => p.id === playerId)!;
  player.points -= points;
  hex.attackInvestment += points;
  if (hex.attackerId === null) {
    hex.attackerId = playerId;
    hex.defenderId = hex.ownerId;
    hex.battleProgress = 0;
  }
}

export function applyDefend(state: GameState, playerId: number, q: number, r: number, points: number): void {
  const hex = findHex(state, q, r)!;
  const player = state.players.find((p) => p.id === playerId)!;
  player.points -= points;
  hex.defenseInvestment += points;
  if (hex.defenderId === null) {
    hex.defenderId = playerId;
  }
}

export interface BattleResult {
  q: number;
  r: number;
  winnerId: number | null;
}

export function tickBattles(state: GameState): BattleResult[] {
  const results: BattleResult[] = [];
  for (const hex of state.hexes) {
    if (hex.attackerId === null) continue;
    hex.attackInvestment = Math.max(0, hex.attackInvestment - DRAIN_PER_TICK);
    hex.defenseInvestment = Math.max(0, hex.defenseInvestment - DRAIN_PER_TICK);
    if (hex.attackInvestment === 0 && hex.defenseInvestment === 0) {
      results.push({ q: hex.q, r: hex.r, winnerId: null });
      resetBattle(hex);
      continue;
    }
    if (hex.attackInvestment > hex.defenseInvestment) {
      hex.battleProgress += 1;
    } else if (hex.defenseInvestment > hex.attackInvestment) {
      hex.battleProgress -= 1;
    }
    if (hex.battleProgress >= CAPTURE_TICKS) {
      const winner = state.players.find((p) => p.id === hex.attackerId);
      if (winner) winner.points += hex.attackInvestment;
      hex.ownerId = hex.attackerId;
      if (winner && !winner.capital && hexCount(state, winner.id) === 1) {
        winner.capital = { q: hex.q, r: hex.r };
      }
      results.push({ q: hex.q, r: hex.r, winnerId: hex.attackerId });
      resetBattle(hex);
      continue;
    }
    if (hex.battleProgress <= -CAPTURE_TICKS) {
      if (hex.defenderId === null) {
        results.push({ q: hex.q, r: hex.r, winnerId: null });
        resetBattle(hex);
        continue;
      }
      const winner = state.players.find((p) => p.id === hex.defenderId);
      if (winner) winner.points += hex.defenseInvestment;
      hex.ownerId = hex.defenderId;
      if (winner && !winner.capital && hexCount(state, winner.id) === 1) {
        winner.capital = { q: hex.q, r: hex.r };
      }
      results.push({ q: hex.q, r: hex.r, winnerId: hex.defenderId });
      resetBattle(hex);
    }
  }
  return results;
}

function resetBattle(hex: HexState): void {
  hex.attackerId = null;
  hex.defenderId = null;
  hex.attackInvestment = 0;
  hex.defenseInvestment = 0;
  hex.battleProgress = 0;
}

export function playerIncome(state: GameState, playerId: number): number {
  return state.hexes.reduce((sum, hex) => {
    if (hex.ownerId !== playerId) return sum;
    return sum + INCOME_PER_HEX + (hex.terrain === 'mine' ? MINE_INCOME_BONUS : 0);
  }, 0);
}

export function applyIncome(state: GameState): void {
  for (const player of state.players) {
    const count = hexCount(state, player.id);
    player.points = Math.min(player.points + playerIncome(state, player.id), pointLimit(count));
  }
}

export function applyEnclosure(state: GameState): { ownerId: number; hexes: HexState[] }[] {
  const claims: { ownerId: number; hexes: HexState[] }[] = [];
  const visited = new Set<HexState>();
  for (const start of state.hexes) {
    if (start.attackerId !== null) continue;
    if (visited.has(start)) continue;
    const regionOwnerId = start.ownerId;
    const region: HexState[] = [];
    const queue = [start];
    visited.add(start);
    while (queue.length > 0) {
      const hex = queue.pop()!;
      region.push(hex);
      for (const [dq, dr] of NEIGHBOR_OFFSETS) {
        const nq = hex.q + dq;
        const nr = hex.r + dr;
        if (!isInBounds(state, nq, nr)) continue;
        const neighbor = findHex(state, nq, nr);
        if (neighbor === undefined) continue;
        if (neighbor.attackerId !== null) continue;
        if (neighbor.ownerId !== regionOwnerId) continue;
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    const owner = enclosureOwner(state, region);
    if (owner !== null && owner !== regionOwnerId) {
      for (const hex of region) hex.ownerId = owner;
      claims.push({ ownerId: owner, hexes: region });
    }
  }
  return claims;
}

export function applyCut(state: GameState, playerId: number): HexState[] {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.eliminated) return [];
  const owned = state.hexes.filter((h) => h.ownerId === playerId);
  if (owned.length === 0) return [];
  const components: HexState[][] = [];
  const visited = new Set<HexState>();
  for (const start of owned) {
    if (visited.has(start)) continue;
    const component: HexState[] = [];
    const queue = [start];
    visited.add(start);
    while (queue.length > 0) {
      const hex = queue.pop()!;
      component.push(hex);
      for (const [dq, dr] of NEIGHBOR_OFFSETS) {
        const neighbor = findHex(state, hex.q + dq, hex.r + dr);
        if (!neighbor || neighbor.ownerId !== playerId || visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    components.push(component);
  }
  if (components.length <= 1) return [];
  let main = components[0];
  if (player.capital) {
    main = components.find((c) => c.some((h) => h.q === player.capital!.q && h.r === player.capital!.r)) ?? components[0];
  }
  const cut: HexState[] = [];
  for (const component of components) {
    if (component === main) continue;
    for (const hex of component) {
      hex.ownerId = null;
      cut.push(hex);
    }
  }
  return cut;
}

function enclosureOwner(state: GameState, region: HexState[]): number | null {
  const inRegion = new Set(region);
  let owner: number | null = null;
  for (const hex of region) {
    for (const [dq, dr] of NEIGHBOR_OFFSETS) {
      const nq = hex.q + dq;
      const nr = hex.r + dr;
      if (!isInBounds(state, nq, nr)) return null;
      const neighbor = findHex(state, nq, nr);
      if (neighbor === undefined) return null;
      if (inRegion.has(neighbor)) continue;
      if (neighbor.ownerId === null || neighbor.attackerId !== null) return null;
      if (owner === null) owner = neighbor.ownerId;
      else if (owner !== neighbor.ownerId) return null;
    }
  }
  return owner;
}

export function computeWinner(state: GameState): void {
  if (state.winnerId !== null) return;
  const target = winHexCount(state.hexes.length);
  for (const player of state.players) {
    if (hexCount(state, player.id) >= target) {
      state.winnerId = player.id;
      return;
    }
  }
}
