import type { Terrain } from './map.js';
import { config } from './config.js';

export const TERRAIN_COSTS: Record<Terrain, number> = config.terrainCosts;

export const BASE_POINTS = config.basePoints;
export const LIMIT_PER_HEX = config.limitPerHex;
export const INCOME_BY_TERRAIN: Record<Terrain, number> = config.terrainIncomes;
export const CAPTURE_TICKS = config.captureTicks;
export const DRAIN_PER_TICK = config.drainPerTick;
export const FORTRESS_DRAIN_PER_TICK = Math.round(DRAIN_PER_TICK * 1.25);

export interface PlayerState {
  id: number;
  name?: string;
  points: number;
  isAi?: boolean;
  incomeMultiplier?: number;
  capital?: { q: number; r: number } | null;
  eliminated?: boolean;
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
  fortress: boolean;
}

export interface GameState {
  players: PlayerState[];
  hexes: HexState[];
  columns: number;
  rows: number;
  winnerId: number | null;
  diplomacy?: DiplomacyMap;
  qOffset?: number;
  hexIndex?: Map<string, HexState>;
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
  return state.hexIndex?.get(`${q},${r}`) ?? state.hexes.find((h) => h.q === q && h.r === r);
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

export function pointLimit(hexCount: number, fortresses = 0): number {
  return Math.max(0, BASE_POINTS + hexCount * LIMIT_PER_HEX - 100 * fortresses);
}

export function winHexCount(totalHexes: number): number {
  return Math.floor(totalHexes / 2) + 1;
}

export function terrainCost(terrain: Terrain): number {
  return TERRAIN_COSTS[terrain];
}

export function fortressLimit(hexCount: number): number {
  return Math.floor(hexCount / 10);
}

export function fortressCount(state: GameState, playerId: number): number {
  return state.hexes.reduce((n, h) => n + (h.ownerId === playerId && h.fortress ? 1 : 0), 0);
}

export function isFortressProtected(state: GameState, hex: HexState): boolean {
  if (hex.fortress) return true;
  const defender = hex.defenderId ?? hex.ownerId;
  if (defender === null) return false;
  return NEIGHBOR_OFFSETS.some(([dq, dr]) => {
    const nq = hex.q + dq;
    const nr = hex.r + dr;
    if (!isInBounds(state, nq, nr)) return false;
    const neighbor = findHex(state, nq, nr);
    return neighbor !== undefined && neighbor.fortress && neighbor.ownerId === defender;
  });
}

function hasGameWinner(state: GameState): boolean {
  return state.winnerId !== null;
}

function isValidPoints(points: unknown): points is number {
  return typeof points === 'number' && Number.isInteger(points) && points >= 1;
}

export type ActionValidation = { ok: true } | { ok: false; error: string };

export function validateCapture(state: GameState, playerId: number, q: number, r: number, army = 0): ActionValidation {
  if (hasGameWinner(state)) return { ok: false, error: 'Game over' };
  const hex = findHex(state, q, r);
  if (!hex) return { ok: false, error: 'Hex not found' };
  if (hex.ownerId !== null) return { ok: false, error: 'Hex is already occupied' };
  if (hex.attackerId !== null) return { ok: false, error: 'There is already a fight for this hex' };
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { ok: false, error: 'Player not found' };
  if (player.eliminated) return { ok: false, error: 'You are out of the game' };
  const count = hexCount(state, playerId);
  if (count === 0) {
    if (hex.terrain === 'water') return { ok: false, error: 'The first hex cannot be on water' };
    if (hasAdjacentOtherOwner(state, q, r, playerId) && player.points - army < terrainCost(hex.terrain)) {
      return { ok: false, error: 'Not enough points for a battle at the enemy border' };
    }
    if (hasPeacefulNeighbor(state, q, r, playerId)) {
      return { ok: false, error: 'Declare war on the neighboring player first' };
    }
    return { ok: true };
  }
  if (!hasAdjacentOwner(state, q, r, playerId)) return { ok: false, error: 'Hex is not adjacent' };
  if (player.points - army < terrainCost(hex.terrain)) return { ok: false, error: 'Not enough points (part is reserved by the army)' };
  if (hasPeacefulNeighbor(state, q, r, playerId)) {
    return { ok: false, error: 'Declare war on the neighboring player first' };
  }
  return { ok: true };
}

export function validateAttack(state: GameState, playerId: number, q: number, r: number, points: number): ActionValidation {
  if (hasGameWinner(state)) return { ok: false, error: 'Game over' };
  if (!isValidPoints(points)) return { ok: false, error: 'Investment must be an integer ≥ 1' };
  const hex = findHex(state, q, r);
  if (!hex) return { ok: false, error: 'Hex not found' };
  if (hex.ownerId !== null && hex.ownerId === playerId) return { ok: false, error: 'Cannot attack your own hex' };
  if (hex.ownerId !== null && hex.ownerId !== playerId && relation(state, playerId, hex.ownerId) !== 'war') {
    return { ok: false, error: 'Declare war first' };
  }
  if (hex.ownerId === null && hex.attackerId !== playerId) return { ok: false, error: 'Neutral hexes are captured, not attacked' };
  if (hex.attackerId !== null && hex.attackerId !== playerId) return { ok: false, error: 'The opponent is already fighting for this hex' };
  if (hex.attackerId !== playerId && !hasAdjacentOwner(state, q, r, playerId)) return { ok: false, error: 'Hex is not adjacent' };
  if (hex.attackerId !== playerId && points < terrainCost(hex.terrain)) {
    return { ok: false, error: 'Minimum investment in an attack is the hex cost' };
  }
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { ok: false, error: 'Player not found' };
  if (player.eliminated) return { ok: false, error: 'You are out of the game' };
  if (player.points < points) return { ok: false, error: 'Not enough points' };
  return { ok: true };
}

export function validateDefend(state: GameState, playerId: number, q: number, r: number, points: number): ActionValidation {
  if (hasGameWinner(state)) return { ok: false, error: 'Game over' };
  if (!isValidPoints(points)) return { ok: false, error: 'Investment must be an integer ≥ 1' };
  const hex = findHex(state, q, r);
  if (!hex) return { ok: false, error: 'Hex not found' };
  if (hex.attackerId === null) return { ok: false, error: 'There is no battle here' };
  if (hex.attackerId === playerId) return { ok: false, error: 'Cannot defend your own attack' };
  if (hex.ownerId === playerId) {
    // владелец защищает свой гекс
  } else if (hex.ownerId === null) {
    if (!hasAdjacentOwner(state, q, r, playerId)) return { ok: false, error: 'Hex is not adjacent' };
  } else {
    return { ok: false, error: 'Hex belongs to someone else' };
  }
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { ok: false, error: 'Player not found' };
  if (player.eliminated) return { ok: false, error: 'You are out of the game' };
  if (player.points < points) return { ok: false, error: 'Not enough points' };
  return { ok: true };
}

export function validateBuildFortress(state: GameState, playerId: number, q: number, r: number): ActionValidation {
  if (hasGameWinner(state)) return { ok: false, error: 'Game over' };
  const hex = findHex(state, q, r);
  if (!hex) return { ok: false, error: 'Hex not found' };
  if (hex.ownerId !== playerId) return { ok: false, error: 'This is not your hex' };
  if (hex.attackerId !== null) return { ok: false, error: 'There is a battle for this hex' };
  if (hex.fortress) return { ok: false, error: 'A fortress already exists here' };
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.eliminated) return { ok: false, error: 'You are out of the game' };
  const count = hexCount(state, playerId);
  if (fortressCount(state, playerId) >= fortressLimit(count)) {
    return { ok: false, error: 'Fortress limit reached' };
  }
  if (player.points > pointLimit(count, fortressCount(state, playerId) + 1)) {
    return { ok: false, error: 'Spend points first: a fortress lowers the limit' };
  }
  return { ok: true };
}

