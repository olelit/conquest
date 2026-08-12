# Conquest: Игровая механика (игрок + ИИ) через WebSocket — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить в docker-стек Conquest игру: игрок + ИИ захватывают гексы, экономика очков с лимитом, битвы за гексы с 1:1 контр-вложением; всё взаимодействие с картой — через WebSocket.

**Architecture:** Чистая игровая логика (rules.ts, ai.ts) + сервис поверх Postgres (game.ts) + WS-слой (ws.ts) + тик-движок 1 сек. Фронтенд получает полное состояние по WS (никакого polling), действия отправляет WS-сообщениями. Прокси Vite/nginx передают WS по тому же единому URL.

**Tech Stack:** Node 22 + TS (Express, pg, ws), Vue 3 + Vite + TS, vitest (unit-тесты чистой логики), Docker Compose.

## Global Constraints

- ВСЕ РАБОТЫ БЕЗ GIT-ОПЕРАЦИЙ (без commit/checkout/branch) — правки только в рабочем дереве. Пользователь явно запретил git.
- Тик = 1 сек. Доход = +1 очко за каждый свой гекс за тик. Лимит = `1000 + гексы × 50`, старт 1000/1000.
- Стоимость захвата: grass 200, desert 250, forest 300, water 400, mountain 500.
- Соседи (axial): (q+1,r), (q−1,r), (q,r+1), (q,r−1), (q+1,r−1), (q−1,r+1). Поле 16×12 (q 0..15, r 0..11).
- Первый гекс каждой стороны — бесплатный, любой (игрок с 0 гексов).
- Захват нейтрального гекса, соседнего с территорией соперника → битва (attack_investment = стоимость, 0 для бесплатного первого).
- Битва: перевес net = A − D; каждый тик `battle_progress += (net / стоимость) × 0.1`, отсечка ±1. При ≥1 — атакующий забирает гекс (возврат его вложений, вложения обороны сгорают). При ≤−1 — побеждает оборона (возврат её вложений, вложения атакующего сгорают); нейтральный спорный гекс достаётся обороняющемуся.
- defend на нейтральном спорном гексе — только если гекс соседний с территорией обороняющегося.
- ИИ: 1 ход за тик. Приоритеты: 1) оборона своих позиций (владелец ИЛИ атакующий на нейтральном спорном) — сравнять перевес; 2) оспорить захват игрока у своей границы; 3) рост — самый дешёвый нейтральный соседний; 4) атака — если нечего захватывать ИЛИ у игрока гексов больше, самый дешёвый гекс игрока, вложение min(очки, стоимость).
- Победа: ≥97 гексов → winnerId, действия блокируются.
- Игрок (human) = строка players с is_ai = false; ИИ = is_ai = true.
- WS-путь `/ws`, сообщения: клиент `{type:'capture'|'attack'|'defend', q, r, points?}`; сервер `{type:'state', game:{players:[{id,name,points,hexCount,isAi}], winnerId, hexes:[{q,r,terrain,ownerId,attackerId,defenderId,attackInvestment,defenseInvestment,battleProgress}]}}` и `{type:'error', message}`.
- Прокси: Vite `'/ws': { target: 'http://api:3000', ws: true }`; nginx `location /ws` с Upgrade/Connection.
- ESM-импорты с `.js` расширением (NodeNext). Числа вложений — целые ≥ 1.
- Новая зависимость server: `ws` (deps) и `@types/ws` (dev) — после изменения package.json выполнить `npm install` на хосте и пересобрать образ api (`docker compose build api`), т.к. node_modules в dev-контейнере из образа.
- Образ web dev пересборки не требует (vite.config.ts подхватывается монтированием).

---

### Task 1: rules.ts — чистая игровая логика (TDD)

**Files:**
- Create: `server/src/rules.ts`
- Test: `server/test/rules.test.ts`

**Interfaces:**
- Consumes: `server/src/map.ts` — `Terrain`, `MAP_COLUMNS = 16`, `MAP_ROWS = 12` (существуют).
- Produces (используется всеми последующими задачами):
  - `TERRAIN_COSTS: Record<Terrain, number>` (200/250/300/400/500)
  - `BASE_POINTS = 1000`, `LIMIT_PER_HEX = 50`, `WIN_HEX_COUNT = 97`, `BATTLE_STEP = 0.1`
  - `interface PlayerState { id: number; points: number }`
  - `interface HexState { q: number; r: number; terrain: Terrain; ownerId: number | null; attackerId: number | null; defenderId: number | null; attackInvestment: number; defenseInvestment: number; battleProgress: number }`
  - `interface GameState { players: PlayerState[]; hexes: HexState[]; winnerId: number | null }`
  - `findHex(state, q, r): HexState | undefined`
  - `hexCount(state, playerId): number`
  - `isInBounds(q, r): boolean`
  - `isAdjacent(a: {q: number; r: number}, b: {q: number; r: number}): boolean`
  - `hasAdjacentOwner(state, q, r, playerId): boolean`
  - `pointLimit(hexCount: number): number`
  - `terrainCost(terrain: Terrain): number`
  - `type ActionValidation = { ok: true } | { ok: false; error: string }`
  - `validateCapture(state, playerId, q, r): ActionValidation`
  - `validateAttack(state, playerId, q, r, points: number): ActionValidation`
  - `validateDefend(state, playerId, q, r, points: number): ActionValidation`
  - `applyCapture(state, playerId, q, r): void` (предполагается предварительная валидация)
  - `applyAttack(state, playerId, q, r, points: number): void`
  - `applyDefend(state, playerId, q, r, points: number): void`
  - `applyIncome(state): void`
  - `tickBattles(state): void`
  - `computeWinner(state): void` (ставит `state.winnerId`)

