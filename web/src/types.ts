export type Terrain = 'grass' | 'forest' | 'mountain' | 'water' | 'desert' | 'mine';

export interface Hex {
  q: number;
  r: number;
  terrain: Terrain;
  ownerId: number | null;
  attackerId: number | null;
  defenderId: number | null;
  attackInvestment: number;
  defenseInvestment: number;
  battleProgress: number;
}

export interface Player {
  id: number;
  name: string;
  points: number;
  hexCount: number;
  income: number;
  isAi: boolean;
}

export interface GameState {
  phase: 'menu' | 'waiting' | 'game';
  mode: 'ai' | 'human';
  players: Player[];
  winnerId: number | null;
  paused: boolean;
  captureTicks: number;
  log: string[];
  hexes: Hex[];
}

export type ClientMessage =
  | { type: 'capture'; q: number; r: number; army?: number }
  | { type: 'attack'; q: number; r: number; points: number }
  | { type: 'defend'; q: number; r: number; points: number }
  | { type: 'pause' }
  | { type: 'menu' }
  | { type: 'start-ai' }
  | { type: 'start-human' }
  | { type: 'cancel-waiting' }
  | { type: 'auth'; token: string };

export interface AuthProfile {
  sub: string;
  email: string;
  name: string;
}

export type ServerMessage =
  | { type: 'state'; playerId: number | null; waiting: boolean; auth: AuthProfile | null; game: GameState }
  | { type: 'error'; message: string };

export const TERRAIN_COLORS: Record<Terrain, string> = {
  grass: '#7cb342',
  forest: '#2e7d32',
  mountain: '#9e9e9e',
  water: '#42a5f5',
  desert: '#ffcc80',
  mine: '#b45309',
};

export const TERRAIN_LABELS: Record<Terrain, string> = {
  grass: 'Равнина',
  forest: 'Лес',
  mountain: 'Горы',
  water: 'Вода',
  desert: 'Пустыня',
  mine: 'Шахта',
};

export const PLAYER_COLOR: Record<'human' | 'ai', string> = {
  human: '#9c27b0',
  ai: '#e53935',
};

export const TERRAIN_COSTS: Record<Terrain, number> = {
  grass: 150,
  desert: 200,
  forest: 250,
  water: 350,
  mountain: 450,
  mine: 450,
};

const NEIGHBOR_OFFSETS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, -1],
  [-1, 1],
];

export function isAdjacent(a: Hex, b: Hex): boolean {
  return NEIGHBOR_OFFSETS.some(([dq, dr]) => a.q + dq === b.q && a.r + dr === b.r);
}
