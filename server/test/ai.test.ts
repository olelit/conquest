import { describe, expect, it } from 'vitest';
import { MAP_COLUMNS, MAP_ROWS } from '../src/map.js';
import type { GameState, HexState } from '../src/rules.js';
import { declareWar } from '../src/rules.js';
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
  return { players: [{ id: 2, points: aiPoints }, { id: 1, points: playerPoints }], hexes: h, columns: MAP_COLUMNS, rows: MAP_ROWS, winnerId: null };
}

const P = 1;
const AI = 2;

describe('chooseAiAction', () => {
  it('приоритет 1: враг захватывает наш гекс — вкладываемся с перевесом', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 400, battleProgress: 3 }]);
    expect(chooseAiAction(s, AI)).toEqual({ type: 'defend', q: 6, r: 5, points: 401 });
  });
  it('приоритет 1: враг захватывает нейтральный гекс у нашей границы — вступаемся', () => {
    const s = makeState([{ q: 5, r: 5, attackerId: P, attackInvestment: 400, battleProgress: 3 }, { q: 6, r: 5, ownerId: AI }]);
    expect(chooseAiAction(s, AI)).toEqual({ type: 'defend', q: 5, r: 5, points: 401 });
  });
  it('приоритет 2: топ-ап обороны при перевесе врага в атаке', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 400, defenseInvestment: 100 }], 1000, 1000);
    expect(chooseAiAction(s, AI)).toEqual({ type: 'defend', q: 6, r: 5, points: 301 });
  });
  it('приоритет 2: оборона сильнее — не топ-апится, а занимается расширением', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 100, defenseInvestment: 400 }]);
    expect(chooseAiAction(s, AI)).toEqual({ type: 'capture', q: 6, r: 4 });
  });
  it('приоритет 3: топ-ап своей атаки, если враг контрит', () => {
    const s = makeState([{ q: 5, r: 5, attackerId: AI, defenseInvestment: 400, attackInvestment: 100 }, { q: 6, r: 5, ownerId: AI }]);
    expect(chooseAiAction(s, AI)).toEqual({ type: 'attack', q: 5, r: 5, points: 301 });
  });
  it('приоритет 3: не оспаривает нейтральный гекс не у своей границы', () => {
    const s = makeState([{ q: 2, r: 2, attackerId: P, attackInvestment: 400 }, { q: 6, r: 5, ownerId: AI }], 0);
    expect(chooseAiAction(s, AI)).toBeNull();
  });
  it('приоритет 4: захватывает самый дешёвый нейтральный соседний гекс', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI }, { q: 5, r: 5, terrain: 'mountain' }, { q: 6, r: 4, terrain: 'grass' }]);
    expect(chooseAiAction(s, AI)).toEqual({ type: 'capture', q: 6, r: 4 });
  });
  it('приоритет 4: не захватывает, если не хватает очков', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI }, { q: 5, r: 5, terrain: 'mountain' }], 100);
    expect(chooseAiAction(s, AI)).toBeNull();
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
    declareWar(s, AI, P);
    expect(chooseAiAction(s, AI)).toEqual({ type: 'attack', q: 5, r: 5, points: 150 });
  });
  it('приоритет 5: не атакует, если очков меньше стоимости гекса', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI }, { q: 5, r: 5, ownerId: P }], 100);
    expect(chooseAiAction(s, AI)).toBeNull();
  });
  it('приоритет 0: без гексов — первый бесплатный захват вдали от игрока', () => {
    const s = makeState([{ q: 8, r: 6, ownerId: P }]);
    const action = chooseAiAction(s, AI);
    expect(action).toEqual({ type: 'capture', q: expect.any(Number), r: expect.any(Number) });
    const hex = s.hexes.find((h) => h.q === action!.q && h.r === action!.r)!;
    expect(hex.ownerId).toBeNull();
    const neighbors = [
      [hex.q + 1, hex.r],
      [hex.q - 1, hex.r],
      [hex.q, hex.r + 1],
      [hex.q, hex.r - 1],
      [hex.q + 1, hex.r - 1],
      [hex.q - 1, hex.r + 1],
    ];
    expect(
      neighbors.some(([nq, nr]) => {
        const n = s.hexes.find((h) => h.q === nq && h.r === nr);
        return n !== undefined && n.ownerId !== null;
      }),
    ).toBe(false);
  });
  it('приоритет 0: без гексов и у игрока тоже — захватывает первый нейтральный гекс', () => {
    const s = makeState([]);
    expect(chooseAiAction(s, AI)).toEqual({ type: 'capture', q: 0, r: 0 });
  });
  it('без доступных действий — null', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI }], 50);
    expect(chooseAiAction(s, AI)).toBeNull();
  });
  it('N игроков: защищает свой гекс от любого атакующего', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: 2, attackerId: 1, attackInvestment: 400, battleProgress: 3 }]);
    expect(chooseAiAction(s, 2)).toEqual({ type: 'defend', q: 6, r: 5, points: 401 });
  });
  it('N игроков: атакует границу любого соперника', () => {
    const s = makeState([
      { q: 6, r: 5, ownerId: 2, terrain: 'mountain' },
      { q: 5, r: 5, ownerId: 1 },
      { q: 7, r: 5, terrain: 'mountain' },
      { q: 6, r: 4, terrain: 'mountain' },
      { q: 6, r: 6, terrain: 'mountain' },
      { q: 7, r: 4, terrain: 'mountain' },
      { q: 5, r: 6, terrain: 'mountain' },
    ], 400);
    declareWar(s, AI, P);
    expect(chooseAiAction(s, 2)).toEqual({ type: 'attack', q: 5, r: 5, points: 150 });
  });
  it('первый захват не выбирает воду', () => {
    const s = makeState([{ q: 0, r: 0, terrain: 'water' }, { q: 8, r: 6, ownerId: 1 }]);
    const action = chooseAiAction(s, 2)!;
    const hex = s.hexes.find((h) => h.q === action.q && h.r === action.r)!;
    expect(hex.terrain).not.toBe('water');
  });
});