- [ ] **Step 1: Написать падающий тест `server/test/rules.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { MAP_COLUMNS, MAP_ROWS } from '../src/map.js';
import {
  applyAttack,
  applyCapture,
  applyDefend,
  applyIncome,
  BASE_POINTS,
  BATTLE_STEP,
  computeWinner,
  findHex,
  hasAdjacentOwner,
  hexCount,
  isAdjacent,
  isInBounds,
  pointLimit,
  terrainCost,
  TERRAIN_COSTS,
  tickBattles,
  validateAttack,
  validateCapture,
  validateDefend,
  WIN_HEX_COUNT,
  type GameState,
  type HexState,
  type PlayerState,
} from '../src/rules.js';

function makeState(hexes: Partial<HexState>[] = [], players: { id: number; points: number }[] = [{ id: 1, points: 1000 }, { id: 2, points: 1000 }]): GameState {
  const h: HexState[] = [];
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let q = 0; q < MAP_COLUMNS; q++) {
      h.push({ q, r, terrain: 'grass', ownerId: null, attackerId: null, defenderId: null, attackInvestment: 0, defenseInvestment: 0, battleProgress: 0 });
    }
  }
  for (const p of hexes) {
    const hex = h.find((x) => x.q === p.q && x.r === p.r);
    if (hex) Object.assign(hex, p);
  }
  return { players: players.map((p) => ({ id: p.id, points: p.points })), hexes: h, winnerId: null };
}

const P = 1;
const AI = 2;

describe('константы', () => {
  it('стоимости по террейнам', () => {
    expect(TERRAIN_COSTS).toEqual({ grass: 200, desert: 250, forest: 300, water: 400, mountain: 500 });
    expect(terrainCost('forest')).toBe(300);
  });
  it('лимит очков', () => {
    expect(BASE_POINTS).toBe(1000);
    expect(pointLimit(0)).toBe(1000);
    expect(pointLimit(5)).toBe(1250);
  });
});

describe('геометрия', () => {
  it('соседство axial', () => {
    expect(isAdjacent({ q: 5, r: 3 }, { q: 6, r: 3 })).toBe(true);
    expect(isAdjacent({ q: 5, r: 3 }, { q: 4, r: 3 })).toBe(true);
    expect(isAdjacent({ q: 5, r: 3 }, { q: 5, r: 4 })).toBe(true);
    expect(isAdjacent({ q: 5, r: 3 }, { q: 5, r: 2 })).toBe(true);
    expect(isAdjacent({ q: 5, r: 3 }, { q: 6, r: 2 })).toBe(true);
    expect(isAdjacent({ q: 5, r: 3 }, { q: 4, r: 4 })).toBe(true);
    expect(isAdjacent({ q: 5, r: 3 }, { q: 6, r: 4 })).toBe(false);
    expect(isAdjacent({ q: 5, r: 3 }, { q: 5, r: 3 })).toBe(false);
  });
  it('границы поля', () => {
    expect(isInBounds(0, 0)).toBe(true);
    expect(isInBounds(15, 11)).toBe(true);
    expect(isInBounds(16, 0)).toBe(false);
    expect(isInBounds(-1, 0)).toBe(false);
    expect(isInBounds(0, 12)).toBe(false);
  });
});

describe('первый бесплатный захват', () => {
  it('игрок с 0 гексов может захватить любой нейтральный гекс бесплатно', () => {
    const s = makeState();
    expect(validateCapture(s, P, 15, 11)).toEqual({ ok: true });
    applyCapture(s, P, 15, 11);
    expect(findHex(s, 15, 11)!.ownerId).toBe(P);
    expect(s.players[0].points).toBe(1000);
  });
  it('нельзя захватить гекс соперника', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: AI }]);
    expect(validateCapture(s, P, 5, 5).ok).toBe(false);
  });
  it('гекс в битве нельзя захватить', () => {
    const s = makeState([{ q: 5, r: 5, attackerId: AI, attackInvestment: 300 }]);
    expect(validateCapture(s, P, 5, 5).ok).toBe(false);
  });
});

describe('захват нейтрального гекса', () => {
  it('только соседний и по цене', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: P }]);
    const s1 = makeState([{ q: 5, r: 5, ownerId: P }]);
    expect(validateCapture(s, P, 4, 5).ok).toBe(true);
    applyCapture(s, P, 4, 5);
    expect(findHex(s, 4, 5)!.ownerId).toBe(P);
    expect(s.players[0].points).toBe(800);
    expect(validateCapture(s1, P, 6, 7).ok).toBe(false);
    expect(validateCapture(s1, P, 5, 5).ok).toBe(false);
  });
  it('стоимость зависит от террейна', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: P }, { q: 6, r: 5, terrain: 'mountain' }]);
    applyCapture(s, P, 6, 5);
    expect(s.players[0].points).toBe(500);
  });
  it('не хватает очков', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: P }], [{ id: 1, points: 100 }, { id: 2, points: 1000 }]);
    expect(validateCapture(s, P, 6, 5).ok).toBe(false);
  });
});

describe('захват нейтрального гекса у границы соперника порождает битву', () => {
  it('соседний с территорией ИИ — битва вместо мгновенного захвата', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: P }, { q: 3, r: 5, ownerId: AI }]);
    applyCapture(s, P, 4, 5);
    const hex = findHex(s, 4, 5)!;
    expect(hex.ownerId).toBeNull();
    expect(hex.attackerId).toBe(P);
    expect(hex.attackInvestment).toBe(200);
    expect(hex.battleProgress).toBe(0);
    expect(s.players[0].points).toBe(800);
  });
  it('не соседний с соперником — мгновенный захват', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: P }, { q: 9, r: 9, ownerId: AI }]);
    applyCapture(s, P, 6, 5);
    expect(findHex(s, 6, 5)!.ownerId).toBe(P);
  });
  it('бесплатный первый гекс у границы ИИ — битва с нулевым вложением', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI }]);
    applyCapture(s, P, 5, 5);
    const hex = findHex(s, 5, 5)!;
    expect(hex.attackerId).toBe(P);
    expect(hex.attackInvestment).toBe(0);
  });
});

describe('атака на гекс соперника', () => {
  it('валидна только для соседнего гекса соперника', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: P }, { q: 7, r: 5, ownerId: AI }]);
    expect(validateAttack(s, P, 7, 5, 100).ok).toBe(false);
    const s2 = makeState([{ q: 5, r: 5, ownerId: P }, { q: 6, r: 5, ownerId: AI }]);
    expect(validateAttack(s2, P, 6, 5, 100).ok).toBe(true);
  });
  it('требует очки и целое число ≥ 1', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: P }, { q: 6, r: 5, ownerId: AI }]);
    expect(validateAttack(s, P, 6, 5, 0).ok).toBe(false);
    expect(validateAttack(s, P, 6, 5, 1.5).ok).toBe(false);
    const poor = makeState([{ q: 5, r: 5, ownerId: P }, { q: 6, r: 5, ownerId: AI }], [{ id: 1, points: 50 }, { id: 2, points: 1000 }]);
    expect(validateAttack(poor, P, 6, 5, 100).ok).toBe(false);
  });
  it('нельзя атаковать свой гекс или гекс, атакуемый соперником', () => {
    const s1 = makeState([{ q: 5, r: 5, ownerId: P }]);
    expect(validateAttack(s1, P, 5, 5, 50).ok).toBe(false);
    const s2 = makeState([{ q: 5, r: 5, ownerId: P, attackerId: AI, attackInvestment: 100 }]);
    expect(validateAttack(s2, P, 5, 5, 50).ok).toBe(false);
    const s3 = makeState([{ q: 5, r: 5, ownerId: P }, { q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 100 }]);
    expect(validateAttack(s3, P, 6, 5, 50).ok).toBe(true);
  });
  it('долив в свою атаку увеличивает вложение', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: P }, { q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 100 }]);
    applyAttack(s, P, 6, 5, 50);
    expect(findHex(s, 6, 5)!.attackInvestment).toBe(150);
    expect(s.players[0].points).toBe(950);
  });
});

describe('оборона', () => {
  it('владелец защищает свой гекс', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 300 }]);
    expect(validateDefend(s, AI, 6, 5, 100).ok).toBe(true);
    applyDefend(s, AI, 6, 5, 100);
    expect(findHex(s, 6, 5)!.defenseInvestment).toBe(100);
    expect(s.players[1].points).toBe(900);
  });
  it('не-владелец не может защищать гекс соперника', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 300 }]);
    expect(validateDefend(s, P, 6, 5, 100).ok).toBe(false);
  });
  it('вступить в спор о нейтральном гексе можно только соседнему', () => {
    const s = makeState([{ q: 4, r: 5, attackerId: P, attackInvestment: 300 }, { q: 7, r: 5, ownerId: AI }]);
    expect(validateDefend(s, AI, 4, 5, 100).ok).toBe(false);
    const s2 = makeState([{ q: 4, r: 5, attackerId: P, attackInvestment: 300 }, { q: 5, r: 5, ownerId: AI }]);
    expect(validateDefend(s2, AI, 4, 5, 100).ok).toBe(true);
  });
  it('без битвы защищаться нельзя', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: P }]);
    expect(validateDefend(s, P, 5, 5, 10).ok).toBe(false);
  });
  it('защищать свою же атаку нельзя', () => {
    const s = makeState([{ q: 5, r: 5, attackerId: P, attackInvestment: 300 }]);
    expect(validateDefend(s, P, 5, 5, 10).ok).toBe(false);
  });
  it('защита фиксирует defender_id', () => {
    const s = makeState([{ q: 4, r: 5, attackerId: P, attackInvestment: 300 }, { q: 5, r: 5, ownerId: AI }]);
    applyDefend(s, AI, 4, 5, 100);
    expect(findHex(s, 4, 5)!.defenderId).toBe(AI);
  });
});

describe('тик битв', () => {
  it('шкала движется в сторону перевеса с шагом 0.1', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 600, defenseInvestment: 100 }]);
    tickBattles(s);
    expect(findHex(s, 6, 5)!.battleProgress).toBeCloseTo(0.1 * ((600 - 100) / 200));
  });
  it('при ≥1 атакующий забирает гекс, возврат его вложений, вложения обороны сгорают', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 600, defenseInvestment: 100, battleProgress: 0.99 }], [{ id: 1, points: 400 }, { id: 2, points: 900 }]);
    tickBattles(s);
    const hex = findHex(s, 6, 5)!;
    expect(hex.ownerId).toBe(P);
    expect(hex.attackerId).toBeNull();
    expect(hex.attackInvestment).toBe(0);
    expect(hex.defenseInvestment).toBe(0);
    expect(hex.battleProgress).toBe(0);
    expect(s.players[0].points).toBe(1000);
    expect(s.players[1].points).toBe(900);
  });
  it('при ≤−1 оборона побеждает: владелец отбивает свой гекс', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, defenderId: AI, attackerId: P, attackInvestment: 100, defenseInvestment: 600, battleProgress: -0.99 }], [{ id: 1, points: 900 }, { id: 2, points: 400 }]);
    tickBattles(s);
    const hex = findHex(s, 6, 5)!;
    expect(hex.ownerId).toBe(AI);
    expect(hex.attackerId).toBeNull();
    expect(s.players[1].points).toBe(1000);
    expect(s.players[0].points).toBe(900);
  });
  it('при ≤−1 обороняющийся забирает нейтральный спорный гекс', () => {
    const s = makeState([{ q: 4, r: 5, attackerId: P, defenderId: AI, attackInvestment: 100, defenseInvestment: 600, battleProgress: -0.99 }, { q: 5, r: 5, ownerId: AI }]);
    tickBattles(s);
    const hex = findHex(s, 4, 5)!;
    expect(hex.ownerId).toBe(AI);
    expect(hex.attackerId).toBeNull();
  });
  it('без соперника-обороны шкала растёт к захвату', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 600 }]);
    for (let i = 0; i < 11; i++) tickBattles(s);
    expect(findHex(s, 6, 5)!.ownerId).toBe(P);
  });
});

describe('экономика', () => {
  it('доход 1 очко за гекс с учётом лимита', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: P }, { q: 6, r: 5, ownerId: P }, { q: 4, r: 5, ownerId: P }]);
    applyIncome(s);
    expect(s.players[0].points).toBe(1003);
    const big = makeState();
    for (let i = 0; i < 40; i++) big.hexes[i].ownerId = P;
    big.players[0].points = 2970;
    applyIncome(big);
    expect(big.players[0].points).toBe(3000);
  });
});

describe('победа', () => {
  it('победа при ≥97 гексов', () => {
    const s = makeState();
    for (let i = 0; i < 96; i++) s.hexes[i].ownerId = P;
    computeWinner(s);
    expect(s.winnerId).toBeNull();
    s.hexes[96].ownerId = P;
    computeWinner(s);
    expect(s.winnerId).toBe(P);
  });
});

describe('вспомогательные', () => {
  it('hexCount и hasAdjacentOwner', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: P }, { q: 5, r: 4, ownerId: AI }]);
    expect(hexCount(s, P)).toBe(1);
    expect(hasAdjacentOwner(s, 4, 5, AI)).toBe(true);
    expect(hasAdjacentOwner(s, 7, 7, AI)).toBe(false);
  });
  it('BATTLE_STEP константа', () => {
    expect(BATTLE_STEP).toBe(0.1);
    expect(WIN_HEX_COUNT).toBe(97);
  });
});
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

Run: `cd server && npm test`
Expected: FAIL — модуль `../src/rules.js` не найден.

- [ ] **Step 3: Реализовать `server/src/rules.ts`**

```ts
import type { Terrain } from './map.js';
import { MAP_COLUMNS, MAP_ROWS } from './map.js';

export const TERRAIN_COSTS: Record<Terrain, number> = {
  grass: 200,
  desert: 250,
  forest: 300,
  water: 400,
  mountain: 500,
};

export const BASE_POINTS = 1000;
export const LIMIT_PER_HEX = 50;
export const WIN_HEX_COUNT = 97;
export const BATTLE_STEP = 0.1;

export interface PlayerState {
  id: number;
  points: number;
}

export interface HexState {
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

export interface GameState {
  players: PlayerState[];
  hexes: HexState[];
  winnerId: number | null;
}

const NEIGHBOR_OFFSETS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, -1],
  [-1, 1],
];

export function findHex(state: GameState, q: number, r: number): HexState | undefined {
  return state.hexes.find((h) => h.q === q && h.r === r);
}

export function hexCount(state: GameState, playerId: number): number {
  return state.hexes.reduce((n, h) => n + (h.ownerId === playerId ? 1 : 0), 0);
}

export function isInBounds(q: number, r: number): boolean {
  return q >= 0 && q < MAP_COLUMNS && r >= 0 && r < MAP_ROWS;
}

