import { findHex, hexCount, hasAdjacentOwner, terrainCost, type GameState } from './rules.js';

export type AiAction =
  | { type: 'defend'; q: number; r: number; points: number }
  | { type: 'capture'; q: number; r: number }
  | { type: 'attack'; q: number; r: number; points: number };

export function chooseAiAction(state: GameState, aiId: number, playerId: number): AiAction | null {
  const ai = state.players.find((p) => p.id === aiId);
  if (!ai) return null;

  const aiHexCount = hexCount(state, aiId);
  if (aiHexCount === 0) {
    return chooseFirstCapture(state, playerId);
  }

  for (const hex of state.hexes) {
    if (hex.attackerId === null || hex.attackerId !== playerId) continue;
    const contestable =
      hex.ownerId === aiId || (hex.ownerId === null && hasAdjacentOwner(state, hex.q, hex.r, aiId));
    if (!contestable) continue;
    if (hex.defenseInvestment === 0 && hex.attackInvestment > 0) {
      const invest = Math.min(ai.points, hex.attackInvestment + 1);
      if (invest >= 1) return { type: 'defend', q: hex.q, r: hex.r, points: invest };
    }
    if (hex.attackInvestment >= hex.defenseInvestment) {
      const invest = Math.min(ai.points, hex.attackInvestment - hex.defenseInvestment + 1);
      if (invest >= 1) return { type: 'defend', q: hex.q, r: hex.r, points: invest };
    }
    return null;
  }

  for (const hex of state.hexes) {
    if (hex.attackerId !== aiId) continue;
    if (hex.attackInvestment <= hex.defenseInvestment) {
      const invest = Math.min(ai.points, hex.defenseInvestment - hex.attackInvestment + 1);
      if (invest >= 1) return { type: 'attack', q: hex.q, r: hex.r, points: invest };
    }
  }

  const ownMaxCost = Math.max(0, ...state.hexes.filter((h) => h.ownerId === aiId).map((h) => terrainCost(h.terrain)));
  const affordableNeutral = state.hexes
    .filter((hex) => hex.ownerId === null && hex.attackerId === null && hasAdjacentOwner(state, hex.q, hex.r, aiId))
    .filter((hex) => terrainCost(hex.terrain) + ownMaxCost <= ai.points)
    .sort((a, b) => terrainCost(a.terrain) - terrainCost(b.terrain));
  if (affordableNeutral.length > 0) {
    const hex = affordableNeutral[0];
    return { type: 'capture', q: hex.q, r: hex.r };
  }

  const playerHexes = state.hexes.filter((hex) => hex.ownerId === playerId && hasAdjacentOwner(state, hex.q, hex.r, aiId));
  if (playerHexes.length > 0) {
    const hex = playerHexes.sort((a, b) => terrainCost(a.terrain) - terrainCost(b.terrain))[0];
    const cost = terrainCost(hex.terrain);
    if (ai.points >= cost) return { type: 'attack', q: hex.q, r: hex.r, points: cost };
  }

  return null;
}

function chooseFirstCapture(state: GameState, playerId: number): AiAction | null {
  const free = state.hexes.filter((hex) => hex.ownerId === null && hex.attackerId === null);
  if (free.length === 0) return null;
  const playerHexes = state.hexes.filter((hex) => hex.ownerId === playerId);
  if (playerHexes.length === 0) {
    return { type: 'capture', q: free[0].q, r: free[0].r };
  }
  const candidates = free.filter((hex) => !hasAdjacentOwner(state, hex.q, hex.r, playerId));
  if (candidates.length === 0) return null;
  let best = candidates[0];
  let bestDist = -Infinity;
  for (const hex of candidates) {
    const dist = Math.min(...playerHexes.map((ph) => hexDistance(hex, ph)));
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
