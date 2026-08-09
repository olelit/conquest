export const TERRAINS = ['grass', 'forest', 'mountain', 'water', 'desert'] as const;

export type Terrain = (typeof TERRAINS)[number];

export interface Hex {
  q: number;
  r: number;
  terrain: Terrain;
}

export const MAP_COLUMNS = 16;
export const MAP_ROWS = 12;

export function generateMap(columns = MAP_COLUMNS, rows = MAP_ROWS): Hex[] {
  const hexes: Hex[] = [];
  for (let r = 0; r < rows; r++) {
    for (let q = 0; q < columns; q++) {
      hexes.push({
        q,
        r,
        terrain: TERRAINS[Math.floor(Math.random() * TERRAINS.length)],
      });
    }
  }
  return hexes;
}
