import {
  findHex,
  fortressCount,
  fortressLimit,
  hasAdjacentOwner,
  hasPeacefulNeighbor,
  hexCount,
  isAdjacent,
  pointLimit,
  relation,
  terrainCost,
  type GameState,
  type HexState,
} from './rules.js';

export type AiAction =
  | { type: 'defend'; q: number; r: number; points: number }
  | { type: 'capture'; q: number; r: number }
  | { type: 'attack'; q: number; r: number; points: number }
  | { type: 'build-fortress'; q: number; r: number };

export type AiDiplomacyAction =
  | { type: 'declare-war'; targetId: number }
  | { type: 'propose-peace'; targetId: number }
  | { type: 'propose-alliance'; targetId: number };

export interface DiplomacyContext {
  scout: { hexCount: number; points: number } | null;
}

export interface AiOptions {
  training?: boolean;
  maxHexes?: number;
}

const NEIGHBOR_OFFSETS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, -1],
  [-1, 1],
];

export function chooseAiAction(state: GameState, aiId: number, opts: AiOptions = {}): AiAction | null {
  const ai = state.players.find((p) => p.id === aiId);
  if (!ai) return null;
  if (ai.eliminated) return null;

  const aiHexCount = hexCount(state, aiId);
  if (aiHexCount === 0) {
    return chooseFirstCapture(state, aiId, opts.training === true);
  }

  for (const hex of state.hexes) {
    if (hex.attackerId === null || hex.attackerId === aiId) continue;
    const contestable =
      hex.ownerId === aiId || (hex.ownerId === null && hasAdjacentOwner(state, hex.q, hex.r, aiId));
    if (!contestable) continue;
    if (hex.attackInvestment >= hex.defenseInvestment) {
      const invest = Math.min(ai.points, hex.attackInvestment - hex.defenseInvestment + 1);
      if (invest >= 1) return { type: 'defend', q: hex.q, r: hex.r, points: invest };
    }
  }

  for (const hex of state.hexes) {
    if (hex.attackerId !== aiId) continue;
    if (hex.attackInvestment <= hex.defenseInvestment) {
      const invest = Math.min(ai.points, hex.defenseInvestment - hex.attackInvestment + 1);
      if (invest >= 1) return { type: 'attack', q: hex.q, r: hex.r, points: invest };
    }
  }

  // крепость: свободный слот, запас лимита и приграничный гекс
  if (fortressCount(state, aiId) < fortressLimit(hexCount(state, aiId))) {
    const count = hexCount(state, aiId);
    if (ai.points <= pointLimit(count, fortressCount(state, aiId) + 1)) {
      const borderHex = state.hexes.find(
        (h) =>
          h.ownerId === aiId &&
          !h.fortress &&
          h.attackerId === null &&
          state.hexes.some((n) => n.ownerId !== null && n.ownerId !== aiId && isAdjacent(h, n)),
      );
      if (borderHex) return { type: 'build-fortress', q: borderHex.q, r: borderHex.r };
    }
  }

  const enemyHexes = state.hexes.filter(
    (hex) =>
      hex.ownerId !== null &&
      hex.ownerId !== aiId &&
      relation(state, aiId, hex.ownerId) === 'war' &&
      hasAdjacentOwner(state, hex.q, hex.r, aiId),
  );
  if (enemyHexes.length > 0) {
    // атака слабейшего соседнего врага: минимум клеток, при равенстве — минимум очков
    const weakness = (ownerId: number) => {
      const owner = state.players.find((p) => p.id === ownerId);
      return { hexes: hexCount(state, ownerId), points: owner?.points ?? 0 };
    };
    const owners = [...new Set(enemyHexes.map((h) => h.ownerId as number))];
    owners.sort((a, b) => {
      const wa = weakness(a);
      const wb = weakness(b);
      return wa.hexes - wb.hexes || wa.points - wb.points;
    });
    const target = owners[0];
    const hex = enemyHexes
      .filter((h) => h.ownerId === target)
      .sort((a, b) => terrainCost(a.terrain) - terrainCost(b.terrain))[0];
    const cost = terrainCost(hex.terrain);
    if (ai.points >= cost) return { type: 'attack', q: hex.q, r: hex.r, points: cost };
  }

  const capturesAllowed =
    !opts.training || aiHexCount < (opts.maxHexes ?? Number.POSITIVE_INFINITY);

  const affordableNeutral = capturesAllowed
    ? state.hexes
        .filter((hex) => hex.ownerId === null && hex.attackerId === null && hasAdjacentOwner(state, hex.q, hex.r, aiId))
        .filter((hex) => terrainCost(hex.terrain) <= ai.points)
        .filter((hex) => !hasPeacefulNeighbor(state, hex.q, hex.r, aiId))
        .sort((a, b) => captureScore(state, a, aiId) - captureScore(state, b, aiId))
    : [];
  if (affordableNeutral.length > 0) {
    const hex = affordableNeutral[0];
    return { type: 'capture', q: hex.q, r: hex.r };
  }

  return null;
}

