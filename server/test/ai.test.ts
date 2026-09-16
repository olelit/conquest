import { describe, expect, it } from 'vitest';
import { MAP_COLUMNS, MAP_ROWS } from '../src/map.js';
import type { GameState, HexState } from '../src/rules.js';
import { declareWar } from '../src/rules.js';
import { chooseAiAction, chooseDiplomacyAction } from '../src/ai.js';

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

function makeDiploState(hexes: Partial<HexState>[], aiPoints = 1000, playerPoints = 1000, thirdPoints = 1000): GameState {
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
  return {
    players: [{ id: 2, points: aiPoints }, { id: 1, points: playerPoints }, { id: 3, points: thirdPoints }],
    hexes: h,
    columns: MAP_COLUMNS,
    rows: MAP_ROWS,
    winnerId: null,
    diplomacy: new Map(),
  };
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
  it('строит крепость при свободном слоте и приграничном гексе', () => {
    const hexes: Partial<HexState>[] = [];
    for (let i = 0; i < 15; i++) hexes.push({ q: i, r: 5, ownerId: AI });
    hexes.push({ q: 15, r: 5, ownerId: P });
    const s = makeState(hexes, 1000, 1000);
    const action = chooseAiAction(s, AI);
    expect(action!.type).toBe('build-fortress');
    const q = (action as { q: number }).q;
    expect(q).toBe(14);
    expect(s.hexes.find((h) => h.q === q && h.r === 5)!.ownerId).toBe(AI);
  });
  it('атакует слабейшего из двух соседних врагов', () => {
    const s = makeState([
      { q: 5, r: 5, ownerId: AI },
      { q: 6, r: 5, ownerId: P },
      { q: 6, r: 4, ownerId: 3 },
      { q: 7, r: 4, ownerId: 3 },
      { q: 7, r: 5, ownerId: 3 },
    ], 1000, 1000);
    s.players.push({ id: 3, points: 1000 });
    declareWar(s, AI, P);
    declareWar(s, AI, 3);
    expect(chooseAiAction(s, AI)).toEqual({ type: 'attack', q: 6, r: 5, points: 150 });
  });
  it('при равенстве клеток атакует врага с меньшими очками', () => {
    const s = makeState([
      { q: 5, r: 5, ownerId: AI },
      { q: 6, r: 5, ownerId: P },
      { q: 6, r: 4, ownerId: 3 },
    ], 1000, 500);
    s.players.push({ id: 3, points: 1000 });
    declareWar(s, AI, P);
    declareWar(s, AI, 3);
    expect(chooseAiAction(s, AI)).toEqual({ type: 'attack', q: 6, r: 5, points: 150 });
  });
  it('внутри выбранного врага атакует самый дешёвый террейн', () => {
    const s = makeState([
      { q: 5, r: 5, ownerId: AI },
      { q: 6, r: 5, ownerId: P, terrain: 'forest' },
      { q: 5, r: 4, ownerId: P, terrain: 'grass' },
      { q: 6, r: 4, ownerId: 3 },
      { q: 7, r: 4, ownerId: 3 },
      { q: 7, r: 5, ownerId: 3 },
    ], 1000, 1000);
    s.players.push({ id: 3, points: 1000 });
    declareWar(s, AI, P);
    declareWar(s, AI, 3);
    expect(chooseAiAction(s, AI)).toEqual({ type: 'attack', q: 5, r: 4, points: 150 });
  });
  it('приоритет 4: избегает тонкого выступа в 1 клетку — предпочитает компактное расширение', () => {
    const s = makeState([
      { q: 2, r: 1, ownerId: AI },
      { q: 2, r: 2, ownerId: AI },
      { q: 5, r: 7, ownerId: AI },
      { q: 5, r: 8, ownerId: AI },
      { q: 6, r: 8, ownerId: AI },
      { q: 12, r: 3, ownerId: P },
      { q: 1, r: 1, terrain: 'water' },
      { q: 3, r: 1, terrain: 'water' },
      { q: 2, r: 0, terrain: 'water' },
      { q: 3, r: 0, terrain: 'water' },
      { q: 1, r: 2, terrain: 'water' },
      { q: 3, r: 2, terrain: 'water' },
      { q: 1, r: 3, terrain: 'water' },
      { q: 4, r: 7, terrain: 'water' },
      { q: 5, r: 6, terrain: 'water' },
      { q: 6, r: 6, terrain: 'water' },
      { q: 4, r: 8, terrain: 'water' },
      { q: 4, r: 9, terrain: 'water' },
      { q: 5, r: 9, terrain: 'water' },
      { q: 7, r: 8, terrain: 'water' },
      { q: 6, r: 9, terrain: 'water' },
      { q: 7, r: 7, terrain: 'water' },
    ]);
    expect(chooseAiAction(s, AI)).toEqual({ type: 'capture', q: 6, r: 7 });
  });
});

