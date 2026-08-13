import { describe, expect, it } from 'vitest';
import { generateMap, MAP_PRESETS, MAP_COLUMNS, MAP_ROWS, TERRAINS, type MapType } from '../src/map.js';

describe('generateMap', () => {
  it('обычная: ровно 16*12 = 192 гекса', () => {
    expect(generateMap('normal')).toHaveLength(MAP_COLUMNS * MAP_ROWS);
  });
  it('возвращает уникальные координаты', () => {
    const hexes = generateMap('normal');
    const keys = new Set(hexes.map((h) => `${h.q},${h.r}`));
    expect(keys.size).toBe(hexes.length);
  });
  it('использует только известные типы местности', () => {
    for (const hex of generateMap('normal')) {
      expect(TERRAINS).toContain(hex.terrain);
    }
  });
  it('длинная: 24*9 = 216 гексов', () => {
    expect(generateMap('long')).toHaveLength(216);
  });
  it('круглая: 271 гекс (круг радиусом 9)', () => {
    expect(generateMap('round')).toHaveLength(271);
  });
  it('остров: суша 120–160 гексов, остальное — вода', () => {
    const hexes = generateMap('island');
    expect(hexes).toHaveLength(15 * 13);
    const land = hexes.filter((h) => h.terrain !== 'water').length;
    expect(land).toBeGreaterThanOrEqual(120);
    expect(land).toBeLessThanOrEqual(160);
    expect(hexes.filter((h) => h.terrain === 'water').length).toBeGreaterThan(0);
  });
  it('гор меньше 15% и больше 5% на большой выборке', () => {
    const hexes = Array.from({ length: 50 }, () => generateMap('normal')).flat();
    const mountains = hexes.filter((h) => h.terrain === 'mountain').length;
    expect(mountains / hexes.length).toBeLessThan(0.15);
    expect(mountains / hexes.length).toBeGreaterThan(0.05);
  });
  it('все гексы в границах пресета', () => {
    for (const type of ['normal', 'long', 'island', 'round'] as MapType[]) {
      const preset = MAP_PRESETS[type];
      for (const hex of generateMap(type)) {
        expect(hex.q).toBeGreaterThanOrEqual(preset.qOffset);
        expect(hex.q).toBeLessThan(preset.qOffset + preset.columns);
        expect(hex.r).toBeGreaterThanOrEqual(0);
        expect(hex.r).toBeLessThan(preset.rows);
      }
    }
  });
});