export function isAdjacent(a: { q: number; r: number }, b: { q: number; r: number }): boolean {
  return NEIGHBOR_OFFSETS.some(([dq, dr]) => a.q + dq === b.q && a.r + dr === b.r);
}

export function hasAdjacentOwner(state: GameState, q: number, r: number, playerId: number): boolean {
  return NEIGHBOR_OFFSETS.some(([dq, dr]) => {
    const nq = q + dq;
    const nr = r + dr;
    if (!isInBounds(nq, nr)) return false;
    const hex = findHex(state, nq, nr);
    return hex !== undefined && hex.ownerId === playerId;
  });
}

export function pointLimit(hexCount: number): number {
  return BASE_POINTS + hexCount * LIMIT_PER_HEX;
}

export function terrainCost(terrain: Terrain): number {
  return TERRAIN_COSTS[terrain];
}

function hasGameWinner(state: GameState): boolean {
  return state.winnerId !== null;
}

function isValidPoints(points: unknown): points is number {
  return typeof points === 'number' && Number.isInteger(points) && points >= 1;
}

export type ActionValidation = { ok: true } | { ok: false; error: string };

export function validateCapture(state: GameState, playerId: number, q: number, r: number): ActionValidation {
  if (hasGameWinner(state)) return { ok: false, error: 'Игра окончена' };
  const hex = findHex(state, q, r);
  if (!hex) return { ok: false, error: 'Гекс не найден' };
  if (hex.ownerId !== null) return { ok: false, error: 'Гекс уже занят' };
  if (hex.attackerId !== null) return { ok: false, error: 'За гекс уже идёт борьба' };
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { ok: false, error: 'Игрок не найден' };
  const count = hexCount(state, playerId);
  if (count === 0) return { ok: true };
  if (!hasAdjacentOwner(state, q, r, playerId)) return { ok: false, error: 'Гекс не соседний' };
  if (player.points < terrainCost(hex.terrain)) return { ok: false, error: 'Не хватает очков' };
  return { ok: true };
}

export function validateAttack(state: GameState, playerId: number, q: number, r: number, points: number): ActionValidation {
  if (hasGameWinner(state)) return { ok: false, error: 'Игра окончена' };
  if (!isValidPoints(points)) return { ok: false, error: 'Вложение должно быть целым числом ≥ 1' };
  const hex = findHex(state, q, r);
  if (!hex) return { ok: false, error: 'Гекс не найден' };
  if (hex.ownerId !== null && hex.ownerId === playerId) return { ok: false, error: 'Нельзя атаковать свой гекс' };
  if (hex.ownerId === null) return { ok: false, error: 'Нейтральный гекс захватывается, а не атакуется' };
  if (hex.attackerId !== null && hex.attackerId !== playerId) return { ok: false, error: 'Битву уже ведёт соперник' };
  if (!hasAdjacentOwner(state, q, r, playerId)) return { ok: false, error: 'Гекс не соседний' };
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { ok: false, error: 'Игрок не найден' };
  if (player.points < points) return { ok: false, error: 'Не хватает очков' };
  return { ok: true };
}

export function validateDefend(state: GameState, playerId: number, q: number, r: number, points: number): ActionValidation {
  if (hasGameWinner(state)) return { ok: false, error: 'Игра окончена' };
  if (!isValidPoints(points)) return { ok: false, error: 'Вложение должно быть целым числом ≥ 1' };
  const hex = findHex(state, q, r);
  if (!hex) return { ok: false, error: 'Гекс не найден' };
  if (hex.attackerId === null) return { ok: false, error: 'Битвы нет' };
  if (hex.attackerId === playerId) return { ok: false, error: 'Нельзя защищать свою же атаку' };
  if (hex.ownerId === playerId) {
    // владелец защищает свой гекс
  } else if (hex.ownerId === null) {
    if (!hasAdjacentOwner(state, q, r, playerId)) return { ok: false, error: 'Гекс не соседний' };
  } else {
    return { ok: false, error: 'Гекс принадлежит другому' };
  }
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { ok: false, error: 'Игрок не найден' };
  if (player.points < points) return { ok: false, error: 'Не хватает очков' };
  return { ok: true };
}

export function applyCapture(state: GameState, playerId: number, q: number, r: number): void {
  const hex = findHex(state, q, r)!;
  const player = state.players.find((p) => p.id === playerId)!;
  const isFirst = hexCount(state, playerId) === 0;
  const cost = isFirst ? 0 : terrainCost(hex.terrain);
  player.points -= cost;
  if (hasAdjacentOwner(state, q, r, opponentId(state, playerId))) {
    hex.attackerId = playerId;
    hex.attackInvestment = cost;
    hex.defenderId = null;
    hex.defenseInvestment = 0;
    hex.battleProgress = 0;
  } else {
    hex.ownerId = playerId;
  }
}

function opponentId(state: GameState, playerId: number): number {
  return state.players.find((p) => p.id !== playerId)!.id;
}

export function applyAttack(state: GameState, playerId: number, q: number, r: number, points: number): void {
  const hex = findHex(state, q, r)!;
  const player = state.players.find((p) => p.id === playerId)!;
  player.points -= points;
  hex.attackInvestment += points;
  if (hex.attackerId === null) {
    hex.attackerId = playerId;
    hex.defenderId = hex.ownerId;
    hex.battleProgress = 0;
  }
}

export function applyDefend(state: GameState, playerId: number, q: number, r: number, points: number): void {
  const hex = findHex(state, q, r)!;
  const player = state.players.find((p) => p.id === playerId)!;
  player.points -= points;
  hex.defenseInvestment += points;
  if (hex.defenderId === null) {
    hex.defenderId = playerId;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function tickBattles(state: GameState): void {
  for (const hex of state.hexes) {
    if (hex.attackerId === null) continue;
    const cost = terrainCost(hex.terrain);
    const net = hex.attackInvestment - hex.defenseInvestment;
    hex.battleProgress = clamp(hex.battleProgress + (net / cost) * BATTLE_STEP, -1, 1);
    if (hex.battleProgress >= 1) {
      const attacker = state.players.find((p) => p.id === hex.attackerId);
      if (attacker) attacker.points += hex.attackInvestment;
      hex.ownerId = hex.attackerId;
      resetBattle(hex);
    } else if (hex.battleProgress <= -1) {
      const defender = state.players.find((p) => p.id === hex.defenderId);
      if (defender) defender.points += hex.defenseInvestment;
      if (hex.ownerId === null) {
        hex.ownerId = hex.defenderId;
      }
      resetBattle(hex);
    }
  }
}

function resetBattle(hex: HexState): void {
  hex.attackerId = null;
  hex.defenderId = null;
  hex.attackInvestment = 0;
  hex.defenseInvestment = 0;
  hex.battleProgress = 0;
}

export function applyIncome(state: GameState): void {
  for (const player of state.players) {
    const count = hexCount(state, player.id);
    player.points = Math.min(player.points + count, pointLimit(count));
  }
}

export function computeWinner(state: GameState): void {
  if (state.winnerId !== null) return;
  for (const player of state.players) {
    if (hexCount(state, player.id) >= WIN_HEX_COUNT) {
      state.winnerId = player.id;
      return;
    }
  }
}
```

- [ ] **Step 4: Запустить тесты, убедиться что проходят**

Run: `cd server && npm test`
Expected: PASS, все тесты зелёные.

---

### Task 2: ai.ts — логика ИИ (TDD)

**Files:**
- Create: `server/src/ai.ts`
- Test: `server/test/ai.test.ts`

**Interfaces:**
- Consumes: rules.ts — `GameState`, `HexState`, `findHex`, `hexCount`, `hasAdjacentOwner`, `isAdjacent`, `terrainCost`, `TERRAIN_COSTS` (из Task 1).
- Produces:
  - `type AiAction = { type: 'defend'; q: number; r: number; points: number } | { type: 'capture'; q: number; r: number } | { type: 'attack'; q: number; r: number; points: number }`
  - `chooseAiAction(state: GameState, aiId: number, playerId: number): AiAction | null` — 1 ход по приоритетам: оборона → оспорить захват → рост → атака.

- [ ] **Step 1: Написать падающий тест `server/test/ai.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { MAP_COLUMNS, MAP_ROWS } from '../src/map.js';
import type { GameState, HexState } from '../src/rules.js';
import { chooseAiAction } from '../src/ai.js';

function makeState(hexes: Partial<HexState>[], aiPoints = 1000, playerPoints = 1000): GameState {
  const h: HexState[] = [];
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let q = 0; q < MAP_COLUMNS; q++) {
      h.push({ q, r, terrain: 'grass', ownerId: null, attackerId: null, defenderId: null, attackInvestment: 0, defenseInvestment: 0, battleProgress: 0 });
    }
  }
  for (const p of hexes) {
    const hex = h.find((x) => x.q === p.q && x.r === p.r);
    if (hex) Object.assign(hex, p);
  }
  return { players: [{ id: 2, points: aiPoints }, { id: 1, points: playerPoints }], hexes: h, winnerId: null };
}

const P = 1;
const AI = 2;

