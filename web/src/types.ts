export type Terrain = 'grass' | 'forest' | 'mountain' | 'water' | 'desert' | 'mine';

export type MapType = 'normal' | 'long' | 'island' | 'round';

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface MapInfo {
  label: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  recommendedAi: number;
}

export const MAP_INFO: Record<MapType, MapInfo> = {
  normal: { label: 'Обычная', description: 'прямоугольник 16×12', minPlayers: 2, maxPlayers: 5, recommendedAi: 1 },
  long: { label: 'Длинная', description: 'полоса 24×9', minPlayers: 2, maxPlayers: 4, recommendedAi: 1 },
  island: { label: 'Остров', description: 'овал с водой по краям', minPlayers: 2, maxPlayers: 4, recommendedAi: 1 },
  round: { label: 'Круглая', description: 'круг радиусом 9', minPlayers: 2, maxPlayers: 6, recommendedAi: 1 },
};

export const PLAYER_COLORS = ['#9c27b0', '#e53935', '#00897b', '#fb8c00', '#1e88e5', '#43a047'];

export function playerColor(playerId: number): string {
  return PLAYER_COLORS[(playerId - 1) % PLAYER_COLORS.length];
}

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
  points: number | null;
  hexCount: number;
  income: number | null;
  limit: number | null;
  isAi: boolean;
  capital: { q: number; r: number } | null;
  eliminated: boolean;
  relation: 'self' | 'ally' | 'enemy';
}

export interface GameState {
  players: Player[];
  hexes: Hex[];
  winnerId: number | null;
  captureTicks: number;
  pendingProposals: { from: number; kind: 'peace' | 'alliance' }[];
}

export interface RoomLobbyInfo {
  id: number;
  name: string;
  mapType: MapType;
  maxPlayers: number;
  humans: number;
}

export interface RoomSlot {
  id: number;
  name: string;
  isAi: boolean;
}

export interface RoomView {
  id: number;
  name: string;
  mapType: MapType;
  maxPlayers: number;
  status: 'waiting' | 'playing';
  aiMode: boolean;
  hostPlayerId: number | null;
  slots: RoomSlot[];
  paused: boolean;
  game: GameState | null;
  log: string[];
}

export type ClientMessage =
  | { type: 'capture'; q: number; r: number; army?: number }
  | { type: 'attack'; q: number; r: number; points: number }
  | { type: 'defend'; q: number; r: number; points: number }
  | { type: 'pause' }
  | { type: 'restart' }
  | { type: 'menu' }
  | { type: 'leave-room' }
  | { type: 'start-solo'; mapType: MapType; aiCount: number; difficulty: Difficulty }
  | { type: 'create-room'; mapType: MapType; maxPlayers: number }
  | { type: 'join-room'; roomId: number }
  | { type: 'start-room' }
  | { type: 'auth'; token: string }
  | { type: 'declare-war'; q: number; r: number }
  | { type: 'propose'; q: number; r: number; kind: 'peace' | 'alliance' }
  | { type: 'respond-proposal'; q: number; r: number; accept: boolean };

export interface AuthProfile {
  sub: string;
  email: string;
  name: string;
}

export type ServerMessage =
  | {
      type: 'state';
      playerId: number | null;
      auth: AuthProfile | null;
      rooms: RoomLobbyInfo[];
      room: RoomView | null;
    }
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
