import { describe, expect, it } from 'vitest';
import { DEFAULT_MAPS, generateMap, MAP_COLUMNS, MAP_ROWS, TERRAINS } from '../src/map.js';

function def(key: string) {
  const d = DEFAULT_MAPS.find((m) => m.key === key);
  if (!d) throw new Error(`no map ${key}`);
  return d;
}

function landHexes(key: string) {
  return generateMap(def(key)).filter((h) => h.terrain !== 'water');
}

function connectedLand(key: string): boolean {
  const land = landHexes(key);
  const seen = new Set<string>();
  const stack = [`${land[0].q},${land[0].r}`];
  seen.add(stack[0]);
  const offsets = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
  while (stack.length > 0) {
    const [q, r] = stack.pop()!.split(',').map(Number);
    for (const [dq, dr] of offsets) {
      const nq = q + dq;
      const nr = r + dr;
      const key2 = `${nq},${nr}`;
      if (seen.has(key2)) continue;
      if (land.some((h) => h.q === nq && h.r === nr)) {
        seen.add(key2);
        stack.push(key2);
      }
    }
  }
  return seen.size === land.length;
}

describe('generateMap', () => {
  it('обычная: ровно 16*12 = 192 гекса', () => {
    expect(generateMap(def('normal'))).toHaveLength(MAP_COLUMNS * MAP_ROWS);
  });
  it('возвращает уникальные координаты', () => {
    const hexes = generateMap(def('normal'));
    const keys = new Set(hexes.map((h) => `${h.q},${h.r}`));
    expect(keys.size).toBe(hexes.length);
  });
  it('использует только известные типы местности', () => {
    for (const hex of generateMap(def('normal'))) {
      expect(TERRAINS).toContain(hex.terrain);
    }
  });
  it('длинная: 24*9 = 216 гексов', () => {
    expect(generateMap(def('long'))).toHaveLength(216);
  });
  it('круглая: 271 гекс (круг радиусом 9)', () => {
    expect(generateMap(def('round'))).toHaveLength(271);
  });
  it('остров: суша 120–160 гексов, остальное — вода', () => {
    const hexes = generateMap(def('island'));
    expect(hexes).toHaveLength(15 * 13);
    const land = hexes.filter((h) => h.terrain !== 'water').length;
    expect(land).toBeGreaterThanOrEqual(120);
    expect(land).toBeLessThanOrEqual(160);
    expect(hexes.filter((h) => h.terrain === 'water').length).toBeGreaterThan(0);
  });
  it('гор меньше 15% и больше 5% на большой выборке', () => {
    const hexes = Array.from({ length: 50 }, () => generateMap(def('normal'))).flat();
    const mountains = hexes.filter((h) => h.terrain === 'mountain').length;
    expect(mountains / hexes.length).toBeLessThan(0.15);
    expect(mountains / hexes.length).toBeGreaterThan(0.05);
  });
  it('все гексы в границах определения карты', () => {
    for (const m of DEFAULT_MAPS) {
      for (const hex of generateMap(m)) {
        expect(hex.q).toBeGreaterThanOrEqual(m.qOffset);
        expect(hex.q).toBeLessThan(m.qOffset + m.columns);
        expect(hex.r).toBeGreaterThanOrEqual(0);
        expect(hex.r).toBeLessThan(m.rows);
      }
    }
  });
  it('материки: суша связна (перешеек соединяет два материка)', () => {
    const hexes = generateMap(def('continents'));
    const land = hexes.filter((h) => h.terrain !== 'water');
    expect(land.length).toBeGreaterThan(60);
    expect(connectedLand('continents')).toBe(true);
  });
  it('полуостров: суша связна, есть узкий южный «хвост»', () => {
    const hexes = generateMap(def('peninsula'));
    const land = hexes.filter((h) => h.terrain !== 'water');
    expect(land.length).toBeGreaterThan(60);
    expect(connectedLand('peninsula')).toBe(true);
    const bottom = land.filter((h) => h.r >= 11);
    expect(bottom.length).toBeGreaterThan(0);
    expect(bottom.length).toBeLessThan(8);
  });
  it('хребет: гряда гор по центру (колонка 9 — только горы/мины)', () => {
    const hexes = generateMap(def('ridge'));
    for (const hex of hexes) {
      if (hex.q === 9) {
        expect(['mountain', 'mine']).toContain(hex.terrain);
      }
    }
    expect(hexes.filter((h) => h.q === 9 && (h.terrain === 'mountain' || h.terrain === 'mine')).length).toBe(def('ridge').rows);
  });
  it('обучение: ровно 9*7 = 63 гекса, вся суша', () => {
    const hexes = generateMap(def('tutorial'));
    expect(hexes).toHaveLength(63);
    expect(hexes.every((h) => h.terrain !== 'water')).toBe(true);
  });
});