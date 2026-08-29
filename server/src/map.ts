import { config } from './config.js';

export const TERRAINS = ['grass', 'forest', 'mountain', 'water', 'desert', 'mine'] as const;
export type Terrain = (typeof TERRAINS)[number];

export type MapType = string;

export type MapShape = 'rect' | 'ellipse' | 'circle' | 'blobs' | 'ridge';

export interface Blob {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

export interface RidgeLine {
  a: { q: number; r: number };
  b: { q: number; r: number };
  width: number;
}

export interface MapParams {
  rx?: number;
  ry?: number;
  radius?: number;
  blobs?: Blob[];
  ridge?: RidgeLine;
}

export interface MapDefinition {
  key: string;
  name: string;
  shape: MapShape;
  columns: number;
  rows: number;
  minPlayers: number;
  maxPlayers: number;
  recommendedAi: number;
  qOffset: number;
  params: MapParams;
}

export const DEFAULT_MAPS: MapDefinition[] = [
  { key: 'normal', name: 'Normal', shape: 'rect', columns: 16, rows: 12, minPlayers: 2, maxPlayers: 5, recommendedAi: 1, qOffset: 0, params: {} },
  { key: 'long', name: 'Long', shape: 'rect', columns: 24, rows: 9, minPlayers: 2, maxPlayers: 4, recommendedAi: 1, qOffset: 0, params: {} },
  { key: 'island', name: 'Island', shape: 'ellipse', columns: 15, rows: 13, minPlayers: 2, maxPlayers: 4, recommendedAi: 1, qOffset: 0, params: { rx: 7, ry: 6 } },
  { key: 'round', name: 'Round', shape: 'circle', columns: 19, rows: 19, minPlayers: 2, maxPlayers: 6, recommendedAi: 1, qOffset: 0, params: { radius: 9 } },
  {
    key: 'continents',
    name: 'Continents',
    shape: 'blobs',
    columns: 22,
    rows: 14,
    minPlayers: 2,
    maxPlayers: 5,
    recommendedAi: 2,
    qOffset: 0,
    params: {
      blobs: [
        { x: 7, y: 7, rx: 5.5, ry: 6 },
        { x: 10, y: 3.5, rx: 2.8, ry: 2.5 },
        { x: 16.5, y: 8.5, rx: 4.5, ry: 4 },
        { x: 13, y: 7.5, rx: 2.2, ry: 1.2 },
      ],
    },
  },
  {
    key: 'peninsula',
    name: 'Peninsula',
    shape: 'blobs',
    columns: 18,
    rows: 14,
    minPlayers: 2,
    maxPlayers: 4,
    recommendedAi: 1,
    qOffset: 0,
    params: {
      blobs: [
        { x: 8, y: 4, rx: 7, ry: 4.5 },
        { x: 9.5, y: 8, rx: 2.5, ry: 1.5 },
        { x: 10, y: 10.5, rx: 1.6, ry: 3 },
      ],
    },
  },
  {
    key: 'ridge',
    name: 'Ridge',
    shape: 'ridge',
    columns: 18,
    rows: 12,
    minPlayers: 2,
    maxPlayers: 4,
    recommendedAi: 1,
    qOffset: 0,
    params: { ridge: { a: { q: 9, r: 0.5 }, b: { q: 9, r: 11.5 }, width: 1.4 } },
  },
  { key: 'tutorial', name: 'Tutorial', shape: 'rect', columns: 9, rows: 7, minPlayers: 2, maxPlayers: 2, recommendedAi: 1, qOffset: 0, params: {} },
];

export const MAP_COLUMNS = DEFAULT_MAPS[0].columns;
export const MAP_ROWS = DEFAULT_MAPS[0].rows;

export interface Hex {
  q: number;
  r: number;
  terrain: Terrain;
}

let catalog = new Map<string, MapDefinition>(DEFAULT_MAPS.map((m) => [m.key, m]));

export function setMapCatalog(defs: MapDefinition[]): void {
  catalog = new Map(defs.map((m) => [m.key, m]));
}

export function getMap(key: string): MapDefinition | null {
  return catalog.get(key) ?? null;
}

export function listMaps(): MapDefinition[] {
  return [...catalog.values()];
}

export function generateMap(def: MapDefinition): Hex[] {
  const hexes: Hex[] = [];
  const qMin = def.qOffset;
  for (let r = 0; r < def.rows; r++) {
    for (let q = qMin; q < qMin + def.columns; q++) {
      if (def.shape === 'circle' && !isInCircle(def, q, r)) continue;
      hexes.push({ q, r, terrain: terrainAt(def, q, r) });
    }
  }
  return hexes;
}

function isInCircle(def: MapDefinition, q: number, r: number): boolean {
  const radius = def.params.radius ?? 0;
  const cq = (def.columns - 1) / 2;
  const cr = (def.rows - 1) / 2;
  return hexDistance(q, r, cq, cr) <= radius;
}

function isLand(def: MapDefinition, q: number, r: number): boolean {
  switch (def.shape) {
    case 'rect':
    case 'ridge':
      return true;
    case 'ellipse':
      return inEllipse(q, r, (def.columns - 1) / 2, (def.rows - 1) / 2, def.params.rx ?? 0, def.params.ry ?? 0);
    case 'circle':
      return true;
    case 'blobs':
      return (def.params.blobs ?? []).some((b) => inEllipse(q, r, b.x, b.y, b.rx, b.ry));
  }
}

function inEllipse(q: number, r: number, cx: number, cy: number, rx: number, ry: number): boolean {
  const dq = q - cx;
  const dr = r - cy;
  return (dq * dq) / (rx * rx) + (dr * dr) / (ry * ry) <= 1;
}

function hexDistance(aq: number, ar: number, bq: number, br: number): number {
  const dq = aq - bq;
  const dr = ar - br;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

function terrainAt(def: MapDefinition, q: number, r: number): Terrain {
  if (!isLand(def, q, r)) return 'water';
  if (def.shape === 'ridge' && isNearRidge(def, q, r)) {
    return Math.random() < config.mineChance ? 'mine' : 'mountain';
  }
  return randomTerrain();
}

function isNearRidge(def: MapDefinition, q: number, r: number): boolean {
  const ridge = def.params.ridge;
  if (!ridge) return false;
  return distToSegment(q, r, ridge.a, ridge.b) <= ridge.width;
}

function distToSegment(q: number, r: number, a: { q: number; r: number }, b: { q: number; r: number }): number {
  const dx = b.q - a.q;
  const dy = b.r - a.r;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(q - a.q, r - a.r);
  let t = ((q - a.q) * dx + (r - a.r) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(q - (a.q + t * dx), r - (a.r + t * dy));
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