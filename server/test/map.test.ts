import { describe, expect, it } from 'vitest';
import { generateMap, MAP_COLUMNS, MAP_ROWS, TERRAINS } from '../src/map.js';

describe('generateMap', () => {
  it('возвращает ровно 16*12 = 192 гекса', () => {
    expect(generateMap()).toHaveLength(MAP_COLUMNS * MAP_ROWS);
  });

  it('возвращает уникальные координаты', () => {
    const hexes = generateMap();
    const keys = new Set(hexes.map((h) => `${h.q},${h.r}`));
    expect(keys.size).toBe(hexes.length);
  });

  it('использует только известные типы местности', () => {
    for (const hex of generateMap()) {
      expect(TERRAINS).toContain(hex.terrain);
    }
  });

  it('учитывает переданный размер', () => {
    expect(generateMap(3, 2)).toHaveLength(6);
  });
});
