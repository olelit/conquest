export type Terrain = 'grass' | 'forest' | 'mountain' | 'water' | 'desert' | 'mine';

export type MapType = 'normal' | 'long' | 'island' | 'round';

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface MapInfo {
  labelKey: string;
  descriptionKey: string;
  minPlayers: number;
  maxPlayers: number;
  recommendedAi: number;
}

export const MAP_INFO: Record<MapType, MapInfo> = {
  normal: { labelKey: 'map.normal', descriptionKey: 'map.normalDesc', minPlayers: 2, maxPlayers: 5, recommendedAi: 1 },
  long: { labelKey: 'map.long', descriptionKey: 'map.longDesc', minPlayers: 2, maxPlayers: 4, recommendedAi: 1 },
  island: { labelKey: 'map.island', descriptionKey: 'map.islandDesc', minPlayers: 2, maxPlayers: 4, recommendedAi: 1 },
  round: { labelKey: 'map.round', descriptionKey: 'map.roundDesc', minPlayers: 2, maxPlayers: 6, recommendedAi: 1 },
};

const paletteCache = new Map<string, Map<number, string>>();

export function playerPalette(ids: readonly number[]): Map<number, string> {
  const sorted = [...new Set(ids)].sort((a, b) => a - b);
  const key = sorted.join(',');
  const cached = paletteCache.get(key);
  if (cached) return cached;
  const count = Math.max(sorted.length, 1);
  const map = new Map<number, string>();
  sorted.forEach((id, i) => {
    const hue = ((i * 360) / count + 12) % 360;
    map.set(id, `hsl(${Math.round(hue)}, 85%, 55%)`);
  });
  paletteCache.set(key, map);
  return map;
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
  fortress?: boolean;
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

export interface PendingProposal {
  from: number;
  to: number;
  kind: 'peace' | 'alliance';
}

export interface GameState {
  players: Player[];
  hexes: Hex[];
  winnerId: number | null;
  majorityHolderId: number | null;
  captureTicks: number;
  pendingProposals: PendingProposal[];
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
  loadTest: boolean;
  training: boolean;
  hostPlayerId: number | null;
  slots: RoomSlot[];
  paused: boolean;
  game: GameState | null;
  log: { text: string; kind: 'info' | 'war' | 'diplomacy' }[];
}

export type ClientMessage =
  | { type: 'capture'; q: number; r: number; army?: number }
  | { type: 'attack'; q: number; r: number; points: number }
  | { type: 'defend'; q: number; r: number; points: number }
  | { type: 'pause' }
  | { type: 'end-game' }
  | { type: 'restart' }
  | { type: 'menu' }
  | { type: 'leave-room' }
  | { type: 'start-solo'; mapType: MapType; aiCount: number; difficulty: Difficulty; training?: boolean }
  | { type: 'create-room'; mapType: MapType; maxPlayers: number }
  | { type: 'join-room'; roomId: number }
  | { type: 'start-room' }
  | { type: 'auth'; token: string }
  | { type: 'declare-war'; q: number; r: number }
  | { type: 'propose'; q: number; r: number; kind: 'peace' | 'alliance' }
  | { type: 'respond-proposal'; q: number; r: number; accept: boolean }
  | { type: 'start-load-test'; aiCount: number }
  | { type: 'build-fortress'; q: number; r: number }
  | { type: 'remove-fortress'; q: number; r: number };

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
  grass: 'terrain.grass',
  forest: 'terrain.forest',
  mountain: 'terrain.mountain',
  water: 'terrain.water',
  desert: 'terrain.desert',
  mine: 'terrain.mine',
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