function aiNeighborCount(state: GameState, q: number, r: number, aiId: number): number {
  let count = 0;
  for (const [dq, dr] of NEIGHBOR_OFFSETS) {
    const neighbor = findHex(state, q + dq, r + dr);
    if (neighbor !== undefined && neighbor.ownerId === aiId) count++;
  }
  return count;
}

// Расширение должно оставаться компактным: коридор шириной в одну клетку
// сосед легко отрезает одной атакой, и отрезанный фрагмент становится нейтральным.
// Чем дешевле результат, тем приоритетнее захват: заполнение впадин (много своих
// соседей) удешевляется, удлинение тонких выступов — дорожает.
function captureScore(state: GameState, hex: HexState, aiId: number): number {
  let myNeighbors = 0;
  let bridge: HexState | null = null;
  for (const [dq, dr] of NEIGHBOR_OFFSETS) {
    const neighbor = findHex(state, hex.q + dq, hex.r + dr);
    if (neighbor !== undefined && neighbor.ownerId === aiId) {
      myNeighbors++;
      bridge = neighbor;
    }
  }
  let score = terrainCost(hex.terrain);
  if (myNeighbors > 1) score -= (myNeighbors - 1) * 50;
  if (myNeighbors === 1 && bridge !== null && aiNeighborCount(state, bridge.q, bridge.r, aiId) <= 2) {
    score += 150;
  }
  return score;
}

function hasAnyAdjacentOwner(state: GameState, q: number, r: number): boolean {
  for (const [dq, dr] of NEIGHBOR_OFFSETS) {
    const hex = findHex(state, q + dq, r + dr);
    if (hex !== undefined && hex.ownerId !== null) return true;
  }
  return false;
}

function chooseFirstCapture(state: GameState, aiId: number, training = false): AiAction | null {
  if (training) {
    const humanHexes = state.hexes.filter((hex) => {
      if (hex.ownerId === null) return false;
      const owner = state.players.find((p) => p.id === hex.ownerId);
      return owner !== undefined && !owner.isAi && !owner.eliminated;
    });
    if (humanHexes.length === 0) return null;
    const candidates = state.hexes.filter(
      (hex) =>
        hex.ownerId === null &&
        hex.attackerId === null &&
        hex.terrain !== 'water' &&
        humanHexes.some((h) => isAdjacent(h, hex)),
    );
    if (candidates.length === 0) return null;
    const best = candidates.sort(
      (a, b) => terrainCost(a.terrain) - terrainCost(b.terrain) || a.q - b.q || a.r - b.r,
    )[0];
    return { type: 'capture', q: best.q, r: best.r };
  }
  const free = state.hexes.filter(
    (hex) => hex.ownerId === null && hex.attackerId === null && hex.terrain !== 'water',
  );
  if (free.length === 0) return null;
  const enemyHexes = state.hexes.filter((hex) => hex.ownerId !== null && hex.ownerId !== aiId);
  if (enemyHexes.length === 0) {
    return { type: 'capture', q: free[0].q, r: free[0].r };
  }
  const candidates = free.filter((hex) => !hasAnyAdjacentOwner(state, hex.q, hex.r));
  if (candidates.length === 0) return null;
  let best = candidates[0];
  let bestDist = -Infinity;
  for (const hex of candidates) {
    const dist = Math.min(...enemyHexes.map((ph) => hexDistance(hex, ph)));
    if (dist > bestDist) {
      bestDist = dist;
      best = hex;
    }
  }
  return { type: 'capture', q: best.q, r: best.r };
}