describe('chooseAiAction', () => {
  it('приоритет 1: защищает свой гекс под атакой (сравнивает перевес)', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 400 }]);
    const action = chooseAiAction(s, AI, P);
    expect(action).toEqual({ type: 'defend', q: 6, r: 5, points: 400 });
  });
  it('приоритет 1: доливает свою атаку на нейтральном спорном гексе, если игрок контрит', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: null, attackerId: AI, attackInvestment: 100, defenderId: P, defenseInvestment: 400 }, { q: 6, r: 5, ownerId: AI }]);
    const action = chooseAiAction(s, AI, P);
    expect(action).toEqual({ type: 'attack', q: 5, r: 5, points: 300 });
  });
  it('приоритет 1: без перевеса у соперника — не тратится', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 400, defenseInvestment: 400 }], 100);
    expect(chooseAiAction(s, AI, P)).toBeNull();
  });
  it('приоритет 2: оспаривает захват игрока у своей границы', () => {
    const s = makeState([{ q: 5, r: 5, attackerId: P, attackInvestment: 400 }, { q: 6, r: 5, ownerId: AI }]);
    expect(chooseAiAction(s, AI, P)).toEqual({ type: 'defend', q: 5, r: 5, points: 400 });
  });
  it('приоритет 2: не оспаривает гекс не у своей границы', () => {
    const s = makeState([{ q: 2, r: 2, attackerId: P, attackInvestment: 400 }, { q: 6, r: 5, ownerId: AI }], 0);
    expect(chooseAiAction(s, AI, P)).toBeNull();
  });
  it('приоритет 3: захватывает самый дешёвый нейтральный соседний гекс', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI }, { q: 5, r: 5, terrain: 'mountain' }, { q: 6, r: 4, terrain: 'grass' }]);
    expect(chooseAiAction(s, AI, P)).toEqual({ type: 'capture', q: 6, r: 4 });
  });
  it('приоритет 3: не захватывает, если не хватает очков', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI }, { q: 5, r: 5, terrain: 'mountain' }], 100);
    expect(chooseAiAction(s, AI, P)).toBeNull();
  });
  it('приоритет 4: атакует самый дешёвый гекс игрока, когда у игрока гексов больше', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI }, { q: 4, r: 5, ownerId: P }, { q: 5, r: 5, ownerId: P }]);
    expect(chooseAiAction(s, AI, P)).toEqual({ type: 'attack', q: 5, r: 5, points: 200 });
  });
  it('приоритет 4: атакует, когда нечего захватывать, даже если не сильнее', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, terrain: 'mountain' }, { q: 5, r: 5, ownerId: P }], 100);
    expect(chooseAiAction(s, AI, P)).toEqual({ type: 'attack', q: 5, r: 5, points: 100 });
  });
  it('без доступных действий — null', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI }], 50);
    expect(chooseAiAction(s, AI, P)).toBeNull();
  });
});
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

Run: `cd server && npm test`
Expected: FAIL — модуль `../src/ai.js` не найден.

- [ ] **Step 3: Реализовать `server/src/ai.ts`**

```ts
import { findHex, hexCount, hasAdjacentOwner, terrainCost, type GameState } from './rules.js';

export type AiAction =
  | { type: 'defend'; q: number; r: number; points: number }
  | { type: 'capture'; q: number; r: number }
  | { type: 'attack'; q: number; r: number; points: number };

export function chooseAiAction(state: GameState, aiId: number, playerId: number): AiAction | null {
  const ai = state.players.find((p) => p.id === aiId);
  if (!ai) return null;

  for (const hex of state.hexes) {
    if (hex.attackerId === null) continue;
    if (hex.ownerId === aiId) {
      const gap = hex.attackInvestment - hex.defenseInvestment;
      if (gap > 0) {
        const invest = Math.min(ai.points, Math.max(1, gap));
        if (invest >= 1) return { type: 'defend', q: hex.q, r: hex.r, points: invest };
      }
    } else if (hex.attackerId === aiId) {
      const gap = hex.defenseInvestment - hex.attackInvestment;
      if (gap > 0) {
        const invest = Math.min(ai.points, Math.max(1, gap));
        if (invest >= 1) return { type: 'attack', q: hex.q, r: hex.r, points: invest };
      }
    }
  }

  for (const hex of state.hexes) {
    if (hex.ownerId !== null) continue;
    if (hex.attackerId !== playerId) continue;
    if (!hasAdjacentOwner(state, hex.q, hex.r, aiId)) continue;
    const gap = hex.attackInvestment - hex.defenseInvestment;
    if (gap > 0) {
      const invest = Math.min(ai.points, Math.max(1, gap));
      if (invest >= 1) return { type: 'defend', q: hex.q, r: hex.r, points: invest };
    }
  }

  const aiHexCount = hexCount(state, aiId);
  const playerHexCount = hexCount(state, playerId);
  const affordableNeutral = state.hexes
    .filter((hex) => hex.ownerId === null && hex.attackerId === null && hasAdjacentOwner(state, hex.q, hex.r, aiId))
    .filter((hex) => terrainCost(hex.terrain) <= ai.points)
    .sort((a, b) => terrainCost(a.terrain) - terrainCost(b.terrain));
  if (affordableNeutral.length > 0 && playerHexCount <= aiHexCount) {
    const hex = affordableNeutral[0];
    return { type: 'capture', q: hex.q, r: hex.r };
  }

  const playerHexes = state.hexes.filter((hex) => hex.ownerId === playerId && hasAdjacentOwner(state, hex.q, hex.r, aiId));
  if (playerHexes.length > 0) {
    const hex = playerHexes.sort((a, b) => terrainCost(a.terrain) - terrainCost(b.terrain))[0];
    const invest = Math.min(ai.points, terrainCost(hex.terrain));
    if (invest >= 1) return { type: 'attack', q: hex.q, r: hex.r, points: invest };
  }

  return null;
}
```

- [ ] **Step 4: Запустить тесты, убедиться что проходят**

Run: `cd server && npm test`
Expected: PASS (все тесты rules + ai зелёные).

- [ ] **Step 5: Проверить типы**

Run: `cd server && npx tsc --noEmit`
Expected: без ошибок.

---

### Task 3: db.ts — миграция и персистентность, game.ts — игровой сервис

**Files:**
- Create: `server/src/game.ts`
- Modify: `server/src/db.ts`

**Interfaces:**
- Consumes: rules.ts (Task 1), ai.ts (Task 2), существующий `server/src/db.ts` (pool, `initDb`, `fetchHexes` — остаются; добавляются функции ниже), `server/src/map.ts` (`generateMap`, `MAP_COLUMNS`, `MAP_ROWS`, `Terrain`).
- Produces:
  - из `db.ts`:
    - `migrateGameTables(): Promise<void>` — создаёт `players`, добавляет колонки в `hexes`, сидит игроков и поле (идемпотентно)
    - `loadGameState(): Promise<GameState>` — players + hexes → объект `GameState`
    - `persistGame(state: GameState): Promise<void>` — транзакция: UPDATE players.points, UPDATE всех hexes
  - из `game.ts`:
    - `interface ServerGameState { players: { id: number; name: string; points: number; hexCount: number; isAi: boolean }[]; winnerId: number | null; hexes: HexState[] }`
    - `class GameService`
      - `async init(): Promise<void>` — миграция + загрузка состояния, определение humanId/aiId
      - `getState(): ServerGameState`
      - `async handleAction(msg: { type: string; q: number; r: number; points?: number }): Promise<{ type: 'state'; game: ServerGameState } | { type: 'error'; message: string }>`
      - `async tick(): Promise<void>` — доход → битвы → ход ИИ → победа → персист (если `winnerId` уже есть — только персист и выход)
      - `readonly humanId: number` и `readonly aiId: number`

- [ ] **Step 1: Расширить `server/src/db.ts`**

Добавить в конец файла (существующие функции не менять):

```ts
import type { GameState, HexState } from './rules.js';
import type { Terrain } from './map.js';
import { generateMap, MAP_COLUMNS, MAP_ROWS } from './map.js';

export async function migrateGameTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      id serial PRIMARY KEY,
      name text NOT NULL,
      points integer NOT NULL DEFAULT 1000,
      is_ai boolean NOT NULL DEFAULT false
    )
  `);
  await pool.query(`
    ALTER TABLE hexes ADD COLUMN IF NOT EXISTS owner_id integer REFERENCES players(id)
  `);
  await pool.query(`
    ALTER TABLE hexes ADD COLUMN IF NOT EXISTS attacker_id integer REFERENCES players(id)
  `);
  await pool.query(`
    ALTER TABLE hexes ADD COLUMN IF NOT EXISTS defender_id integer REFERENCES players(id)
  `);
  await pool.query(`
    ALTER TABLE hexes ADD COLUMN IF NOT EXISTS attack_investment integer NOT NULL DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE hexes ADD COLUMN IF NOT EXISTS defense_investment integer NOT NULL DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE hexes ADD COLUMN IF NOT EXISTS battle_progress double precision NOT NULL DEFAULT 0
  `);
  const playerCount = await pool.query<{ count: string }>('SELECT COUNT(*) AS count FROM players');
  if (Number(playerCount.rows[0].count) === 0) {
    await pool.query("INSERT INTO players (name, is_ai) VALUES ('player', false), ('ai', true)");
  }
  const hexCount = await pool.query<{ count: string }>('SELECT COUNT(*) AS count FROM hexes');
  if (Number(hexCount.rows[0].count) === 0) {
    const hexes = generateMap(MAP_COLUMNS, MAP_ROWS);
    const params: (number | string)[] = [];
    const placeholders = hexes.map((hex, i) => {
      params.push(hex.q, hex.r, hex.terrain);
      return `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`;
    });
    await pool.query(`INSERT INTO hexes (q, r, terrain) VALUES ${placeholders.join(', ')}`, params);
  }
}

export async function loadGameState(): Promise<GameState> {
  const players = await pool.query<{ id: number; points: number }>('SELECT id, points FROM players ORDER BY id');
  const hexes = await pool.query<HexState>('SELECT q, r, terrain, owner_id AS "ownerId", attacker_id AS "attackerId", defender_id AS "defenderId", attack_investment AS "attackInvestment", defense_investment AS "defenseInvestment", battle_progress AS "battleProgress" FROM hexes ORDER BY r, q');
  return {
    players: players.rows.map((p) => ({ id: p.id, points: p.points })),
    hexes: hexes.rows,
    winnerId: null,
  };
}