describe('chooseDiplomacyAction', () => {
  it('объявляет войну соседу, когда планирует атаку (граница + очки + перевес)', () => {
    const s = makeDiploState([
      { q: 7, r: 5, ownerId: AI },
      { q: 6, r: 5, ownerId: P },
    ]);
    expect(chooseDiplomacyAction(s, AI, { scout: { hexCount: 1, points: 100 } })).toEqual({ type: 'declare-war', targetId: P });
  });
  it('не объявляет войну без общей границы', () => {
    const s = makeDiploState([
      { q: 7, r: 5, ownerId: AI },
      { q: 10, r: 10, ownerId: P },
    ], 2000, 100);
    expect(chooseDiplomacyAction(s, AI, { scout: { hexCount: 1, points: 100 } })).toBeNull();
  });
  it('не объявляет войну, если очков не хватает на атаку', () => {
    const s = makeDiploState([
      { q: 7, r: 5, ownerId: AI },
      { q: 6, r: 5, ownerId: P, terrain: 'mountain' },
    ], 100, 100);
    expect(chooseDiplomacyAction(s, AI, { scout: { hexCount: 1, points: 100 } })).toBeNull();
  });
  it('объявляет войну при равенстве сил, даже если очков меньше', () => {
    const s = makeDiploState([
      { q: 7, r: 5, ownerId: AI },
      { q: 6, r: 5, ownerId: P },
    ], 500, 2000);
    expect(chooseDiplomacyAction(s, AI, { scout: { hexCount: 1, points: 2000 } })).toEqual({ type: 'declare-war', targetId: P });
  });
  it('не предлагает мир другому ИИ — предустановка победить всех', () => {
    const s = makeDiploState([
      { q: 7, r: 5, ownerId: AI },
      { q: 6, r: 5, ownerId: 3 },
      { q: 5, r: 5, ownerId: 3 },
      { q: 5, r: 6, ownerId: 3 },
    ]);
    s.players.find((p) => p.id === 3)!.isAi = true;
    declareWar(s, AI, 3);
    expect(chooseDiplomacyAction(s, AI, { scout: { hexCount: 0, points: 1000 } })).toBeNull();
  });
  it('не объявляет войну, если цель сильнее — вместо этого предлагает союз', () => {
    const s = makeDiploState([
      { q: 7, r: 5, ownerId: AI },
      { q: 6, r: 5, ownerId: P },
      { q: 5, r: 5, ownerId: P },
      { q: 5, r: 6, ownerId: P },
    ]);
    const action = chooseDiplomacyAction(s, AI, { scout: { hexCount: 3, points: 1000 } });
    expect(action).not.toEqual({ type: 'declare-war', targetId: P });
    expect(action).toEqual({ type: 'propose-alliance', targetId: P });
  });
  it('предлагает мир, когда проигрывает в войне', () => {
    const s = makeDiploState([
      { q: 7, r: 5, ownerId: AI },
      { q: 6, r: 5, ownerId: P },
      { q: 5, r: 5, ownerId: P },
      { q: 5, r: 6, ownerId: P },
    ]);
    declareWar(s, AI, P);
    expect(chooseDiplomacyAction(s, AI, { scout: { hexCount: 3, points: 1000 } })).toEqual({ type: 'propose-peace', targetId: P });
  });
  it('предлагает союз, когда у цели война с третьим игроком', () => {
    const s = makeDiploState([
      { q: 7, r: 5, ownerId: AI },
      { q: 6, r: 5, ownerId: P },
      { q: 5, r: 5, ownerId: P },
      { q: 5, r: 6, ownerId: P },
      { q: 10, r: 10, ownerId: 3 },
      { q: 11, r: 10, ownerId: 3 },
    ], 1000, 1000, 1000);
    declareWar(s, 3, P);
    expect(chooseDiplomacyAction(s, AI, { scout: { hexCount: 3, points: 1000 } })).toEqual({ type: 'propose-alliance', targetId: P });
  });
  it('не предлагает союз без выгоды', () => {
    const s = makeDiploState([
      { q: 7, r: 5, ownerId: AI },
      { q: 6, r: 5, ownerId: P },
    ], 100, 1000, 1000);
    expect(chooseDiplomacyAction(s, AI, { scout: { hexCount: 1, points: 1000 } })).toBeNull();
  });
  it('объявляет войну через зазор в 1 нейтральный гекс', () => {
    const s = makeDiploState([
      { q: 7, r: 5, ownerId: AI },
      { q: 9, r: 5, ownerId: P },
    ]);
    expect(chooseDiplomacyAction(s, AI, { scout: { hexCount: 1, points: 100 } })).toEqual({ type: 'declare-war', targetId: P });
  });
  it('не объявляет войну, если между территориями 2+ нейтральных гекса', () => {
    const s = makeDiploState([
      { q: 7, r: 5, ownerId: AI },
      { q: 10, r: 5, ownerId: P },
    ], 2000, 100);
    expect(chooseDiplomacyAction(s, AI, { scout: { hexCount: 1, points: 100 } })).toBeNull();
  });
  it('не предлагает союз цели без территории', () => {
    const s = makeDiploState([
      { q: 7, r: 5, ownerId: AI },
      { q: 10, r: 10, ownerId: 3 },
      { q: 11, r: 10, ownerId: 3 },
    ], 1000, 1000, 1000);
    expect(chooseDiplomacyAction(s, AI, { scout: { hexCount: 0, points: 1000 } })).toBeNull();
  });
  it('не предлагает союз без контакта', () => {
    const s = makeDiploState([
      { q: 7, r: 5, ownerId: AI },
      { q: 10, r: 10, ownerId: P },
      { q: 12, r: 10, ownerId: 3 },
      { q: 12, r: 11, ownerId: 3 },
    ]);
    expect(chooseDiplomacyAction(s, AI, { scout: { hexCount: 1, points: 1000 } })).toBeNull();
  });
});

