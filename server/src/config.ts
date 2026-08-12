import type { Terrain } from './map.js';

function number(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (Number.isFinite(value)) return value;
  console.warn(`Некорректный конфиг ${name}=${raw}, использую ${fallback}`);
  return fallback;
}

export const config = {
  terrainCosts: {
    grass: number('CONQUEST_COST_GRASS', 150),
    desert: number('CONQUEST_COST_DESERT', 200),
    forest: number('CONQUEST_COST_FOREST', 250),
    water: number('CONQUEST_COST_WATER', 350),
    mountain: number('CONQUEST_COST_MOUNTAIN', 450),
    mine: number('CONQUEST_COST_MINE', 450),
  } as Record<Terrain, number>,
  mineChance: number('CONQUEST_MINE_CHANCE', 0.1),
  basePoints: number('CONQUEST_BASE_POINTS', 1000),
  limitPerHex: number('CONQUEST_LIMIT_PER_HEX', 50),
  incomePerHex: number('CONQUEST_INCOME_PER_HEX', 2),
  mineIncomeBonus: number('CONQUEST_MINE_INCOME_BONUS', 3),
  captureTicks: number('CONQUEST_CAPTURE_TICKS', 5),
  drainPerTick: number('CONQUEST_DRAIN_PER_TICK', 10),
  aiActionIntervalMs: number('CONQUEST_AI_ACTION_INTERVAL_MS', 1000),
  tickIntervalMs: number('CONQUEST_TICK_INTERVAL_MS', 500),
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
};