export async function persistGame(state: GameState): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const player of state.players) {
      await client.query('UPDATE players SET points = $1 WHERE id = $2', [player.points, player.id]);
    }
    for (const hex of state.hexes) {
      await client.query(
        `UPDATE hexes SET owner_id = $1, attacker_id = $2, defender_id = $3,
         attack_investment = $4, defense_investment = $5, battle_progress = $6
         WHERE q = $7 AND r = $8`,
        [hex.ownerId, hex.attackerId, hex.defenderId, hex.attackInvestment, hex.defenseInvestment, hex.battleProgress, hex.q, hex.r],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
```

Внимание: `import`-строки добавлять НА ВЕРХ файла вместе с существующими импортами, не в конец (ESM требует import на верхнем уровне).

- [ ] **Step 2: Проверить типы**

Run: `cd server && npx tsc --noEmit`
Expected: без ошибок. (Если `import type { HexState }` ругается на неиспользуемый — в нашем случае HexState используется в типе результата, ок.)

- [ ] **Step 3: Создать `server/src/game.ts`**

```ts
import { chooseAiAction, type AiAction } from './ai.js';
import * as db from './db.js';
import * as rules from './rules.js';
import type { GameState, HexState } from './rules.js';

export interface ServerGameState {
  players: { id: number; name: string; points: number; hexCount: number; isAi: boolean }[];
  winnerId: number | null;
  hexes: HexState[];
}

interface ActionMessage {
  type: string;
  q: number;
  r: number;
  points?: number;
}

type ActionResult = { type: 'state'; game: ServerGameState } | { type: 'error'; message: string };

export class GameService {
  readonly humanId: number;
  readonly aiId: number;
  private state: GameState = { players: [], hexes: [], winnerId: null };

  private constructor(humanId: number, aiId: number) {
    this.humanId = humanId;
    this.aiId = aiId;
  }

  static async create(): Promise<GameService> {
    await db.migrateGameTables();
    const state = await db.loadGameState();
    const humanId = state.players.find((p) => !p.isAi)?.id;
    const aiId = state.players.find((p) => p.isAi)?.id;
    if (humanId === undefined || aiId === undefined) {
      throw new Error('players table must contain exactly one human and one ai player');
    }
    const service = new GameService(humanId, aiId);
    service.state = state;
    return service;
  }

  getState(): ServerGameState {
    const players = this.state.players.map((p) => {
      const meta = this.playerMeta(p.id);
      return {
        id: p.id,
        name: meta.name,
        points: p.points,
        hexCount: rules.hexCount(this.state, p.id),
        isAi: meta.isAi,
      };
    });
    return { players, winnerId: this.state.winnerId, hexes: this.state.hexes };
  }

  async handleAction(msg: ActionMessage): Promise<ActionResult> {
    if (typeof msg.q !== 'number' || typeof msg.r !== 'number') {
      return { type: 'error', message: 'Некорректные координаты' };
    }
    const playerId = this.humanId;
    let validation: rules.ActionValidation;
    switch (msg.type) {
      case 'capture':
        validation = rules.validateCapture(this.state, playerId, msg.q, msg.r);
        if (!validation.ok) return { type: 'error', message: validation.error };
        rules.applyCapture(this.state, playerId, msg.q, msg.r);
        break;
      case 'attack':
        validation = rules.validateAttack(this.state, playerId, msg.q, msg.r, Number(msg.points));
        if (!validation.ok) return { type: 'error', message: validation.error };
        rules.applyAttack(this.state, playerId, msg.q, msg.r, Number(msg.points));
        break;
      case 'defend':
        validation = rules.validateDefend(this.state, playerId, msg.q, msg.r, Number(msg.points));
        if (!validation.ok) return { type: 'error', message: validation.error };
        rules.applyDefend(this.state, playerId, msg.q, msg.r, Number(msg.points));
        break;
      default:
        return { type: 'error', message: `Неизвестный тип сообщения: ${msg.type}` };
    }
    try {
      await db.persistGame(this.state);
    } catch (err) {
      console.error('persist failed after action:', err);
      return { type: 'error', message: 'Не удалось сохранить состояние' };
    }
    return { type: 'state', game: this.getState() };
  }

  async tick(): Promise<void> {
    if (this.state.winnerId === null) {
      rules.applyIncome(this.state);
      rules.tickBattles(this.state);
      const aiAction = chooseAiAction(this.state, this.aiId, this.humanId);
      if (aiAction) {
        this.applyAiAction(aiAction);
      }
      rules.computeWinner(this.state);
    }
    try {
      await db.persistGame(this.state);
    } catch (err) {
      console.error('persist failed in tick:', err);
    }
  }

  private applyAiAction(action: AiAction): void {
    switch (action.type) {
      case 'capture':
        if (rules.validateCapture(this.state, this.aiId, action.q, action.r).ok) {
          rules.applyCapture(this.state, this.aiId, action.q, action.r);
        }
        break;
      case 'attack':
        if (rules.validateAttack(this.state, this.aiId, action.q, action.r, action.points).ok) {
          rules.applyAttack(this.state, this.aiId, action.q, action.r, action.points);
        }
        break;
      case 'defend':
        if (rules.validateDefend(this.state, this.aiId, action.q, action.r, action.points).ok) {
          rules.applyDefend(this.state, this.aiId, action.q, action.r, action.points);
        }
        break;
    }
  }

  private playerMeta(id: number): { name: string; isAi: boolean } {
    if (id === this.humanId) return { name: 'player', isAi: false };
    return { name: 'ai', isAi: true };
  }
}
```

- [ ] **Step 4: Проверить типы**

Run: `cd server && npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 5: Запустить тесты (существующие не сломаны)**

Run: `cd server && npm test`
Expected: все тесты rules + ai зелёные.

---

### Task 4: ws.ts + index.ts — WS-сервер и тик-движок

**Files:**
- Create: `server/src/ws.ts`
- Modify: `server/src/index.ts`
- Modify: `server/package.json` (добавить `ws` в dependencies, `@types/ws` в devDependencies)

**Interfaces:**
- Consumes: game.ts — `GameService`, `ServerGameState` (Task 3).
- Produces:
  - `attachWs(server: http.Server, service: GameService): void` — WebSocketServer на пути `/ws`; при подключении шлёт `{type:'state', game}`; на сообщение — `service.handleAction`, при `{type:'state'}` — broadcast всем, при `{type:'error'}` — ошибка только отправителю.
  - `index.ts`: HTTP-сервер (express + `/health`) + `attachWs` + setInterval(tick, 1000) с guard от наложения, `closeDb()` на shutdown.

- [ ] **Step 1: Добавить зависимости в `server/package.json`**

В `"dependencies"` добавить `"ws": "^8.18.0"`, в `"devDependencies"` добавить `"@types/ws": "^8.5.12"`. Затем:

Run: `cd server && npm install`
Expected: установка успешна, `package-lock.json` обновлён.

- [ ] **Step 2: Создать `server/src/ws.ts`**

```ts
import type { Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import type { GameService } from './game.js';

export function attachWs(server: Server, service: GameService): void {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'state', game: service.getState() }));

    ws.on('message', async (raw) => {
      let msg: unknown;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Некорректный JSON' }));
        return;
      }
      const result = await service.handleAction(msg as { type: string; q: number; r: number; points?: number });
      if (result.type === 'state') {
        broadcast(wss, JSON.stringify(result));
      } else {
        ws.send(JSON.stringify(result));
      }
    });
  });
}

function broadcast(wss: WebSocketServer, payload: string): void {
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}
```

- [ ] **Step 3: Переписать `server/src/index.ts`**

```ts
import http from 'http';
import express from 'express';
import { closeDb, initDb, seedIfEmpty } from './db.js';
import { GameService } from './game.js';
import { attachWs } from './ws.js';

const PORT = Number(process.env.PORT ?? 3000);
const MAX_DB_RETRIES = 15;
const DB_RETRY_DELAY_MS = 2000;
const TICK_INTERVAL_MS = 1000;

async function connectWithRetry(): Promise<void> {
  for (let attempt = 1; attempt <= MAX_DB_RETRIES; attempt++) {
    try {
      await initDb();
      return;
    } catch (err) {
      if (attempt === MAX_DB_RETRIES) throw err;
      console.error(
        `DB not ready (attempt ${attempt}/${MAX_DB_RETRIES}), retrying in ${DB_RETRY_DELAY_MS}ms...`,
      );
      await new Promise((resolve) => setTimeout(resolve, DB_RETRY_DELAY_MS));
    }
  }
}

async function main(): Promise<void> {
  const app = express();

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  await connectWithRetry();
  await seedIfEmpty();

  const service = await GameService.create();
  console.log(`Game started: human=${service.humanId}, ai=${service.aiId}`);

  const server = http.createServer(app);
  attachWs(server, service);

  let ticking = false;
  setInterval(() => {
    if (ticking) return;
    ticking = true;
    service
      .tick()
      .catch((err) => console.error('tick failed:', err))
      .finally(() => {
        ticking = false;
      });
  }, TICK_INTERVAL_MS);

  server.listen(PORT, () => console.log(`API listening on port ${PORT}`));
}

main().catch(async (err) => {
  console.error('API failed to start:', err);
  await closeDb();
  process.exit(1);
});
```

Внимание: `initDb` и `seedIfEmpty` остаются из старого кода (создание таблицы hexes + сид). `migrateGameTables` (новая, из Task 3) выполняется внутри `GameService.create()`.

- [ ] **Step 4: Проверить типы и тесты**

Run: `cd server && npx tsc --noEmit && npm test`
Expected: без ошибок, все тесты зелёные.

- [ ] **Step 5: Пересобрать api и проверить работу WS**

```bash
docker compose build api
docker compose up -d api
sleep 5
docker compose logs api --tail 20
```

Expected: в логах `Game started: human=1, ai=2` и `API listening on port 3000`; затем проверка WS-скриптом:

Создать `/tmp/opencode/ws-check.mjs`:

```js
import WebSocket from '/home/oleg/code/conquest/server/node_modules/ws/wrapper.mjs';

const ws = new WebSocket('ws://localhost:5173/ws');
let steps = 0;
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === 'state') {
    console.log('STATE: players=', JSON.stringify(msg.game.players), 'hexes=', msg.game.hexes.length);
    if (steps === 0) {
      ws.send(JSON.stringify({ type: 'capture', q: 7, r: 6 }));
    } else if (steps === 1) {
      ws.send(JSON.stringify({ type: 'bogus' }));
    } else if (steps === 2) {
      ws.close();
      process.exit(0);
    }
    steps++;
  } else if (msg.type === 'error') {
    console.log('ERROR:', msg.message);
  }
});
ws.on('open', () => console.log('OPEN'));
```

Запуск: `cd server && node /tmp/opencode/ws-check.mjs`
Expected: `OPEN`, `STATE: players=... hexes=192`, затем после первого `capture` состояние приходит с захваченным гексом (ownerId = humanId у (7,6)), затем `ERROR: Неизвестный тип сообщения: bogus`, выход. Затем `git` НЕ использовать — просто проверить, что процесс завершился с кодом 0.

Проверка захвата: выполнить скрипт ещё раз и убедиться, что `capture` на (7,6) теперь даёт ошибку «Гекс уже занят» (т.к. гекс уже захвачен прошлым запуском) — это подтверждает персистентность в Postgres.

- [ ] **Step 6: Проверить перезапуск**

Run: `docker compose restart api && sleep 8 && docker compose logs api --tail 10`
Expected: лог содержит `Map already seeded`, `Game started: human=1, ai=2` без ошибок.

---

### Task 5: Web — типы, WS-клиент, прокси Vite

**Files:**
- Create: `web/src/api.ts`
- Modify: `web/src/types.ts`
- Modify: `web/vite.config.ts`

**Interfaces:**
- Consumes: ничего нового (типы определяются заново на фронте).
- Produces:
  - `web/src/types.ts`: `interface Player { id; name; points; hexCount; isAi }`, `interface Hex { q; r; terrain; ownerId; attackerId; defenderId; attackInvestment; defenseInvestment; battleProgress }`, `interface GameState { players: Player[]; winnerId: number | null; hexes: Hex[] }`, `type Terrain` + `TERRAIN_COLORS` + `TERRAIN_LABELS` (как раньше), `type ClientMessage`, `type ServerMessage`.
  - `web/src/api.ts`: `class GameClient` — `onState(state: GameState): void`, `onError(message: string): void`, `onStatus(connected: boolean): void`; `connect(): void` (с бэкофф-реконнектом 1,2,4,8,10,10…с); `sendCapture(q, r)`, `sendAttack(q, r, points)`, `sendDefend(q, r, points)`, `close(): void`.
  - `web/vite.config.ts`: добавить прокси `/ws` с `ws: true`.

- [ ] **Step 1: Переписать `web/src/types.ts`**

```ts
export type Terrain = 'grass' | 'forest' | 'mountain' | 'water' | 'desert';

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
  isAi: boolean;
}

export interface GameState {
  players: Player[];
  winnerId: number | null;
  hexes: Hex[];
}

export type ClientMessage =
  | { type: 'capture'; q: number; r: number }
  | { type: 'attack'; q: number; r: number; points: number }
  | { type: 'defend'; q: number; r: number; points: number };

export type ServerMessage =
  | { type: 'state'; game: GameState }
  | { type: 'error'; message: string };

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

export const PLAYER_COLOR: Record<'human' | 'ai', string> = {
  human: '#2196f3',
  ai: '#e53935',
};
```

- [ ] **Step 2: Создать `web/src/api.ts`**

```ts
import type { ClientMessage, GameState, ServerMessage } from './types';

const MAX_RECONNECT_DELAY_MS = 10000;

export class GameClient {
  onState: (state: GameState) => void = () => {};
  onError: (message: string) => void = () => {};
  onStatus: (connected: boolean) => void = () => {};

  private ws: WebSocket | null = null;
  private attempt = 0;
  private closed = false;

  connect(): void {
    this.closed = false;
    this.open();
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }

  sendCapture(q: number, r: number): void {
    this.send({ type: 'capture', q, r });
  }

  sendAttack(q: number, r: number, points: number): void {
    this.send({ type: 'attack', q, r, points });
  }

  sendDefend(q: number, r: number, points: number): void {
    this.send({ type: 'defend', q, r, points });
  }

  private send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private open(): void {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws`);
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      this.onStatus(true);
    };

    ws.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.type === 'state') {
        this.onState(msg.game);
      } else if (msg.type === 'error') {
        this.onError(msg.message);
      }
    };

    ws.onclose = () => {
      this.onStatus(false);
      if (this.closed) return;
      const delay = Math.min(MAX_RECONNECT_DELAY_MS, 1000 * 2 ** this.attempt);
      this.attempt++;
      setTimeout(() => this.open(), delay);
    };
  }
}
```

- [ ] **Step 3: Обновить `web/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://api:3000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'http://api:3000',
        ws: true,
      },
    },
  },
});
```

- [ ] **Step 4: Проверить сборку**

Run: `cd web && npm run build`
Expected: `vue-tsc` без ошибок (App.vue пока не использует GameClient — типы уже валидны), `vite build` успешен.

- [ ] **Step 5: Проверить прокси WS в dev-стеке**

Vite перезапустится сам при изменении конфига. Затем:

Run: `cd server && node /tmp/opencode/ws-check.mjs`
Expected: `OPEN` и `STATE ... hexes=192` (уже без capture — гекс (7,6) занят, но состояние приходит; если capture вернёт ошибку «Гекс уже занят» — это нормально и доказывает персистентность).

---

### Task 6: Web — HexMap.vue с владельцами, битвами и кликом

**Files:**
- Modify: `web/src/components/HexMap.vue`

**Interfaces:**
- Consumes: types.ts — `Hex`, `TERRAIN_COLORS`, `PLAYER_COLOR` (Task 5).
- Produces:
  - Props: `{ hexes: Hex[]; humanId: number | null }`
  - Emits: `select` с `{ q: number; r: number }`
  - Внутренний `hovered: Ref<Hex | null>` (как раньше, для панели координат — панель убирается, координаты показывает ActionPanel).

- [ ] **Step 1: Переписать `web/src/components/HexMap.vue`**

```vue
<script setup lang="ts">
import { computed, ref } from 'vue';
import { PLAYER_COLOR, TERRAIN_COLORS, type Hex } from '../types';