describe('chooseAiAction: обучение', () => {
  const training = { training: true, maxHexes: 5 };
  it('ждёт, пока у игрока не появится гекс', () => {
    const s = makeState([]);
    s.players[0].isAi = true;
    expect(chooseAiAction(s, AI, training)).toBeNull();
  });
  it('первый гекс — свободный неводный сосед игрока, самый дешёвый', () => {
    const s = makeState([{ q: 4, r: 4, ownerId: P }]);
    s.players[0].isAi = true;
    for (const h of s.hexes) h.terrain = 'water';
    const find = (q: number, r: number) => s.hexes.find((h) => h.q === q && h.r === r)!;
    find(5, 4).terrain = 'forest';
    find(4, 5).terrain = 'grass';
    expect(chooseAiAction(s, AI, training)).toEqual({ type: 'capture', q: 4, r: 5 });
  });
  it('при лимите гексов не захватывает нейтралов', () => {
    const hexes: Partial<HexState>[] = [];
    for (let i = 0; i < 5; i++) hexes.push({ q: 10 + i, r: 8, ownerId: AI });
    const s = makeState(hexes);
    s.players[0].isAi = true;
    expect(chooseAiAction(s, AI, training)).toBeNull();
  });
  it('при лимите гексов отвечает атакой на войне', () => {
    const hexes: Partial<HexState>[] = [{ q: 4, r: 4, ownerId: P }];
    for (let i = 0; i < 5; i++) hexes.push({ q: 5 + i, r: 4, ownerId: AI });
    const s = makeState(hexes);
    s.players[0].isAi = true;
    declareWar(s, AI, P);
    expect(chooseAiAction(s, AI, training)).toEqual({ type: 'attack', q: 4, r: 4, points: 150 });
  });
});