function hexDistance(a: { q: number; r: number }, b: { q: number; r: number }): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export function chooseDiplomacyAction(
  state: GameState,
  aiId: number,
  ctx: DiplomacyContext,
): AiDiplomacyAction | null {
  const ai = state.players.find((p) => p.id === aiId);
  if (!ai || ai.eliminated) return null;
  const aiHexes = hexCount(state, aiId);
  const strength = (id: number): { hexes: number; points: number } => {
    const p = state.players.find((x) => x.id === id);
    return { hexes: hexCount(state, id), points: p?.points ?? 0 };
  };
  const scoutStr = { hexes: ctx.scout?.hexCount ?? 0, points: ctx.scout?.points ?? 0 };

  for (const target of state.players) {
    if (target.id === aiId || target.eliminated) continue;
    if (relation(state, aiId, target.id) !== 'peace') continue;
    let border: HexState | null = null;
    for (const hex of state.hexes) {
      if (hex.ownerId !== target.id) continue;
      if (!inContactZone(state, hex, aiId)) continue;
      if (border === null || terrainCost(hex.terrain) < terrainCost(border.terrain)) border = hex;
    }
    if (!border) continue;
    const targetStr = target.isAi ? strength(target.id) : scoutStr;
    const aiStr = strength(aiId);
    if (aiStr.hexes < targetStr.hexes) continue;
    if (ai.points >= terrainCost(border.terrain)) {
      return { type: 'declare-war', targetId: target.id };
    }
  }

  for (const target of state.players) {
    if (target.id === aiId || target.eliminated) continue;
    if (target.isAi) continue;
    if (relation(state, aiId, target.id) !== 'war') continue;
    if (aiHexes < hexCount(state, target.id)) {
      return { type: 'propose-peace', targetId: target.id };
    }
  }

  const thirdStrongest = Math.max(
    0,
    ...state.players.filter((p) => p.id !== aiId && !p.eliminated).map((p) => hexCount(state, p.id)),
  );
  for (const target of state.players) {
    if (target.id === aiId || target.eliminated) continue;
    const rel = relation(state, aiId, target.id);
    if (rel === 'war' || rel === 'alliance') continue;
    const targetStr = target.isAi ? strength(target.id) : scoutStr;
    if (targetStr.hexes < 1) continue;
    if (!isInContact(state, aiId, target.id)) continue;
    const aiStr = strength(aiId);
    const targetAtWar = state.players.some(
      (p) => p.id !== target.id && p.id !== aiId && relation(state, target.id, p.id) === 'war',
    );
    const beneficial =
      targetAtWar || targetStr.hexes > aiStr.hexes || thirdStrongest > Math.max(aiStr.hexes, targetStr.hexes);
    if (beneficial) {
      return { type: 'propose-alliance', targetId: target.id };
    }
  }

  return null;
}

// Контактная зона: гекс цели примыкает к территории ИИ напрямую либо
// отделён одним нейтральным гексом (правило зазора — мирные соседи не могут
// захватить пограничный гекс, поэтому прямой границы может не быть).
function inContactZone(state: GameState, hex: HexState, aiId: number): boolean {
  if (hasAdjacentOwner(state, hex.q, hex.r, aiId)) return true;
  for (const [dq, dr] of NEIGHBOR_OFFSETS) {
    const n = findHex(state, hex.q + dq, hex.r + dr);
    if (n === undefined || n.ownerId !== null) continue;
    if (hasAdjacentOwner(state, n.q, n.r, aiId)) return true;
  }
  return false;
}

// Есть ли у цели хотя бы один гекс в контактной зоне ИИ.
function isInContact(state: GameState, aiId: number, targetId: number): boolean {
  for (const hex of state.hexes) {
    if (hex.ownerId !== targetId) continue;
    if (inContactZone(state, hex, aiId)) return true;
  }
  return false;
}
