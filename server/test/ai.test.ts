import { describe, expect, it } from 'vitest';
import { MAP_COLUMNS, MAP_ROWS } from '../src/map.js';
import type { GameState, HexState } from '../src/rules.js';
import { hasAdjacentOwner } from '../src/rules.js';
import { chooseAiAction } from '../src/ai.js';

function makeState(hexes: Partial<HexState>[], aiPoints = 1000, playerPoints = 1000): GameState {
  const h: HexState[] = [];
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let q = 0; q < MAP_COLUMNS; q++) {
      h.push({ q, r, terrain: 'grass', ownerId: null, attackerId: null, defenderId: null, attackInvestment: 0, defenseInvestment: 0, battleProgress: 0 });
    }
  }
  for (const p of hexes) {
    const hex = h.find((x) => x.q === p.q && x.r === p.r);
    if (hex) Object.assign(hex, p);
  }
  return { players: [{ id: 2, points: aiPoints }, { id: 1, points: playerPoints }], hexes: h, winnerId: null };
}

const P = 1;
const AI = 2;

describe('chooseAiAction', () => {
  it('приоритет 1: враг захватывает наш гекс — вкладываемся с перевесом', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 400, battleProgress: 3 }]);
    expect(chooseAiAction(s, AI, P)).toEqual({ type: 'defend', q: 6, r: 5, points: 401 });
  });
  it('приоритет 1: враг захватывает нейтральный гекс у нашей границы — вступаемся', () => {
    const s = makeState([{ q: 5, r: 5, attackerId: P, attackInvestment: 400, battleProgress: 3 }, { q: 6, r: 5, ownerId: AI }]);
    expect(chooseAiAction(s, AI, P)).toEqual({ type: 'defend', q: 5, r: 5, points: 401 });
  });
  it('приоритет 2: топ-ап обороны при перевесе врага в атаке', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 400, defenseInvestment: 100 }], 1000, 1000);
    expect(chooseAiAction(s, AI, P)).toEqual({ type: 'defend', q: 6, r: 5, points: 301 });
  });
  it('приоритет 2: оборона сильнее — не топ-апится, а занимается расширением', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 100, defenseInvestment: 400 }]);
    expect(chooseAiAction(s, AI, P)).toEqual({ type: 'capture', q: 6, r: 4 });
  });
  it('приоритет 3: топ-ап своей атаки, если враг контрит', () => {
    const s = makeState([{ q: 5, r: 5, attackerId: AI, defenseInvestment: 400, attackInvestment: 100 }, { q: 6, r: 5, ownerId: AI }]);
    expect(chooseAiAction(s, AI, P)).toEqual({ type: 'attack', q: 5, r: 5, points: 301 });
  });
  it('приоритет 3: не оспаривает нейтральный гекс не у своей границы', () => {
    const s = makeState([{ q: 2, r: 2, attackerId: P, attackInvestment: 400 }, { q: 6, r: 5, ownerId: AI }], 0);
    expect(chooseAiAction(s, AI, P)).toBeNull();
  });
  it('приоритет 4: захватывает самый дешёвый нейтральный соседний гекс', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI }, { q: 5, r: 5, terrain: 'mountain' }, { q: 6, r: 4, terrain: 'grass' }]);
    expect(chooseAiAction(s, AI, P)).toEqual({ type: 'capture', q: 6, r: 4 });
  });
  it('приоритет 4: не захватывает, если не хватает очков', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI }, { q: 5, r: 5, terrain: 'mountain' }], 100);
    expect(chooseAiAction(s, AI, P)).toBeNull();
  });
  it('приоритет 5: атакует границу врага за стоимость гекса, когда нечего захватывать', () => {
    const s = makeState([
      { q: 6, r: 5, ownerId: AI, terrain: 'mountain' },
      { q: 5, r: 5, ownerId: P },
      { q: 7, r: 5, terrain: 'mountain' },
      { q: 6, r: 4, terrain: 'mountain' },
      { q: 6, r: 6, terrain: 'mountain' },
      { q: 7, r: 4, terrain: 'mountain' },
      { q: 5, r: 6, terrain: 'mountain' },
    ], 400);
    expect(chooseAiAction(s, AI, P)).toEqual({ type: 'attack', q: 5, r: 5, points: 150 });
  });
  it('приоритет 5: не атакует, если очков меньше стоимости гекса', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI }, { q: 5, r: 5, ownerId: P }], 100);
    expect(chooseAiAction(s, AI, P)).toBeNull();
  });
  it('приоритет 0: без гексов — первый бесплатный захват вдали от игрока', () => {
    const s = makeState([{ q: 8, r: 6, ownerId: P }]);
    const action = chooseAiAction(s, AI, P);
    expect(action).toEqual({ type: 'capture', q: expect.any(Number), r: expect.any(Number) });
    const hex = s.hexes.find((h) => h.q === action!.q && h.r === action!.r)!;
    expect(hex.ownerId).toBeNull();
    expect(hasAdjacentOwner(s, hex.q, hex.r, P)).toBe(false);
  });
  it('приоритет 0: без гексов и у игрока тоже — захватывает первый нейтральный гекс', () => {
    const s = makeState([]);
    expect(chooseAiAction(s, AI, P)).toEqual({ type: 'capture', q: 0, r: 0 });
  });
  it('без доступных действий — null', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI }], 50);
    expect(chooseAiAction(s, AI, P)).toBeNull();
  });
});