const props = defineProps<{ hexes: Hex[]; humanId: number | null }>();

const emit = defineEmits<{ select: [hex: { q: number; r: number }] }>();

const HEX_SIZE = 30;
const SQRT3 = Math.sqrt(3);
const PADDING = 20;

const hovered = ref<Hex | null>(null);

function hexCenter(q: number, r: number): { x: number; y: number } {
  return {
    x: HEX_SIZE * SQRT3 * (q + r / 2),
    y: HEX_SIZE * (3 / 2) * r,
  };
}

function hexPoints(q: number, r: number): { points: string; minX: number; minY: number; maxX: number; maxY: number } {
  const { x, y } = hexCenter(q, r);
  const pts: string[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    const px = x + HEX_SIZE * Math.cos(angle);
    const py = y + HEX_SIZE * Math.sin(angle);
    pts.push(`${px.toFixed(2)},${py.toFixed(2)}`);
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
  }
  return { points: pts.join(' '), minX, minY, maxX, maxY };
}

const viewBox = computed(() => {
  const xs = props.hexes.map((h) => hexCenter(h.q, h.r).x);
  const ys = props.hexes.map((h) => hexCenter(h.q, h.r).y);
  const minX = Math.min(...xs) - HEX_SIZE - PADDING;
  const maxX = Math.max(...xs) + HEX_SIZE + PADDING;
  const minY = Math.min(...ys) - HEX_SIZE - PADDING;
  const maxY = Math.max(...ys) + HEX_SIZE + PADDING;
  return `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
});

function terrainFill(hex: Hex): string {
  return TERRAIN_COLORS[hex.terrain];
}

function tintFill(hex: Hex): string | null {
  if (hex.ownerId === null) return null;
  return hex.ownerId === props.humanId ? PLAYER_COLOR.human : PLAYER_COLOR.ai;
}

function battleOverlay(hex: Hex): { fill: string; y: number; height: number } | null {
  if (hex.attackerId === null) return null;
  const box = hexPoints(hex.q, hex.r);
  const attackerColor = hex.attackerId === props.humanId ? PLAYER_COLOR.human : PLAYER_COLOR.ai;
  const progress = Math.max(-1, Math.min(1, hex.battleProgress));
  let y: number;
  let height: number;
  if (progress >= 0) {
    y = box.minY;
    height = (box.maxY - box.minY) * progress;
  } else {
    y = box.minY + (box.maxY - box.minY) * (1 + progress);
    height = (box.maxY - box.minY) * -progress;
  }
  return { fill: attackerColor, y, height };
}

function battleText(hex: Hex): { a: number; d: number; leading: 'a' | 'd' } | null {
  if (hex.attackerId === null) return null;
  return { a: hex.attackInvestment, d: hex.defenseInvestment, leading: hex.attackInvestment >= hex.defenseInvestment ? 'a' : 'd' };
}
</script>

<template>
  <div class="hex-map">
    <svg :viewBox="viewBox" class="hex-map__svg">
      <defs>
        <clipPath v-for="hex in props.hexes.filter((h) => h.attackerId !== null)" :key="`clip-${hex.q}-${hex.r}`" :id="`clip-${hex.q}-${hex.r}`">
          <rect
            v-if="battleOverlay(hex)"
            :x="hexPoints(hex.q, hex.r).minX"
            :y="battleOverlay(hex)!.y"
            :width="hexPoints(hex.q, hex.r).maxX - hexPoints(hex.q, hex.r).minX"
            :height="battleOverlay(hex)!.height"
          />
        </clipPath>
      </defs>
      <g
        v-for="hex in props.hexes"
        :key="`${hex.q},${hex.r}`"
        class="hex-group"
        @click="emit('select', { q: hex.q, r: hex.r })"
        @mousemove="hovered = hex"
        @mouseleave="hovered = null"
      >
        <polygon :points="hexPoints(hex.q, hex.r).points" :fill="terrainFill(hex)" class="hex" />
        <polygon
          v-if="tintFill(hex)"
          :points="hexPoints(hex.q, hex.r).points"
          :fill="tintFill(hex)!"
          class="hex-tint"
        />
        <polygon
          v-if="battleOverlay(hex)"
          :points="hexPoints(hex.q, hex.r).points"
          :fill="battleOverlay(hex)!.fill"
          :clip-path="`url(#clip-${hex.q}-${hex.r})`"
          class="hex-battle"
        />
        <text
          v-if="battleText(hex)"
          :x="hexCenter(hex.q, hex.r).x"
          :y="hexCenter(hex.q, hex.r).y + 3"
          class="hex-battle-text"
          :fill="battleText(hex)!.leading === 'a' ? '#fff' : '#ffcdd2'"
        >
          {{ battleText(hex)!.a }} / {{ battleText(hex)!.d }}
        </text>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.hex-map {
  width: 100%;
  max-width: 1100px;
}

.hex-map__svg {
  display: block;
  width: 100%;
  height: auto;
}

.hex {
  stroke: #1a1a1a;
  stroke-width: 1.5;
  cursor: pointer;
  transition:
    stroke-width 0.12s ease,
    filter 0.12s ease;
}

.hex-group:hover .hex {
  stroke: #ffd54f;
  stroke-width: 3.5;
  filter: brightness(1.18);
}

.hex-tint {
  stroke: none;
  opacity: 0.35;
  pointer-events: none;
}

.hex-battle {
  stroke: #1a1a1a;
  stroke-width: 1.5;
  opacity: 0.55;
  pointer-events: none;
}

.hex-battle-text {
  font-size: 8px;
  font-family: monospace;
  text-anchor: middle;
  pointer-events: none;
  paint-order: stroke;
  stroke: rgba(0, 0, 0, 0.8);
  stroke-width: 2px;
}
</style>
```

- [ ] **Step 2: Проверить сборку**

Run: `cd web && npm run build`
Expected: `vue-tsc` без ошибок (App.vue пока не передаёт новые props — это временный build-failure, если так: сначала выполнить Task 7, который обновляет App.vue; допускается пропустить проверку сборки сейчас и вернуться после Task 7).

Примечание: если сборка падает из-за App.vue (не передаёт humanId), это ожидаемо — Task 7 чинит. В таком случае зафиксировать это в отчёте и продолжить.

---

### Task 7: Web — App.vue, Hud.vue, ActionPanel.vue

**Files:**
- Create: `web/src/components/Hud.vue`
- Create: `web/src/components/ActionPanel.vue`
- Modify: `web/src/App.vue`

**Interfaces:**
- Consumes: types.ts (Task 5), api.ts — `GameClient` (Task 5), HexMap.vue (Task 6).
- Produces:
  - `Hud.vue` — props `{ game: GameState; humanId: number | null }`; панель: очки/лимит, доход/сек (=гексы игрока), счёт гексов «Ты N vs ИИ M».
  - `ActionPanel.vue` — props `{ game: GameState; hex: Hex | null; humanId: number | null }`; emits `capture(q, r)`, `attack(q, r, points)`, `defend(q, r, points)`; показывает действие и кнопку (с учётом соседства, цены, битвы; решения клиента — UX-подсказки, сервер остаётся авторитетным).
  - `App.vue` — подключает GameClient; состояния: `game: Ref<GameState | null>`, `connected: Ref<boolean>`, `error: Ref<string | null>`, `selected: Ref<Hex | null>`; баннеры победы/подключения; рендер HUD + HexMap + ActionPanel.

- [ ] **Step 1: Создать `web/src/components/Hud.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue';
import type { GameState } from '../types';

const props = defineProps<{ game: GameState; humanId: number | null }>();

const human = computed(() => props.game.players.find((p) => p.id === props.humanId) ?? null);
const ai = computed(() => props.game.players.find((p) => p.isAi) ?? null);

const limit = computed(() => (human.value ? 1000 + human.value.hexCount * 50 : 0));
const income = computed(() => human.value?.hexCount ?? 0);
</script>

<template>
  <div class="hud">
    <div class="hud__block">
      <span class="hud__label">Очки</span>
      <span class="hud__value">{{ human?.points ?? '—' }} / {{ limit }}</span>
      <span class="hud__hint">лимит</span>
    </div>
    <div class="hud__block">
      <span class="hud__label">Доход</span>
      <span class="hud__value">+{{ income }}/сек</span>
    </div>
    <div class="hud__block">
      <span class="hud__label">Территория</span>
      <span class="hud__value"><span class="hud__you">Ты {{ human?.hexCount ?? 0 }}</span> / <span class="hud__ai">ИИ {{ ai?.hexCount ?? 0 }}</span></span>
    </div>
  </div>
</template>

<style scoped>
.hud {
  display: flex;
  gap: 24px;
  justify-content: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.hud__block {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  padding: 8px 16px;
  min-width: 120px;
}

.hud__label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #999;
}

.hud__value {
  font-size: 18px;
  font-weight: 600;
}

.hud__hint {
  font-size: 10px;
  color: #777;
}

.hud__you {
  color: #64b5f6;
}

.hud__ai {
  color: #ef9a9a;
}
</style>
```

- [ ] **Step 2: Создать `web/src/components/ActionPanel.vue`**

```vue
<script setup lang="ts">
import { computed, ref } from 'vue';
import { TERRAIN_COSTS, TERRAIN_LABELS, type GameState, type Hex } from '../types';

const props = defineProps<{ game: GameState; hex: Hex | null; humanId: number | null }>();

const emit = defineEmits<{
  capture: [q: number, r: number];
  attack: [q: number, r: number, points: number];
  defend: [q: number, r: number, points: number];
}>();

const TERRAIN_COSTS: Record<string, number> = {
  grass: 200,
  desert: 250,
  forest: 300,
  water: 400,
  mountain: 500,
};

const pointsInput = ref(200);

const human = computed(() => props.game.players.find((p) => p.id === props.humanId) ?? null);

function isAdjacent(a: Hex, b: Hex): boolean {
  const offsets: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, -1],
    [-1, 1],
  ];
  return offsets.some(([dq, dr]) => a.q + dq === b.q && a.r + dr === b.r);
}

function hexAt(q: number, r: number): Hex | null {
  return props.game.hexes.find((h) => h.q === q && h.r === r) ?? null;
}

const adjacentToMine = computed(() => {
  if (!props.hex || human.value === null) return false;
  return props.game.hexes.some(
    (h) => h.ownerId === props.humanId && isAdjacent(h, props.hex!),
  );
});

const state = computed(() => {
  if (props.game.winnerId !== null) return { kind: 'over' as const, text: 'Игра окончена' };
  if (!props.hex || human.value === null) return { kind: 'none' as const, text: 'Кликни по гексу' };

  const hex = props.hex;
  const myHexes = human.value.hexCount;
  const cost = TERRAIN_COSTS[hex.terrain];

  if (hex.ownerId === null && hex.attackerId === null) {
    if (myHexes === 0) {
      return { kind: 'capture' as const, free: true, cost: 0, text: 'Первый гекс — бесплатно' };
    }
    if (!adjacentToMine.value) return { kind: 'invalid' as const, text: 'Не соседний с твоей территорией' };
    if (human.value.points < cost) return { kind: 'invalid' as const, text: 'Не хватает очков' };
    return { kind: 'capture' as const, free: false, cost, text: `Захватить за ${cost}` };
  }

  if (hex.attackerId !== null) {
    if (hex.ownerId === null) {
      if (hex.attackerId === props.humanId) {
        return { kind: 'attack' as const, text: 'Усилить захват' };
      }
      if (adjacentToMine.value) {
        return { kind: 'defend' as const, text: 'Вступить в битву' };
      }
      return { kind: 'invalid' as const, text: 'Идёт борьба (гекс не у твоей границы)' };
    }
    if (hex.ownerId === props.humanId) {
      return { kind: 'defend' as const, text: 'Защитить гекс' };
    }
    if (hex.attackerId === props.humanId) {
      return { kind: 'attack' as const, text: 'Усилить атаку' };
    }
    return { kind: 'invalid' as const, text: 'Битву ведёт соперник' };
  }

  if (hex.ownerId === props.humanId) {
    return { kind: 'owned' as const, text: 'Твой гекс' };
  }

  if (hex.ownerId !== null && !adjacentToMine.value) {
    return { kind: 'invalid' as const, text: 'Не соседний с твоей территорией' };
  }

  return { kind: 'attack' as const, text: 'Атаковать' };
});

function submit(): void {
  if (!props.hex) return;
  const kind = state.value.kind;
  const points = Math.max(1, Math.floor(Number(pointsInput.value) || 0));
  if (kind === 'capture') {
    emit('capture', props.hex.q, props.hex.r);
  } else if (kind === 'attack') {
    emit('attack', props.hex.q, props.hex.r, points);
  } else if (kind === 'defend') {
    emit('defend', props.hex.q, props.hex.r, points);
  }
}
</script>

<template>
  <div class="action-panel">
    <template v-if="hex">
      <div class="action-panel__hex">
        q={{ hex.q }}, r={{ hex.r }} — {{ TERRAIN_LABELS[hex.terrain] }}
        <span v-if="hex.attackerId !== null"> · БИТВА {{ hex.attackInvestment }} / {{ hex.defenseInvestment }}</span>
      </div>
      <div v-if="state.kind === 'capture'" class="action-panel__row">
        <span>{{ state.text }}</span>
        <button class="action-panel__btn" @click="submit()">Захватить</button>
      </div>
      <div v-else-if="state.kind === 'attack'" class="action-panel__row">
        <span>{{ state.text }}</span>
        <input v-model.number="pointsInput" type="number" min="1" class="action-panel__input" />
        <button class="action-panel__btn" @click="submit()">Вложить</button>
      </div>
      <div v-else-if="state.kind === 'defend'" class="action-panel__row">
        <span>{{ state.text }}</span>
        <input v-model.number="pointsInput" type="number" min="1" class="action-panel__input" />
        <button class="action-panel__btn" @click="submit()">Защитить</button>
      </div>
      <div v-else class="action-panel__row action-panel__muted">
        {{ state.text }}
      </div>
    </template>
    <div v-else class="action-panel__muted">Кликни по гексу</div>
  </div>
</template>

<style scoped>
.action-panel {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  padding: 12px 16px;
  min-height: 60px;
}

.action-panel__hex {
  font-family: monospace;
  color: #ccc;
}

.action-panel__row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.action-panel__input {
  width: 90px;
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid #555;
  background: #2a2a31;
  color: #fff;
}

.action-panel__btn {
  padding: 6px 14px;
  border: none;
  border-radius: 6px;
  background: #2196f3;
  color: #fff;
  font-weight: 600;
  cursor: pointer;
}

.action-panel__btn:hover {
  background: #1976d2;
}

.action-panel__muted {
  color: #888;
}
</style>
```

Примечание: `TERRAIN_COSTS` дублируется на фронте (клиент — только UX-подсказки, сервер авторитетный). Это осознанный компромисс для простоты.

- [ ] **Step 3: Переписать `web/src/App.vue`**

```vue
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import ActionPanel from './components/ActionPanel.vue';
import HexMap from './components/HexMap.vue';
import Hud from './components/Hud.vue';
import { GameClient } from './api';
import type { GameState, Hex } from './types';

const game = ref<GameState | null>(null);
const connected = ref(false);
const error = ref<string | null>(null);
const selected = ref<Hex | null>(null);

const client = new GameClient();
client.onState = (state) => {
  game.value = state;
  error.value = null;
  if (selected.value) {
    const fresh = state.hexes.find((h) => h.q === selected.value!.q && h.r === selected.value!.r);
    selected.value = fresh ?? null;
  }
};
client.onError = (message) => {
  error.value = message;
};
client.onStatus = (isConnected) => {
  connected.value = isConnected;
};

const humanId = computed(() => game.value?.players.find((p) => !p.isAi)?.id ?? null);
const winner = computed(() => {
  if (!game.value?.winnerId) return null;
  const w = game.value.players.find((p) => p.id === game.value!.winnerId);
  return w ? (w.isAi ? 'ИИ' : 'Ты') : null;
});

function onSelect(pos: { q: number; r: number }): void {
  selected.value = game.value?.hexes.find((h) => h.q === pos.q && h.r === pos.r) ?? null;
}

function onCapture(q: number, r: number): void {
  client.sendCapture(q, r);
}

function onAttack(q: number, r: number, points: number): void {
  client.sendAttack(q, r, points);
}

function onDefend(q: number, r: number, points: number): void {
  client.sendDefend(q, r, points);
}

onMounted(() => {
  client.connect();
});

onBeforeUnmount(() => {
  client.close();
});
</script>

<template>
  <main class="app">
    <h1>Conquest</h1>
    <div v-if="winner" class="banner banner--win">Победа: {{ winner }}!</div>
    <div v-else-if="!connected" class="banner banner--warn">Подключение…</div>
    <div v-else-if="!game" class="banner banner--warn">Ожидание состояния…</div>
    <div v-if="error" class="banner banner--error">{{ error }}</div>
    <Hud v-if="game" :game="game" :human-id="humanId" />
    <HexMap v-if="game" :hexes="game.hexes" :human-id="humanId" @select="onSelect" />
    <ActionPanel v-if="game" :game="game" :hex="selected" :human-id="humanId" @capture="onCapture" @attack="onAttack" @defend="onDefend" />
  </main>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px;
}