export function buildFortress(state: GameState, playerId: number, q: number, r: number): void {
  const hex = findHex(state, q, r)!;
  hex.fortress = true;
}

export function validateRemoveFortress(state: GameState, playerId: number, q: number, r: number): ActionValidation {
  if (hasGameWinner(state)) return { ok: false, error: 'Game over' };
  const hex = findHex(state, q, r);
  if (!hex) return { ok: false, error: 'Hex not found' };
  if (hex.ownerId !== playerId || !hex.fortress) return { ok: false, error: 'There is no fortress of yours here' };
  return { ok: true };
}

export function removeFortress(state: GameState, playerId: number, q: number, r: number): void {
  const hex = findHex(state, q, r)!;
  hex.fortress = false;
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
    hex.fortress = false;
    if (isFirst && !player.capital) player.capital = { q, r };
  }
}

// Первый гекс без боя: в обучении ИИ ставится вплотную к игроку,
// поэтому правила «сначала объяви войну» и боя у границы обходятся.
export function placeFirstHex(state: GameState, playerId: number, q: number, r: number): boolean {
  const hex = findHex(state, q, r);
  if (!hex || hex.ownerId !== null || hex.attackerId !== null) return false;
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.eliminated) return false;
  hex.ownerId = playerId;
  hex.fortress = false;
  if (!player.capital) player.capital = { q, r };
  return true;
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
  loserId?: number;
}

