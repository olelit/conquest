import { ref } from 'vue';
import { isAdjacent, type GameState, type Hex } from './types';

export type TrainingStage = 'capture' | 'attack' | 'defend' | 'fortress' | 'diplomacy' | 'done';

export const STAGE_ORDER: TrainingStage[] = ['capture', 'attack', 'defend', 'fortress', 'diplomacy', 'done'];

const NEXT_STAGE: Record<TrainingStage, TrainingStage | null> = {
  capture: 'attack',
  attack: 'defend',
  defend: 'fortress',
  fortress: 'diplomacy',
  diplomacy: 'done',
  done: null,
};

export const trainingStage = ref<TrainingStage | null>(null);
export const taskDone = ref(false);

let sendPause: () => void = () => {};
let isPaused: () => boolean = () => false;
let wePaused = false;
let awaiting = false;
let prevRelations = new Map<number, string>();

function pauseIfNeeded(): void {
  if (!isPaused()) {
    sendPause();
    wePaused = true;
  } else {
    wePaused = false;
  }
}

function unpauseIfNeeded(): void {
  if (wePaused && isPaused()) {
    sendPause();
  }
  wePaused = false;
}

export function initTraining(opts: { sendPause: () => void; isPaused: () => boolean }): void {
  sendPause = opts.sendPause;
  isPaused = opts.isPaused;
  prevRelations = new Map();
  trainingStage.value = 'capture';
  taskDone.value = false;
  awaiting = false;
  wePaused = false;
  pauseIfNeeded();
}

export function stopTraining(): void {
  trainingStage.value = null;
  taskDone.value = false;
  awaiting = false;
  wePaused = false;
}

function myHexCount(state: GameState, playerId: number): number {
  return state.players.find((p) => p.id === playerId)?.hexCount ?? 0;
}

function myHexes(state: GameState, playerId: number): Hex[] {
  return state.hexes.filter((h) => h.ownerId === playerId);
}

export function fortressReady(state: GameState, playerId: number): boolean {
  const hexCount = myHexCount(state, playerId);
  const fortressCount = state.hexes.filter((h) => h.ownerId === playerId && h.fortress).length;
  const points = state.players.find((p) => p.id === playerId)?.points ?? 0;
  if (Math.floor(hexCount / 10) <= fortressCount) return false;
  const nextLimit = 1000 + hexCount * 50 - 100 * (fortressCount + 1);
  return points <= nextLimit;
}

export function observeTraining(state: GameState, playerId: number): void {
  if (trainingStage.value === null) return;
  const stage = trainingStage.value;

  switch (stage) {
    case 'capture':
      if (myHexCount(state, playerId) > 0) taskDone.value = true;
      break;
    case 'attack':
      if (awaiting) {
        const mine = myHexes(state, playerId);
        const adjacentEnemy = state.hexes.some(
          (h) => h.ownerId !== null && h.ownerId !== playerId && mine.some((m) => isAdjacent(m, h)),
        );
        if (adjacentEnemy) {
          awaiting = false;
          pauseIfNeeded();
        }
      } else if (state.hexes.some((h) => h.attackerId === playerId)) {
        taskDone.value = true;
      }
      break;
    case 'defend':
      if (awaiting) {
        const attackedMine = state.hexes.some(
          (h) => h.ownerId === playerId && h.attackerId !== null && h.attackerId !== playerId,
        );
        if (attackedMine) {
          awaiting = false;
          pauseIfNeeded();
        }
      } else if (state.hexes.some((h) => h.defenderId === playerId)) {
        taskDone.value = true;
      }
      break;
    case 'fortress':
      if (awaiting) {
        if (fortressReady(state, playerId)) {
          awaiting = false;
          pauseIfNeeded();
        }
      } else if (state.hexes.some((h) => h.ownerId === playerId && h.fortress === true)) {
        taskDone.value = true;
      }
      break;
    case 'diplomacy': {
      const relationsChanged = state.players.some((p) => {
        if (p.id === playerId) return false;
        const prev = prevRelations.get(p.id);
        if (prev === undefined) {
          prevRelations.set(p.id, p.relation);
          return false;
        }
        return prev !== p.relation;
      });
      const proposalSent = state.pendingProposals.some((p) => p.from === playerId);
      if (relationsChanged || proposalSent) taskDone.value = true;
      for (const p of state.players) prevRelations.set(p.id, p.relation);
      break;
    }
    case 'done':
      taskDone.value = true;
      break;
  }
}

export function continueTutorial(): void {
  const cur = trainingStage.value;
  if (cur === null) return;
  const next = NEXT_STAGE[cur];
  if (next === null) {
    unpauseIfNeeded();
    stopTraining();
    return;
  }
  trainingStage.value = next;
  taskDone.value = false;
  awaiting = false;
  prevRelations = new Map();
  if (next === 'done') {
    wePaused = false;
    pauseIfNeeded();
    taskDone.value = true;
  } else if (next === 'attack' || next === 'defend' || next === 'fortress') {
    awaiting = true;
    unpauseIfNeeded();
  } else {
    wePaused = false;
    pauseIfNeeded();
  }
}
