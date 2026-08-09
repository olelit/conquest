export type Terrain = 'grass' | 'forest' | 'mountain' | 'water' | 'desert';

export interface Hex {
  q: number;
  r: number;
  terrain: Terrain;
}

export const TERRAIN_COLORS: Record<Terrain, string> = {
  grass: '#7cb342',
  forest: '#2e7d32',
  mountain: '#9e9e9e',
  water: '#42a5f5',
  desert: '#ffcc80',
};

export const TERRAIN_LABELS: Record<Terrain, string> = {
  grass: 'Равнина',
  forest: 'Лес',
  mountain: 'Горы',
  water: 'Вода',
  desert: 'Пустыня',
};
