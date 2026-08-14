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
} from './rules.js';

export type AiAction =
  | { type: 'defend'; q: number; r: number; points: number }
  | { type: 'capture'; q: number; r: number }
  | { type: 'attack'; q: number; r: number; points: number }
  | { type: 'build-fortress'; q: number; r: number };

export function chooseAiAction(state: GameState, aiId: number): AiAction | null {
  const ai = state.players.find((p) => p.id === aiId);
  if (!ai) return null;
  if (ai.eliminated) return null;

  const aiHexCount = hexCount(state, aiId);
  if (aiHexCount === 0) {
    return chooseFirstCapture(state, aiId);
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

  const affordableNeutral = state.hexes
    .filter((hex) => hex.ownerId === null && hex.attackerId === null && hasAdjacentOwner(state, hex.q, hex.r, aiId))
    .filter((hex) => terrainCost(hex.terrain) <= ai.points)
    .filter((hex) => !hasPeacefulNeighbor(state, hex.q, hex.r, aiId))
    .sort((a, b) => terrainCost(a.terrain) - terrainCost(b.terrain));
  if (affordableNeutral.length > 0) {
    const hex = affordableNeutral[0];
    return { type: 'capture', q: hex.q, r: hex.r };
  }

  const enemyHexes = state.hexes.filter(
    (hex) =>
      hex.ownerId !== null &&
      hex.ownerId !== aiId &&
      relation(state, aiId, hex.ownerId) === 'war' &&
      hasAdjacentOwner(state, hex.q, hex.r, aiId),
  );
  if (enemyHexes.length > 0) {
    const hex = enemyHexes.sort((a, b) => terrainCost(a.terrain) - terrainCost(b.terrain))[0];
    const cost = terrainCost(hex.terrain);
    if (ai.points >= cost) return { type: 'attack', q: hex.q, r: hex.r, points: cost };
  }

  return null;
}

function hasAnyAdjacentOwner(state: GameState, q: number, r: number): boolean {
  const offsets: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, -1],
    [-1, 1],
  ];
  for (const [dq, dr] of offsets) {
    const hex = findHex(state, q + dq, r + dr);
    if (hex !== undefined && hex.ownerId !== null) return true;
  }
  return false;
}

function chooseFirstCapture(state: GameState, aiId: number): AiAction | null {
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