export interface TickBattlesOptions {
  canCapture?: (hex: HexState, attackerId: number) => boolean;
}

export function tickBattles(state: GameState, opts: TickBattlesOptions = {}): BattleResult[] {
  const results: BattleResult[] = [];
  for (const hex of state.hexes) {
    if (hex.attackerId === null) continue;
    const attackerDrain = isFortressProtected(state, hex) ? FORTRESS_DRAIN_PER_TICK : DRAIN_PER_TICK;
    hex.attackInvestment = Math.max(0, hex.attackInvestment - attackerDrain);
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
      if (opts.canCapture && !opts.canCapture(hex, hex.attackerId)) {
        results.push({ q: hex.q, r: hex.r, winnerId: null });
        resetBattle(hex);
        continue;
      }
      const oldOwnerId = hex.ownerId;
      const winner = state.players.find((p) => p.id === hex.attackerId);
      if (winner) winner.points += hex.attackInvestment;
      hex.ownerId = hex.attackerId;
      hex.fortress = false;
      if (winner && !winner.capital && hexCount(state, winner.id) === 1) {
        winner.capital = { q: hex.q, r: hex.r };
      }
      results.push({ q: hex.q, r: hex.r, winnerId: hex.attackerId, loserId: oldOwnerId ?? undefined });
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
      hex.fortress = false;
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
    return sum + INCOME_BY_TERRAIN[hex.terrain];
  }, 0);
}

export function applyIncome(state: GameState): void {
  for (const player of state.players) {
    const count = hexCount(state, player.id);
    const income = Math.floor(playerIncome(state, player.id) * (player.incomeMultiplier ?? 1));
    player.points = Math.min(player.points + income, pointLimit(count, fortressCount(state, player.id)));
  }
}

export interface EnclosureClaim {
  ownerId: number;
  prevOwnerId: number | null;
  hexes: HexState[];
}

export function applyEnclosure(state: GameState): EnclosureClaim[] {
  const claims: EnclosureClaim[] = [];
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
      if (regionOwnerId !== null && relation(state, owner, regionOwnerId) !== 'war') continue;
      for (const hex of region) {
        hex.ownerId = owner;
        hex.fortress = false;
      }
      claims.push({ ownerId: owner, prevOwnerId: regionOwnerId, hexes: region });
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
      hex.fortress = false;
      cut.push(hex);
    }
  }
  return cut;
}

export interface NewAiInfo {
  id: number;
  hexes: HexState[];
}

export interface EliminationResult {
  eliminatedId: number;
  neutralHexes: HexState[];
  newAis: NewAiInfo[];
  capturerId: number | null;
}

