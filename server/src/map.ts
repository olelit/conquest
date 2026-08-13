import { config } from './config.js';

export const TERRAINS = ['grass', 'forest', 'mountain', 'water', 'desert', 'mine'] as const;
export type Terrain = (typeof TERRAINS)[number];

export type MapType = 'normal' | 'long' | 'island' | 'round' | 'belarus';

export interface Hex {
  q: number;
  r: number;
  terrain: Terrain;
}

export interface MapPreset {
  columns: number;
  rows: number;
  minPlayers: number;
  maxPlayers: number;
  recommendedAi: number;
  qOffset: number;
}

export const MAP_PRESETS: Record<MapType, MapPreset> = {
  normal: { columns: 16, rows: 12, minPlayers: 2, maxPlayers: 5, recommendedAi: 1, qOffset: 0 },
  long: { columns: 24, rows: 9, minPlayers: 2, maxPlayers: 4, recommendedAi: 1, qOffset: 0 },
  island: { columns: 15, rows: 13, minPlayers: 2, maxPlayers: 4, recommendedAi: 1, qOffset: 0 },
  round: { columns: 19, rows: 19, minPlayers: 2, maxPlayers: 6, recommendedAi: 1, qOffset: 0 },
  belarus: { columns: 45, rows: 24, minPlayers: 2, maxPlayers: 5, recommendedAi: 1, qOffset: -9 },
};

export const MAP_COLUMNS = MAP_PRESETS.normal.columns;
export const MAP_ROWS = MAP_PRESETS.normal.rows;
export const MOUNTAIN_TO_MINE_CHANCE = config.mineChance;

// Контур Беларуси построен по ASCII-эталону (github.com/acidus99/ascii-countries, by.80.txt):
// шапка на севере (Витебск), западная диагональ (Литва→Польша→Брест),
// широкое тело и нижний выступ юго-востока. u = q + r/2.
const BELARUS_ROWS: [number, number][] = [
  [22, 22],
  [20, 26],
  [17, 30],
  [15, 31],
  [14, 30],
  [12, 31],
  [10, 30],
  [9, 30],
  [8, 30],
  [7, 30],
  [3, 32],
  [-3, 32],
  [-3, 34],
  [-3, 35],
  [-3, 33],
  [-4, 28],
  [-4, 28],
  [-5, 28],
  [-8, 28],
  [-9, 27],
  [-7, 25],
  [-8, 23],
  [-9, 21],
  [13, 21],
];

export function generateMap(type: MapType = 'normal'): Hex[] {
  const preset = MAP_PRESETS[type];
  const hexes: Hex[] = [];
  const qMin = preset.qOffset;
  for (let r = 0; r < preset.rows; r++) {
    for (let q = qMin; q < qMin + preset.columns; q++) {
      if (type === 'round' && !isInCircle(q, r)) continue;
      const terrain = isLand(type, preset, q, r) ? randomTerrain() : 'water';
      hexes.push({ q, r, terrain });
    }
  }
  return hexes;
}

function isInCircle(q: number, r: number): boolean {
  const cq = (MAP_PRESETS.round.columns - 1) / 2;
  const cr = (MAP_PRESETS.round.rows - 1) / 2;
  return hexDistance(q, r, cq, cr) <= 9;
}

function isLand(type: MapType, preset: MapPreset, q: number, r: number): boolean {
  switch (type) {
    case 'normal':
    case 'long':
      return true;
    case 'round':
      return true;
    case 'island': {
      const cq = (preset.columns - 1) / 2;
      const cr = (preset.rows - 1) / 2;
      const dq = q - cq;
      const dr = r - cr;
      return (dq * dq) / 49 + (dr * dr) / 36 <= 1;
    }
    case 'belarus': {
      const row = BELARUS_ROWS[r];
      if (!row) return false;
      return q >= row[0] && q <= row[1];
    }
  }
}

function hexDistance(aq: number, ar: number, bq: number, br: number): number {
  const dq = aq - bq;
  const dr = ar - br;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

const LAND_WEIGHTS: { terrain: Terrain; weight: number }[] = [
  { terrain: 'grass', weight: 45 },
  { terrain: 'forest', weight: 25 },
  { terrain: 'desert', weight: 20 },
  { terrain: 'mountain', weight: 10 },
];

function randomTerrain(): Terrain {
  const total = LAND_WEIGHTS.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = Math.random() * total;
  for (const entry of LAND_WEIGHTS) {
    roll -= entry.weight;
    if (roll <= 0) {
      let terrain = entry.terrain;
      if (terrain === 'mountain' && Math.random() < config.mineChance) terrain = 'mine';
      return terrain;
    }
  }
  return LAND_WEIGHTS[LAND_WEIGHTS.length - 1].terrain;
}