.banner {
  padding: 8px 20px;
  border-radius: 8px;
  margin-bottom: 12px;
  font-weight: 600;
}

.banner--win {
  background: #2e7d32;
  color: #fff;
}

.banner--warn {
  background: #555;
  color: #fff;
}

.banner--error {
  background: #c62828;
  color: #fff;
}
</style>
```

- [ ] **Step 4: Проверить сборку**

Run: `cd web && npm run build`
Expected: `vue-tsc` без ошибок, `vite build` успешен.

---

### Task 8: nginx — WS-прокси для prod

**Files:**
- Modify: `docker/web/nginx.conf`

**Interfaces:**
- Consumes: ничего нового.
- Produces: prod-стек на 8080 передаёт WS `/ws` до api.

- [ ] **Step 1: Обновить `docker/web/nginx.conf`**

```nginx
server {
    listen 80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    location /api/ {
        proxy_pass http://api:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /ws {
        proxy_pass http://api:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

- [ ] **Step 2: Пересобрать и проверить prod-стек**

```bash
docker compose -f docker-compose.prod.yml up -d --build
sleep 10
curl -s localhost:8080/api/map | head -c 80
```

Expected: JSON с hexes. Затем проверка WS через prod-порт — временный скрипт `/tmp/opencode/ws-prod.mjs` (тот же код, что ws-check.mjs, но URL `ws://localhost:8080/ws`, без send — только состояние):

```js
import WebSocket from '/home/oleg/code/conquest/server/node_modules/ws/wrapper.mjs';

const ws = new WebSocket('ws://localhost:8080/ws');
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === 'state') {
    console.log('PROD STATE: players=', JSON.stringify(msg.game.players), 'hexes=', msg.game.hexes.length);
    ws.close();
    process.exit(0);
  }
});
ws.on('open', () => console.log('PROD OPEN'));
```

Run: `node /tmp/opencode/ws-prod.mjs`
Expected: `PROD OPEN` → `PROD STATE: players=... hexes=192` → выход с кодом 0.

---

### Task 9: Итоговая приёмка

**Files:** нет (только проверки).

- [ ] **Step 1: Проверить dev-стек целиком**

```bash
docker compose ps --format "table {{.Name}}\t{{.Status}}"
curl -s localhost:5173/ | grep -o 'id="app"' | head -1
```

Expected: все три контейнера Up, HTML с `id="app"`.

- [ ] **Step 2: Полный цикл действий через WS (временный скрипт)**

Создать `/tmp/opencode/ws-full.mjs`:

```js
import WebSocket from '/home/oleg/code/conquest/server/node_modules/ws/wrapper.mjs';

const ws = new WebSocket('ws://localhost:5173/ws');
let step = 0;
let lastState = null;

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === 'error') {
    console.log('ERROR:', msg.message);
    return;
  }
  lastState = msg.game;
  const human = msg.game.players.find((p) => !p.isAi);
  const ai = msg.game.players.find((p) => p.isAi);
  console.log(`t=${step} pts=${human.points} you=${human.hexCount} ai=${ai.hexCount} winner=${msg.game.winnerId}`);
  if (step === 0) {
    const free = msg.game.hexes.find((h) => h.ownerId === null && h.attackerId === null);
    if (free) ws.send(JSON.stringify({ type: 'capture', q: free.q, r: free.r }));
  } else if (step === 1) {
    // первый захват должен был пройти: ищем гекс рядом с ним
    const mine = msg.game.hexes.find((h) => h.ownerId === human.id);
    if (!mine) { console.log('FAIL: первый захват не прошёл'); process.exit(1); }
    const neighbors = [[1,0],[-1,0],[0,1],[0,-1],[1,-1],[-1,1]]
      .map(([dq, dr]) => msg.game.hexes.find((h) => h.q === mine.q + dq && h.r === mine.r + dr && h.ownerId === null && h.attackerId === null))
      .filter(Boolean);
    if (neighbors.length === 0) { console.log('OK: соседей-нейтральных нет (территория занята)'); ws.close(); process.exit(0); }
    ws.send(JSON.stringify({ type: 'capture', q: neighbors[0].q, r: neighbors[0].r }));
  } else if (step === 2) {
    const mine = msg.game.hexes.filter((h) => h.ownerId === human.id);
    if (mine.length < 2) { console.log('FAIL: второй захват не прошёл'); process.exit(1); }
    console.log('OK: два гекса у игрока, очки списаны:', mine.length === 2);
    ws.close();
    process.exit(0);
  }
  step++;
});

ws.on('open', () => console.log('OPEN'));
```

Run: `cd server && node /tmp/opencode/ws-full.mjs`
Expected: `OPEN`, `t=0 ...`, `t=1 ...`, `t=2 ...` и `OK: два гекса у игрока`, выход 0. (Если поле уже плотно занято прошлыми прогонами — допускается `OK: соседей-нейтральных нет` при условии, что первый захват прошёл, а второй не нашёл нейтрального соседа — это тоже PASS, зафиксировать что именно.)

- [ ] **Step 3: Битва вживую**

Выбрать любой гекс ИИ, соседний с территорией игрока (найти через небольшой скрипт или вручную из состояния). Отправить `attack` с points=500, затем через ~2 сек отправить ещё `attack` points=500 (долив), понаблюдать `battleProgress` и `attackInvestment` в логах скрипта. Если ИИ вступил в оборону — увидим рост `defenseInvestment`. Зафиксировать наблюдения. (Цель — подтвердить, что шкала движется и вложения списываются; полный захват не обязателен.)

- [ ] **Step 4: Перезапуск API**

Run: `docker compose restart api && sleep 8 && curl -s localhost:5173/ | grep -c 'id="app"'`
Expected: API поднялся (в логах `Map already seeded`, `Game started`), фронт переподключится по WS (проверить в браузере или скриптом ws-full: состояние приходит с прежним числом гексов игрока).

- [ ] **Step 5: Проверить, что у каждого игрока есть стартовые очки 1000**

Из состояния: `pts=1000` на `t=0` у игрока; у ИИ также 1000 (проверить в выводе скрипта ws-full на t=0 — вывести `ai.points` тоже, если нужно).

## Self-Review

**Покрытие спеки:**
- Экономика (доход/лимит/старт) → Task 1 (applyIncome, pointLimit), Task 7 (Hud). ✓
- Стоимости террейнов → Task 1. ✓
- Первый бесплатный захват → Task 1. ✓
- Захват у границы соперника → битва → Task 1, Task 2 (оспорить), Task 3 (applyCapture через rules). ✓
- Битвы: шкала ±1, шаг 0.1, возвраты/сгорание → Task 1. ✓
- Победа ≥97 → Task 1 (computeWinner), Task 7 (баннер). ✓
- ИИ приоритеты 1-4 → Task 2. ✓
- Тик-движок 1 сек (доход→битвы→ИИ→победа→персист→рассылка) → Task 4 (index.ts + ws.ts broadcast), Task 3 (tick). ✓
- WS-протокол и валидация → Task 3 (handleAction), Task 4 (ws.ts). ✓
- Переподключение с бэкоффом → Task 5 (api.ts). ✓
- Прокси Vite/nginx → Task 5, Task 8. ✓
- Фронт: цвета/тоны, полоса битвы, клик, HUD, панель действий, баннеры → Task 6, Task 7. ✓
- Персистентность и перезапуск → Task 3 (persistGame), Task 4 Step 6, Task 9 Step 4. ✓
- Тесты rules + ai → Task 1, Task 2. ✓

**Проверка на плейсхолдеры:** весь код в шагах полный; команды с ожидаемым результатом. ✓

**Консистентность типов:** `HexState`/`GameState` из rules.ts переиспользуются в db.ts/game.ts; фронтовые типы (`Hex`/`GameState`/`Player`) определены в Task 5 и используются в Task 6/7 без переименований. `ServerGameState` в game.ts — только для WS-сериализации. `humanId`/`aiId` — из Task 3 в Task 4. ✓