export function eliminateIfCapitalLost(
  state: GameState,
  playerId: number,
  rng: () => number = Math.random,
): EliminationResult | null {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.eliminated) return null;
  if (!player.capital) return null;
  const capitalHex = findHex(state, player.capital.q, player.capital.r);
  if (capitalHex && capitalHex.ownerId === playerId) return null;
  player.eliminated = true;
  for (const hex of state.hexes) {
    if (hex.attackerId === playerId || hex.defenderId === playerId) resetBattle(hex);
  }
  const capturerId = capitalHex ? capitalHex.ownerId : null;
  const owned = state.hexes.filter((h) => h.ownerId === playerId);
  const neutralHexes: HexState[] = [];
  const newAis: NewAiInfo[] = [];
  if (owned.length > 0) {
    if (rng() < 0.1 && owned.length >= 2) {
      const k = Math.min(Math.max(Math.round(owned.length / 10), 2), 5);
      const perAi = Math.floor(owned.length / k);
      const baseId = Math.max(0, ...state.players.map((p) => p.id)) + 1;
      for (let i = 0; i < k; i++) {
        const chunk = owned.slice(i * perAi, (i + 1) * perAi);
        if (chunk.length === 0) continue;
        newAis.push({ id: baseId + i, hexes: chunk });
      }
      for (let i = k * perAi; i < owned.length; i++) {
        owned[i].ownerId = null;
        owned[i].fortress = false;
        neutralHexes.push(owned[i]);
      }
    } else {
      for (const hex of owned) {
        hex.ownerId = null;
        hex.fortress = false;
        neutralHexes.push(hex);
      }
    }
  }
  for (const ai of newAis) {
    for (const hex of ai.hexes) {
      hex.ownerId = ai.id;
      hex.fortress = false;
    }
  }
  return { eliminatedId: playerId, neutralHexes, newAis, capturerId };
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
  const remaining = state.players.filter((p) => !p.eliminated);
  if (remaining.length === 1 && hexCount(state, remaining[0].id) > 0) {
    state.winnerId = remaining[0].id;
  }
}

export type DiplomacyRelation = 'peace' | 'war' | 'alliance';
export type DiplomacyMap = Map<string, DiplomacyRelation>;

function diplomacyKey(a: number, b: number): string {
  return `${Math.min(a, b)}-${Math.max(a, b)}`;
}

export function relation(state: GameState, a: number, b: number): DiplomacyRelation {
  return state.diplomacy?.get(diplomacyKey(a, b)) ?? 'peace';
}

export function alliesOf(state: GameState, playerId: number): number[] {
  return state.players.filter((p) => p.id !== playerId && relation(state, playerId, p.id) === 'alliance').map((p) => p.id);
}

export function declareWar(state: GameState, a: number, b: number): void {
  const d = state.diplomacy ?? (state.diplomacy = new Map());
  d.set(diplomacyKey(a, b), 'war');
  const alliesA = alliesOf(state, a);
  const alliesB = alliesOf(state, b);
  for (const sa of alliesA) d.set(diplomacyKey(sa, b), 'war');
  for (const sb of alliesB) d.set(diplomacyKey(sb, a), 'war');
  for (const sa of alliesA) {
    for (const sb of alliesB) d.set(diplomacyKey(sa, sb), 'war');
  }
}

export function makePeace(state: GameState, a: number, b: number): void {
  const d = state.diplomacy ?? (state.diplomacy = new Map());
  d.set(diplomacyKey(a, b), 'peace');
  cancelBattlesBetween(state, a, b);
}

export function makeAlliance(state: GameState, a: number, b: number): void {
  const d = state.diplomacy ?? (state.diplomacy = new Map());
  d.set(diplomacyKey(a, b), 'alliance');
  cancelBattlesBetween(state, a, b);
}

function cancelBattlesBetween(state: GameState, a: number, b: number): void {
  for (const hex of state.hexes) {
    if (hex.attackerId === null) continue;
    const involved = (pid: number | null) => pid === b || pid === a;
    if (involved(hex.attackerId) && (involved(hex.ownerId) || involved(hex.defenderId))) {
      resetBattle(hex);
    }
  }
}

export function hasPeacefulNeighbor(state: GameState, q: number, r: number, playerId: number): boolean {
  return NEIGHBOR_OFFSETS.some(([dq, dr]) => {
    const nq = q + dq;
    const nr = r + dr;
    if (!isInBounds(state, nq, nr)) return false;
    const hex = findHex(state, nq, nr);
    return hex !== undefined && hex.ownerId !== null && hex.ownerId !== playerId && relation(state, playerId, hex.ownerId) !== 'war';
  });
}
