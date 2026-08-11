# Настройка игры, комнаты, N игроков — план реализации (Этап 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заменить двухигровую модель на комнаты (лобби create/join), 5 типов карт с генерацией формы, N игроков (люди + ИИ) и победу 50%+1.

**Architecture:** Сервер: комнаты в памяти (`RoomManager` + `Room`), один тик-луп по всем комнатам, WebSocket-маршрутизация по комнате. `GameService` удаляется. БД упрощается до таблицы игроков (идентичность); состояние игр не персистится. Клиент: экраны меню → настройка с компом / лобби → комната → игра, палитра цветов по номеру слота.

**Tech Stack:** Node TS (express/ws), Vue 3 (script setup), SVG.

## Global Constraints

- Типы карт: `normal` (16×12=192, 2–5), `long` (24×9=216, 2–4), `island` (15×13=195, суша ~120–160, 2–4), `round` (19×19, круг r=9, 271, 2–6), `belarus` (20×13=260, суша 188, 2–5).
- Победа: `floor(всего_гексов / 2) + 1`.
- Комнаты: игра всегда стартует полной — АИ = `maxPlayers − люди`. Соло-режим: 1 человек + ровно `aiCount` компов (1..maxPlayers−1).
- Старт комнаты — только хозяин. Хозяин лобби ушёл → передача первому оставшемуся; пустая комната удаляется.
- Игрок отключился во время игры → слот навсегда занимает ИИ, возврат невозможен.
- Пауза — только в соло-режиме (`aiMode`).
- Механика битв из Этапа 1 не меняется.
- Тесты сервера: `npm test` (vitest), сборка `npm run build` (tsc) в `server/`; web: `npm run build` (vue-tsc -b && vite build) в `web/`.

---

### Task 1: Типы карт — генерация и пресеты

**Files:**
- Modify: `server/src/map.ts` (полная замена)
- Modify: `server/src/db.ts` (минимальный фикс вызова generateMap, чтобы сборка не падала)
- Modify: `server/src/index.ts` (то же)
- Test: `server/test/map.test.ts` (полная замена)

**Interfaces:**
- Produces: `MapType = 'normal' | 'long' | 'island' | 'round' | 'belarus'`; `MAP_PRESETS: Record<MapType, MapPreset>` (`{ columns, rows, minPlayers, maxPlayers, recommendedAi }`); `generateMap(type: MapType = 'normal'): Hex[]`; `MAP_COLUMNS`/`MAP_ROWS` (16/12, из пресета normal).

- [ ] **Step 1: Написать тесты (RED)**

Полностью замени `server/test/map.test.ts` на:

```ts
import { describe, expect, it } from 'vitest';
import { generateMap, MAP_PRESETS, MAP_COLUMNS, MAP_ROWS, TERRAINS, type MapType } from '../src/map.js';

describe('generateMap', () => {
  it('обычная: ровно 16*12 = 192 гекса', () => {
    expect(generateMap('normal')).toHaveLength(MAP_COLUMNS * MAP_ROWS);
  });
  it('возвращает уникальные координаты', () => {
    const hexes = generateMap('normal');
    const keys = new Set(hexes.map((h) => `${h.q},${h.r}`));
    expect(keys.size).toBe(hexes.length);
  });
  it('использует только известные типы местности', () => {
    for (const hex of generateMap('normal')) {
      expect(TERRAINS).toContain(hex.terrain);
    }
  });
  it('длинная: 24*9 = 216 гексов', () => {
    expect(generateMap('long')).toHaveLength(216);
  });
  it('круглая: 271 гекс (круг радиусом 9)', () => {
    expect(generateMap('round')).toHaveLength(271);
  });
  it('остров: суша 120–160 гексов, остальное — вода', () => {
    const hexes = generateMap('island');
    expect(hexes).toHaveLength(15 * 13);
    const land = hexes.filter((h) => h.terrain !== 'water').length;
    expect(land).toBeGreaterThanOrEqual(120);
    expect(land).toBeLessThanOrEqual(160);
    expect(hexes.filter((h) => h.terrain === 'water').length).toBeGreaterThan(0);
  });
  it('беларусь: суша 160–200 гексов, остальное — вода', () => {
    const hexes = generateMap('belarus');
    expect(hexes).toHaveLength(20 * 13);
    const land = hexes.filter((h) => h.terrain !== 'water').length;
    expect(land).toBeGreaterThanOrEqual(160);
    expect(land).toBeLessThanOrEqual(200);
    expect(hexes.filter((h) => h.terrain === 'water').length).toBeGreaterThan(0);
  });
  it('все гексы в границах пресета', () => {
    for (const type of ['normal', 'long', 'island', 'round', 'belarus'] as MapType[]) {
      const preset = MAP_PRESETS[type];
      for (const hex of generateMap(type)) {
        expect(hex.q).toBeGreaterThanOrEqual(0);
        expect(hex.q).toBeLessThan(preset.columns);
        expect(hex.r).toBeGreaterThanOrEqual(0);
        expect(hex.r).toBeLessThan(preset.rows);
      }
    }
  });
});
```

- [ ] **Step 2: Прогнать тесты — должны упасть**

Run: `npm test` (workdir: `server`)
Expected: FAIL (map.test.ts не компилируется: `generateMap()` без аргумента больше нет).

- [ ] **Step 3: Переписать map.ts**

Полностью замени `server/src/map.ts` на:

```ts
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
}

export const MAP_PRESETS: Record<MapType, MapPreset> = {
  normal: { columns: 16, rows: 12, minPlayers: 2, maxPlayers: 5, recommendedAi: 1 },
  long: { columns: 24, rows: 9, minPlayers: 2, maxPlayers: 4, recommendedAi: 1 },
  island: { columns: 15, rows: 13, minPlayers: 2, maxPlayers: 4, recommendedAi: 1 },
  round: { columns: 19, rows: 19, minPlayers: 2, maxPlayers: 6, recommendedAi: 1 },
  belarus: { columns: 20, rows: 13, minPlayers: 2, maxPlayers: 5, recommendedAi: 1 },
};

export const MAP_COLUMNS = MAP_PRESETS.normal.columns;
export const MAP_ROWS = MAP_PRESETS.normal.rows;
export const MOUNTAIN_TO_MINE_CHANCE = config.mineChance;

// Контур Беларуси: для каждой строки r диапазон q (минимальный, максимальный).
const BELARUS_ROWS: [number, number][] = [
  [3, 12],
  [2, 13],
  [2, 14],
  [2, 15],
  [2, 16],
  [3, 17],
  [3, 18],
  [2, 18],
  [1, 18],
  [1, 18],
  [2, 17],
  [3, 16],
  [5, 14],
];

export function generateMap(type: MapType = 'normal'): Hex[] {
  const preset = MAP_PRESETS[type];
  const hexes: Hex[] = [];
  for (let r = 0; r < preset.rows; r++) {
    for (let q = 0; q < preset.columns; q++) {
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

function randomTerrain(): Terrain {
  let terrain = TERRAINS[Math.floor(Math.random() * TERRAINS.length)];
  if (terrain === 'mine') terrain = 'mountain';
  if (terrain === 'mountain' && Math.random() < config.mineChance) terrain = 'mine';
  return terrain;
}
```

- [ ] **Step 4: Починить вызовы generateMap в db.ts и index.ts (сборка)**

В `server/src/db.ts` замени `const generated = generateMap(MAP_COLUMNS, MAP_ROWS);` на `const generated = generateMap('normal');`.
В `server/src/index.ts` замени `const hexes = generateMap(MAP_COLUMNS, MAP_ROWS);` на `const hexes = generateMap('normal');`
(Полная чистка db.ts/index.ts — в Task 6; здесь только чтобы сборка была зелёной.)

- [ ] **Step 5: Прогнать тесты и сборку**

Run: `npm test && npm run build` (workdir: `server`)
Expected: PASS, tsc без ошибок.

- [ ] **Step 6: Коммит**

```bash
git add server/src/map.ts server/src/db.ts server/src/index.ts server/test/map.test.ts
git commit -m "feat: типы карт (обычная, длинная, остров, круглая, беларусь)"
```

---

### Task 2: Правила N игроков и победа 50%+1

**Files:**
- Modify: `server/src/rules.ts`
- Test: `server/test/rules.test.ts`

**Interfaces:**
- Produces: `winHexCount(totalHexes: number): number` (заменяет `WIN_HEX_COUNT`); `hasAdjacentOtherOwner(state, q, r, playerId): boolean`; `opponentId` удаляется; `applyCapture` создаёт битву при соседстве с любым другим игроком; `computeWinner` использует `winHexCount(state.hexes.length)`.

- [ ] **Step 1: Обновить rules.ts**

В `server/src/rules.ts`:

1. Удали `export const WIN_HEX_COUNT = config.winHexCount;` (строка 10) и добавь функцию:

```ts
export function winHexCount(totalHexes: number): number {
  return Math.floor(totalHexes / 2) + 1;
}
```

2. Удали функцию `opponentId` (строки 159-161) и добавь вместо неё:

```ts
function hasAdjacentOtherOwner(state: GameState, q: number, r: number, playerId: number): boolean {
  return NEIGHBOR_OFFSETS.some(([dq, dr]) => {
    const nq = q + dq;
    const nr = r + dr;
    if (!isInBounds(nq, nr)) return false;
    const hex = findHex(state, nq, nr);
    return hex !== undefined && hex.ownerId !== null && hex.ownerId !== playerId;
  });
}
```

3. В `applyCapture` замени условие `if (hasAdjacentOwner(state, q, r, opponentId(state, playerId)))` на `if (hasAdjacentOtherOwner(state, q, r, playerId))`.

4. В `computeWinner` замени `WIN_HEX_COUNT` на `winHexCount(state.hexes.length)`:

```ts
export function computeWinner(state: GameState): void {
  if (state.winnerId !== null) return;
  const target = winHexCount(state.hexes.length);
  for (const player of state.players) {
    if (hexCount(state, player.id) >= target) {
      state.winnerId = player.id;
      return;
    }
  }
}
```

(Удаляется также неиспользуемый ключ `winHexCount` из `config.ts` — он больше никому не нужен.)

- [ ] **Step 2: Обновить config.ts**

В `server/src/config.ts` удали строку `winHexCount: number('CONQUEST_WIN_HEX_COUNT', 97),`.

- [ ] **Step 3: Обновить тесты (правила N игроков)**

В `server/test/rules.test.ts`:

1. В import замени `WIN_HEX_COUNT,` на `winHexCount,`.
2. Блок `победа` замени целиком:

```ts
describe('победа', () => {
  it('победа при 50%+1 гексов (97 из 192)', () => {
    const s = makeState();
    for (let i = 0; i < 96; i++) s.hexes[i].ownerId = P;
    computeWinner(s);
    expect(s.winnerId).toBeNull();
    s.hexes[96].ownerId = P;
    computeWinner(s);
    expect(s.winnerId).toBe(P);
  });
  it('победа для N игроков', () => {
    const s = makeState([], [{ id: 1, points: 1000 }, { id: 2, points: 1000 }, { id: 3, points: 1000 }]);
    const target = winHexCount(s.hexes.length);
    for (let i = 0; i < target; i++) s.hexes[i].ownerId = 1;
    computeWinner(s);
    expect(s.winnerId).toBe(1);
  });
});
```

3. В блоке `вспомогательные` замени `expect(WIN_HEX_COUNT).toBe(97);` на `expect(winHexCount(192)).toBe(97);`.

4. Добавь новый блок после `описание 'атака на гекс соперника'`:

```ts
describe('N игроков', () => {
  function makeState3(hexes: Partial<HexState>[] = []): GameState {
    return makeState(hexes, [
      { id: 1, points: 1000 },
      { id: 2, points: 1000 },
      { id: 3, points: 1000 },
    ]);
  }
  it('захват нейтрального гекса рядом с любым соперником порождает битву', () => {
    const s = makeState3([{ q: 5, r: 5, ownerId: 3 }, { q: 6, r: 5, ownerId: 1 }]);
    applyCapture(s, 2, 4, 5);
    const hex = findHex(s, 4, 5)!;
    expect(hex.attackerId).toBe(2);
    expect(hex.attackInvestment).toBe(1);
  });
  it('нейтральный спорный гекс может защищать любой соседний игрок', () => {
    const s = makeState3([{ q: 4, r: 5, attackerId: 1, attackInvestment: 300 }, { q: 5, r: 5, ownerId: 3 }]);
    expect(validateDefend(s, 3, 4, 5, 100).ok).toBe(true);
    expect(validateDefend(s, 2, 4, 5, 100).ok).toBe(false);
  });
  it('атаковать можно гекс любого соперника', () => {
    const s = makeState3([{ q: 5, r: 5, ownerId: 3 }, { q: 6, r: 5, ownerId: 1 }]);
    expect(validateAttack(s, 2, 5, 5, 150).ok).toBe(true);
  });
  it('свой гекс атаковать нельзя', () => {
    const s = makeState3([{ q: 5, r: 5, ownerId: 2 }]);
    expect(validateAttack(s, 2, 5, 5, 150).ok).toBe(false);
  });
});
```

- [ ] **Step 4: Прогнать тесты и сборку**

Run: `npm test && npm run build` (workdir: `server`)
Expected: PASS (правила 2-игровые не сломаны), tsc без ошибок.

- [ ] **Step 5: Коммит**

```bash
git add server/src/rules.ts server/src/config.ts server/test/rules.test.ts
git commit -m "feat: правила N игроков и победа 50%+1"
```

---

### Task 3: ИИ для N игроков

**Files:**
- Modify: `server/src/ai.ts`
- Test: `server/test/ai.test.ts`

**Interfaces:**
- Produces: `chooseAiAction(state: GameState, aiId: number): AiAction | null` (параметр `playerId` удаляется — враг = любой другой игрок); `chooseFirstCapture(state, aiId)` — вдали от всех владений.

- [ ] **Step 1: Обновить ai.ts**

Полностью замени `server/src/ai.ts` на:

```ts
import { findHex, hexCount, hasAdjacentOwner, terrainCost, type GameState } from './rules.js';

export type AiAction =
  | { type: 'defend'; q: number; r: number; points: number }
  | { type: 'capture'; q: number; r: number }
  | { type: 'attack'; q: number; r: number; points: number };

export function chooseAiAction(state: GameState, aiId: number): AiAction | null {
  const ai = state.players.find((p) => p.id === aiId);
  if (!ai) return null;

  const aiHexCount = hexCount(state, aiId);
  if (aiHexCount === 0) {
    return chooseFirstCapture(state, aiId);
  }

  for (const hex of state.hexes) {
    if (hex.attackerId === null || hex.attackerId === aiId) continue;
    const contestable =
      hex.ownerId === aiId || (hex.ownerId === null && hasAdjacentOwner(state, hex.q, hex.r, aiId));
    if (!contestable) continue;
    if (hex.defenseInvestment === 0 && hex.attackInvestment > 0) {
      const invest = Math.min(ai.points, hex.attackInvestment + 1);
      if (invest >= 1) return { type: 'defend', q: hex.q, r: hex.r, points: invest };
    }
    if (hex.attackInvestment >= hex.defenseInvestment) {
      const invest = Math.min(ai.points, hex.attackInvestment - hex.defenseInvestment + 1);
      if (invest >= 1) return { type: 'defend', q: hex.q, r: hex.r, points: invest };
    }
  }

  for (const hex of state.hexes) {
    if (hex.attackerId !== aiId) continue;
    if (hex.attackInvestment <= hex.defenseInvestment) {
      const invest = Math.min(ai.points, hex.defenseInvestment - hex.attackInvestment + 1);
      if (invest >= 1) return { type: 'attack', q: hex.q, r: hex.r, points: invest };
    }
  }

  const affordableNeutral = state.hexes
    .filter((hex) => hex.ownerId === null && hex.attackerId === null && hasAdjacentOwner(state, hex.q, hex.r, aiId))
    .filter((hex) => terrainCost(hex.terrain) <= ai.points)
    .sort((a, b) => terrainCost(a.terrain) - terrainCost(b.terrain));
  if (affordableNeutral.length > 0) {
    const hex = affordableNeutral[0];
    return { type: 'capture', q: hex.q, r: hex.r };
  }

  const enemyHexes = state.hexes.filter(
    (hex) => hex.ownerId !== null && hex.ownerId !== aiId && hasAdjacentOwner(state, hex.q, hex.r, aiId),
  );
  if (enemyHexes.length > 0) {
    const hex = enemyHexes.sort((a, b) => terrainCost(a.terrain) - terrainCost(b.terrain))[0];
    const cost = terrainCost(hex.terrain);
    if (ai.points >= cost) return { type: 'attack', q: hex.q, r: hex.r, points: cost };
  }

  return null;
}

function hasAnyAdjacentOwner(state: GameState, q: number, r: number): boolean {
  const offsets: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, -1],
    [-1, 1],
  ];
  for (const [dq, dr] of offsets) {
    const hex = findHex(state, q + dq, r + dr);
    if (hex !== undefined && hex.ownerId !== null) return true;
  }
  return false;
}

function chooseFirstCapture(state: GameState, aiId: number): AiAction | null {
  const free = state.hexes.filter((hex) => hex.ownerId === null && hex.attackerId === null);
  if (free.length === 0) return null;
  const enemyHexes = state.hexes.filter((hex) => hex.ownerId !== null && hex.ownerId !== aiId);
  if (enemyHexes.length === 0) {
    return { type: 'capture', q: free[0].q, r: free[0].r };
  }
  const candidates = free.filter((hex) => !hasAnyAdjacentOwner(state, hex.q, hex.r));
  if (candidates.length === 0) return null;
  let best = candidates[0];
  let bestDist = -Infinity;
  for (const hex of candidates) {
    const dist = Math.min(...enemyHexes.map((ph) => hexDistance(hex, ph)));
    if (dist > bestDist) {
      bestDist = dist;
      best = hex;
    }
  }
  return { type: 'capture', q: best.q, r: best.r };
}

function hexDistance(a: { q: number; r: number }, b: { q: number; r: number }): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}
```

- [ ] **Step 2: Обновить ai.test.ts**

В `server/test/ai.test.ts`:
- Во всех вызовах `chooseAiAction(s, AI, P)` замени на `chooseAiAction(s, AI)`.
- В тесте `приоритет 0: без гексов — первый бесплатный захват вдали от игрока` замени проверку:

```ts
    expect(hasAdjacentOwner(s, hex.q, hex.r, P)).toBe(false);
```
на (нет соседних владений вообще):

```ts
    const neighbors = [
      [hex.q + 1, hex.r],
      [hex.q - 1, hex.r],
      [hex.q, hex.r + 1],
      [hex.q, hex.r - 1],
      [hex.q + 1, hex.r - 1],
      [hex.q - 1, hex.r + 1],
    ];
    expect(neighbors.some(([nq, nr]) => s.hexes.find((h) => h.q === nq && h.r === nr)?.ownerId !== null)).toBe(false);
```

- Удали неиспользуемый импорт `hasAdjacentOwner` из шапки теста (если он остался неиспользованным после правки).
- Добавь в конец describe-блока:

```ts
  it('N игроков: защищает свой гекс от любого атакующего', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: 2, attackerId: 1, attackInvestment: 400, battleProgress: 3 }]);
    expect(chooseAiAction(s, 2)).toEqual({ type: 'defend', q: 6, r: 5, points: 401 });
  });
  it('N игроков: атакует границу любого соперника', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: 2, terrain: 'mountain' }, { q: 5, r: 5, ownerId: 1 }], 450);
    expect(chooseAiAction(s, 2)).toEqual({ type: 'attack', q: 5, r: 5, points: 150 });
  });
```

- [ ] **Step 3: Починить вызов в game.ts (сборка)**

`server/src/game.ts` (удаляется в Task 6, но должен компилироваться до тех пор) вызывает ИИ со старым параметром. Замени в `server/src/game.ts`:

```ts
        const aiAction = chooseAiAction(this.state, this.aiId, this.humanId);
```
на:
```ts
        const aiAction = chooseAiAction(this.state, this.aiId);
```

- [ ] **Step 4: Прогнать тесты и сборку**

Run: `npm test && npm run build` (workdir: `server`)
Expected: PASS, tsc без ошибок.

- [ ] **Step 5: Коммит**

```bash
git add server/src/ai.ts server/src/game.ts server/test/ai.test.ts
git commit -m "feat: ИИ для N игроков — враг любой другой игрок"
```

---

### Task 4: Комнаты — класс Room (ядро сессии)

**Files:**
- Create: `server/src/rooms.ts` (часть 1: класс Room)
- Test: `server/test/rooms.test.ts` (часть 1: тесты Room)

**Interfaces:**
- Produces: типы `RoomStatus`, `RoomSlot`, `RoomView`, `ActionResult`; класс `Room` с полями/методами:
  - `constructor(id, name, mapType, maxPlayers, aiMode, aiCount)`;
  - `status: RoomStatus`, `hostPlayerId: number | null`, `paused: boolean`;
  - `get gameState(): GameState | null`;
  - `addHuman(name, connId): number | null` — слот или null если комната полна/играет;
  - `slotForConn(connId): number | null`;
  - `removeHuman(connId): void` — только в waiting (ренумерация слотов, передача хозяина);
  - `start(connId): { ok: true } | { ok: false; error: string }` — хозяин; AI добивают: `aiMode ? aiCount : maxPlayers − слоты`;
  - `tick(): void` — доход, битвы, окружение, действия всех AI, победа;
  - `handleAction(connId, type, msg): ActionResult` — capture/attack/defend/pause (пауза только aiMode);
  - `humanDisconnected(connId): void` — waiting: removeHuman; playing: слот → AI навсегда;
  - `updateName(connId, name): void`;
  - `view(): RoomView`;
  - getters `slotsCount`, `humanCount`, `isEmpty`;
  - `addLog(msg)`, `playerName(id)`.
- Consumes: `MAP_PRESETS`/`generateMap` (Task 1), `rules` (Task 2), `chooseAiAction` (Task 3).

- [ ] **Step 1: Написать тесты Room (RED)**

Создай `server/test/rooms.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Room } from '../src/rooms.js';

function makeRoom(aiMode = false, aiCount = 1, maxPlayers = 4): Room {
  return new Room(1, 'Тест', 'normal', maxPlayers, aiMode, aiCount);
}

describe('Room: состав при старте', () => {
  it('комната с людьми: AI добивают до maxPlayers', () => {
    const room = makeRoom(false, 1, 4);
    room.addHuman('A', 1);
    room.addHuman('B', 2);
    expect(room.start(1).ok).toBe(true);
    const players = room.gameState!.players;
    expect(players).toHaveLength(4);
    expect(players.filter((p) => p.isAi)).toHaveLength(2);
  });
  it('соло-режим: 1 человек + ровно aiCount компов', () => {
    const room = makeRoom(true, 2, 6);
    room.addHuman('A', 1);
    expect(room.start(1).ok).toBe(true);
    const players = room.gameState!.players;
    expect(players).toHaveLength(3);
    expect(players.filter((p) => p.isAi)).toHaveLength(2);
  });
  it('не хозяин не может начать', () => {
    const room = makeRoom();
    room.addHuman('A', 1);
    room.addHuman('B', 2);
    expect(room.start(2).ok).toBe(false);
    expect(room.status).toBe('waiting');
  });
  it('повторный старт отклоняется', () => {
    const room = makeRoom();
    room.addHuman('A', 1);
    room.start(1);
    expect(room.start(1).ok).toBe(false);
  });
  it('карта соответствует типу', () => {
    const room = makeRoom();
    room.addHuman('A', 1);
    room.start(1);
    expect(room.gameState!.hexes).toHaveLength(192);
  });
});

describe('Room: игроки', () => {
  it('addHuman до заполнения', () => {
    const room = makeRoom(false, 1, 2);
    expect(room.addHuman('A', 1)).toBe(1);
    expect(room.addHuman('B', 2)).toBe(2);
    expect(room.addHuman('C', 3)).toBeNull();
    expect(room.slotsCount).toBe(2);
  });
  it('removeHuman в waiting: ренумерация и передача хозяина', () => {
    const room = makeRoom();
    room.addHuman('A', 1);
    room.addHuman('B', 2);
    room.removeHuman(1);
    expect(room.slotsCount).toBe(1);
    expect(room.hostPlayerId).toBe(2);
    expect(room.slotForConn(2)).toBe(1);
  });
  it('нельзя добавить в играющую комнату', () => {
    const room = makeRoom(false, 1, 2);
    room.addHuman('A', 1);
    room.start(1);
    expect(room.addHuman('B', 2)).toBeNull();
  });
});

describe('Room: действия и тик', () => {
  it('capture в игре меняет владельца', () => {
    const room = makeRoom(false, 1, 2);
    room.addHuman('A', 1);
    room.addHuman('B', 2);
    room.start(1);
    const result = room.handleAction(1, 'capture', { q: 0, r: 0 });
    expect(result.type).toBe('state');
    expect(room.gameState!.hexes.find((h) => h.q === 0 && h.r === 0)!.ownerId).toBe(1);
  });
  it('действия до старта отклоняются', () => {
    const room = makeRoom();
    room.addHuman('A', 1);
    expect(room.handleAction(1, 'capture', { q: 0, r: 0 }).type).toBe('error');
  });
  it('пауза только в aiMode', () => {
    const room = makeRoom(false, 1, 2);
    room.addHuman('A', 1);
    room.start(1);
    expect(room.handleAction(1, 'pause', {}).type).toBe('error');
    const solo = makeRoom(true, 1, 2);
    solo.addHuman('A', 1);
    solo.start(1);
    expect(solo.handleAction(1, 'pause', {}).type).toBe('state');
    expect(solo.paused).toBe(true);
  });
  it('тик: AI захватывает первый гекс, доход не падает', () => {
    const room = makeRoom(true, 1, 2);
    room.addHuman('A', 1);
    room.start(1);
    room.tick();
    expect(room.gameState!.hexes.filter((h) => h.ownerId === 2).length).toBe(1);
  });
  it('humanDisconnected в игре: слот становится AI навсегда', () => {
    const room = makeRoom(false, 1, 2);
    room.addHuman('A', 1);
    room.addHuman('B', 2);
    room.start(1);
    room.humanDisconnected(1);
    expect(room.gameState!.players.find((p) => p.id === 1)!.isAi).toBe(true);
    expect(room.slotForConn(1)).toBeNull();
    expect(room.view().slots.find((s) => s.id === 1)!.isAi).toBe(true);
  });
});
```

- [ ] **Step 2: Прогнать тесты — должны упасть**

Run: `npm test` (workdir: `server`)
Expected: FAIL (rooms.ts не существует).

- [ ] **Step 3: Реализовать класс Room**

Создай `server/src/rooms.ts` со следующим содержимым (RoomManager будет добавлен в Task 5):

```ts
import { MAP_PRESETS, generateMap, type MapType } from './map.js';
import * as rules from './rules.js';
import type { GameState, HexState, PlayerState } from './rules.js';
import { chooseAiAction, type AiAction } from './ai.js';

export type RoomStatus = 'waiting' | 'playing';

export interface RoomSlot {
  id: number;
  name: string;
  isAi: boolean;
  connId: number | null;
  disconnected: boolean;
}

export interface RoomView {
  id: number;
  name: string;
  mapType: MapType;
  maxPlayers: number;
  status: RoomStatus;
  aiMode: boolean;
  hostPlayerId: number | null;
  slots: { id: number; name: string; isAi: boolean }[];
  paused: boolean;
  game: GameState | null;
  log: string[];
}

export type ActionResult = { type: 'state' } | { type: 'error'; message: string };

export class Room {
  status: RoomStatus = 'waiting';
  hostPlayerId: number | null = null;
  paused = false;

  private slots: RoomSlot[] = [];
  private connToSlot = new Map<number, number>();
  private state: GameState | null = null;
  private log: string[] = [];

  constructor(
    readonly id: number,
    readonly name: string,
    readonly mapType: MapType,
    readonly maxPlayers: number,
    readonly aiMode: boolean,
    private readonly aiCount: number,
  ) {}

  get gameState(): GameState | null {
    return this.state;
  }

  get slotsCount(): number {
    return this.slots.length;
  }

  get humanCount(): number {
    return this.slots.filter((s) => !s.isAi).length;
  }

  get isEmpty(): boolean {
    return this.slots.length === 0;
  }

  addHuman(name: string, connId: number): number | null {
    if (this.status !== 'waiting' || this.slots.length >= this.maxPlayers) return null;
    const id = this.slots.length + 1;
    this.slots.push({ id, name, isAi: false, connId, disconnected: false });
    this.connToSlot.set(connId, id);
    if (this.hostPlayerId === null) this.hostPlayerId = id;
    this.addLog(`${name} присоединился к комнате`);
    return id;
  }

  slotForConn(connId: number): number | null {
    return this.connToSlot.get(connId) ?? null;
  }

  removeHuman(connId: number): void {
    const id = this.connToSlot.get(connId);
    if (id === undefined) return;
    this.connToSlot.delete(connId);
    const slot = this.slots.find((s) => s.id === id);
    if (!slot) return;
    this.addLog(`${slot.name} вышел из комнаты`);
    this.slots = this.slots.filter((s) => s.id !== id);
    this.renumberSlots();
    if (this.hostPlayerId === id) {
      const next = this.slots.find((s) => !s.isAi);
      this.hostPlayerId = next ? next.id : null;
    }
  }

  start(connId: number): { ok: true } | { ok: false; error: string } {
    if (this.status !== 'waiting') return { ok: false, error: 'Игра уже началась' };
    if (this.slotForConn(connId) !== this.hostPlayerId) {
      return { ok: false, error: 'Только хозяин может начать игру' };
    }
    const aiToAdd = this.aiMode ? this.aiCount : this.maxPlayers - this.slots.length;
    for (let i = 0; i < aiToAdd; i++) {
      const id = this.slots.length + 1;
      this.slots.push({ id, name: randomCountryName(), isAi: true, connId: null, disconnected: false });
    }
    const players: PlayerState[] = this.slots.map((s) => ({
      id: s.id,
      name: s.name,
      points: rules.BASE_POINTS,
      isAi: s.isAi,
    }));
    const hexes: HexState[] = generateMap(this.mapType).map((h) => ({
      q: h.q,
      r: h.r,
      terrain: h.terrain,
      ownerId: null,
      attackerId: null,
      defenderId: null,
      attackInvestment: 0,
      defenseInvestment: 0,
      battleProgress: 0,
    }));
    this.state = { players, hexes, winnerId: null };
    this.status = 'playing';
    this.paused = false;
    this.addLog('Новая игра началась');
    return { ok: true };
  }

  tick(): void {
    if (this.status !== 'playing' || this.paused) return;
    const state = this.state;
    if (!state || state.winnerId !== null) return;
    rules.applyIncome(state);
    const results = rules.tickBattles(state);
    for (const result of results) {
      if (result.winnerId === null) {
        this.addLog(`Битва за (${result.q}, ${result.r}) окончена — ничья`);
      } else {
        this.addLog(`Битва за (${result.q}, ${result.r}) окончена — победил ${this.playerName(result.winnerId)}`);
      }
    }
    const claims = rules.applyEnclosure(state);
    for (const claim of claims) {
      this.addLog(`${this.playerName(claim.ownerId)} окружил и захватил ${claim.hexes.length} клеток`);
    }
    for (const player of state.players) {
      if (!player.isAi) continue;
      const action = chooseAiAction(state, player.id);
      if (action) this.applyAiAction(player.id, action);
    }
    rules.computeWinner(state);
  }

  handleAction(connId: number, type: string, msg: { q?: number; r?: number; points?: number; army?: number }): ActionResult {
    const playerId = this.slotForConn(connId);
    if (type === 'pause') {
      if (!this.aiMode) return { type: 'error', message: 'В игре с людьми пауза недоступна' };
      if (this.status === 'playing') this.paused = !this.paused;
      return { type: 'state' };
    }
    if (playerId === null) return { type: 'error', message: 'Вы не в этой комнате' };
    if (this.status !== 'playing' || !this.state) return { type: 'error', message: 'Игра ещё не началась' };
    if (typeof msg.q !== 'number' || typeof msg.r !== 'number') {
      return { type: 'error', message: 'Некорректные координаты' };
    }
    let validation: rules.ActionValidation;
    switch (type) {
      case 'capture': {
        validation = rules.validateCapture(this.state, playerId, msg.q, msg.r, Math.max(0, Math.floor(Number(msg.army) || 0)));
        if (!validation.ok) return { type: 'error', message: validation.error };
        const hex = rules.findHex(this.state, msg.q, msg.r)!;
        const cost = rules.hexCount(this.state, playerId) === 0 ? 0 : rules.terrainCost(hex.terrain);
        rules.applyCapture(this.state, playerId, msg.q, msg.r);
        this.addLog(`${this.playerName(playerId)} захватил (${msg.q}, ${msg.r}) за ${cost} очков`);
        return { type: 'state' };
      }
      case 'attack': {
        validation = rules.validateAttack(this.state, playerId, msg.q, msg.r, Number(msg.points));
        if (!validation.ok) return { type: 'error', message: validation.error };
        rules.applyAttack(this.state, playerId, msg.q, msg.r, Number(msg.points));
        this.addLog(`${this.playerName(playerId)} вложил ${Number(msg.points)} очков в атаку на (${msg.q}, ${msg.r})`);
        return { type: 'state' };
      }
      case 'defend': {
        validation = rules.validateDefend(this.state, playerId, msg.q, msg.r, Number(msg.points));
        if (!validation.ok) return { type: 'error', message: validation.error };
        rules.applyDefend(this.state, playerId, msg.q, msg.r, Number(msg.points));
        this.addLog(`${this.playerName(playerId)} защищает (${msg.q}, ${msg.r}): +${Number(msg.points)}`);
        return { type: 'state' };
      }
      default:
        return { type: 'error', message: `Неизвестный тип сообщения: ${type}` };
    }
  }

  humanDisconnected(connId: number): void {
    const id = this.connToSlot.get(connId);
    if (id === undefined) return;
    this.connToSlot.delete(connId);
    if (this.status === 'waiting') {
      this.removeHuman(connId);
      return;
    }
    const slot = this.slots.find((s) => s.id === id);
    if (!slot) return;
    slot.connId = null;
    slot.disconnected = true;
    slot.isAi = true;
    this.addLog(`${slot.name} покинул игру — его место занял компьютер`);
  }

  updateName(connId: number, name: string): void {
    const id = this.connToSlot.get(connId);
    if (id === undefined) return;
    const slot = this.slots.find((s) => s.id === id);
    if (slot) slot.name = name;
  }

  view(): RoomView {
    return {
      id: this.id,
      name: this.name,
      mapType: this.mapType,
      maxPlayers: this.maxPlayers,
      status: this.status,
      aiMode: this.aiMode,
      hostPlayerId: this.hostPlayerId,
      slots: this.slots.map((s) => ({ id: s.id, name: s.name, isAi: s.isAi })),
      paused: this.paused,
      game: this.state,
      log: this.log,
    };
  }

  private renumberSlots(): void {
    this.slots.forEach((s, i) => {
      s.id = i + 1;
    });
    this.connToSlot.clear();
    for (const s of this.slots) {
      if (s.connId !== null) this.connToSlot.set(s.connId, s.id);
    }
  }

  private applyAiAction(playerId: number, action: AiAction): void {
    const state = this.state!;
    const name = this.playerName(playerId);
    switch (action.type) {
      case 'capture':
        if (rules.validateCapture(state, playerId, action.q, action.r).ok) {
          const hex = rules.findHex(state, action.q, action.r)!;
          const cost = rules.hexCount(state, playerId) === 0 ? 0 : rules.terrainCost(hex.terrain);
          rules.applyCapture(state, playerId, action.q, action.r);
          this.addLog(`${name} захватил (${action.q}, ${action.r}) за ${cost} очков`);
        }
        break;
      case 'attack':
        if (rules.validateAttack(state, playerId, action.q, action.r, action.points).ok) {
          rules.applyAttack(state, playerId, action.q, action.r, action.points);
          this.addLog(`${name} вложил ${action.points} очков в атаку на (${action.q}, ${action.r})`);
        }
        break;
      case 'defend':
        if (rules.validateDefend(state, playerId, action.q, action.r, action.points).ok) {
          rules.applyDefend(state, playerId, action.q, action.r, action.points);
          this.addLog(`${name} защищает (${action.q}, ${action.r}): +${action.points}`);
        }
        break;
    }
  }

  private playerName(playerId: number): string {
    return this.slots.find((s) => s.id === playerId)?.name ?? `Игрок ${playerId}`;
  }

  private addLog(message: string): void {
    this.log.unshift(message);
    if (this.log.length > 100) this.log.pop();
  }
}

const COUNTRY_PREFIXES = [
  'Рейш', 'Аван', 'Вельд', 'Гросс', 'Карт', 'Торв', 'Эльд', 'Морх', 'Силв', 'Брейн',
  'Ост', 'Драг', 'Кэл', 'Верд', 'Норд', 'Зарт', 'Квир', 'Хальт', 'Дорн', 'Фаст',
];
const COUNTRY_SUFFIXES = [
  'олия', 'столь', 'ландия', 'марк', 'ния', 'вия', 'гон', 'дер', 'стия', 'альд',
  'мор', 'тия', 'вальд', 'гания',
];

export function randomCountryName(): string {
  const prefix = COUNTRY_PREFIXES[Math.floor(Math.random() * COUNTRY_PREFIXES.length)];
  const suffix = COUNTRY_SUFFIXES[Math.floor(Math.random() * COUNTRY_SUFFIXES.length)];
  return prefix + suffix;
}
```

Примечание: `MAP_PRESETS` импортируется уже сейчас (используется RoomManager в Task 5); `noUnusedLocals` в tsconfig не включён, так что неиспользуемый пока импорт не сломает сборку.

- [ ] **Step 4: Прогнать тесты и сборку**

Run: `npm test && npm run build` (workdir: `server`)
Expected: PASS, tsc без ошибок.

- [ ] **Step 5: Коммит**

```bash
git add server/src/rooms.ts server/test/rooms.test.ts
git commit -m "feat: комнаты — класс Room (сессия игры)"
```

---

### Task 5: Комнаты — RoomManager (лобби)

**Files:**
- Modify: `server/src/rooms.ts` (добавить RoomManager)
- Test: `server/test/rooms.test.ts` (добавить блоки RoomManager)

**Interfaces:**
- Produces: класс `RoomManager`:
  - `roomForConn(connId): Room | null`;
  - `viewerPlayerId(connId): number | null`;
  - `authProfileFor(connId): GoogleProfile | null`;
  - `handleAuth(connId, token): Promise<{ ok: boolean; error?: string }>`;
  - `createRoom(connId, mapType, maxPlayers): { ok: true } | { ok: false; error: string }`;
  - `createSolo(connId, mapType, aiCount): { ok: true } | { ok: false; error: string }` (создаёт и сразу стартует);
  - `joinRoom(connId, roomId): { ok: true } | { ok: false; error: string }`;
  - `leaveRoom(connId): void`;
  - `startRoom(connId): { ok: true } | { ok: false; error: string }`;
  - `handleAction(connId, msg): ActionResult`;
  - `lobby(): RoomLobbyInfo[]` (только waiting, не aiMode);
  - `tickAll(): void`;
  - `connectionClosed(connId): void`.

- [ ] **Step 1: Написать тесты RoomManager (RED)**

Добавь в конец `server/test/rooms.test.ts`:

```ts
import { RoomManager } from '../src/rooms.js';

describe('RoomManager', () => {
  it('create + join + lobby', () => {
    const m = new RoomManager();
    expect(m.createRoom(1, 'normal', 5).ok).toBe(true);
    expect(m.lobby()).toHaveLength(1);
    expect(m.lobby()[0]).toMatchObject({ mapType: 'normal', maxPlayers: 5, humans: 1 });
    expect(m.joinRoom(2, 1).ok).toBe(true);
    expect(m.lobby()[0].humans).toBe(2);
  });
  it('нельзя быть в двух комнатах', () => {
    const m = new RoomManager();
    m.createRoom(1, 'normal', 4);
    expect(m.createRoom(1, 'normal', 4).ok).toBe(false);
  });
  it('join в полную комнату отклоняется', () => {
    const m = new RoomManager();
    m.createRoom(1, 'normal', 2);
    m.joinRoom(2, 1);
    expect(m.joinRoom(3, 1).ok).toBe(false);
  });
  it('join в играющую комнату отклоняется', () => {
    const m = new RoomManager();
    m.createRoom(1, 'normal', 2);
    m.joinRoom(2, 1);
    m.startRoom(1);
    expect(m.joinRoom(3, 1).ok).toBe(false);
  });
  it('неверные настройки создания отклоняются', () => {
    const m = new RoomManager();
    expect(m.createRoom(1, 'normal', 1).ok).toBe(false);
    expect(m.createRoom(1, 'normal', 6).ok).toBe(false);
    expect(m.createRoom(1, 'unknown' as never, 4).ok).toBe(false);
    expect(m.createSolo(1, 'normal', 0).ok).toBe(false);
    expect(m.createSolo(1, 'normal', 5).ok).toBe(false);
  });
  it('solo: создаётся и сразу играет', () => {
    const m = new RoomManager();
    expect(m.createSolo(1, 'normal', 2).ok).toBe(true);
    const room = m.roomForConn(1)!;
    expect(room.status).toBe('playing');
    expect(room.gameState!.players).toHaveLength(3);
  });
  it('старт — только хозяин; состав полный', () => {
    const m = new RoomManager();
    m.createRoom(1, 'normal', 4);
    m.joinRoom(2, 1);
    expect(m.startRoom(2).ok).toBe(false);
    expect(m.startRoom(1).ok).toBe(true);
    expect(m.roomForConn(1)!.gameState!.players).toHaveLength(4);
  });
  it('хозяин вышел из waiting — передача первому', () => {
    const m = new RoomManager();
    m.createRoom(1, 'normal', 4);
    m.joinRoom(2, 1);
    m.joinRoom(3, 1);
    m.leaveRoom(1);
    expect(m.roomForConn(2)!.hostPlayerId).toBe(2);
    expect(m.viewerPlayerId(1)).toBeNull();
  });
  it('пустая waiting-комната удаляется', () => {
    const m = new RoomManager();
    m.createRoom(1, 'normal', 4);
    expect(m.lobby()).toHaveLength(1);
    m.leaveRoom(1);
    expect(m.lobby()).toHaveLength(0);
  });
  it('дисконнект во время игры: слот → AI, комната живёт', () => {
    const m = new RoomManager();
    m.createRoom(1, 'normal', 2);
    m.joinRoom(2, 1);
    m.startRoom(1);
    m.connectionClosed(1);
    expect(m.roomForConn(2)!.gameState!.players.find((p) => p.id === 1)!.isAi).toBe(true);
    expect(m.roomForConn(2)!.status).toBe('playing');
  });
  it('auth обновляет имя слота', async () => {
    const m = new RoomManager();
    m.createRoom(1, 'normal', 4);
    // имитация профиля: приватный метод недоступен — используем handleAuth с мок-токеном нельзя,
    // поэтому проверяем updateName через комнату напрямую:
    m.roomForConn(1)!.updateName(1, 'НовоеИмя');
    expect(m.roomForConn(1)!.view().slots[0].name).toBe('НовоеИмя');
  });
});
```

- [ ] **Step 2: Прогнать тесты — должны упасть**

Run: `npm test` (workdir: `server`)
Expected: FAIL (`RoomManager` не существует).

- [ ] **Step 3: Реализовать RoomManager**

В `server/src/rooms.ts`:
1. Верни `MAP_PRESETS` в импорт: `import { MAP_PRESETS, generateMap, type MapType } from './map.js';`
2. Добавь импорты: `import type { GoogleProfile } from './auth.js';` и `import { verifyGoogleIdToken } from './auth.js';` и `import { config } from './config.js';`
3. Добавь интерфейс `RoomLobbyInfo` после `RoomView`:

```ts
export interface RoomLobbyInfo {
  id: number;
  name: string;
  mapType: MapType;
  maxPlayers: number;
  humans: number;
}
```

4. Добавь в конец файла:

```ts
export class RoomManager {
  private rooms = new Map<number, Room>();
  private connToRoom = new Map<number, number>();
  private authProfiles = new Map<number, GoogleProfile>();
  private nextRoomId = 1;

  roomForConn(connId: number): Room | null {
    const roomId = this.connToRoom.get(connId);
    if (roomId === undefined) return null;
    return this.rooms.get(roomId) ?? null;
  }

  viewerPlayerId(connId: number): number | null {
    return this.roomForConn(connId)?.slotForConn(connId) ?? null;
  }

  authProfileFor(connId: number): GoogleProfile | null {
    return this.authProfiles.get(connId) ?? null;
  }

  async handleAuth(connId: number, token: string): Promise<{ ok: boolean; error?: string }> {
    const clientId = config.googleClientId;
    if (!clientId) return { ok: false, error: 'Google-вход не настроен на сервере' };
    if (!token) return { ok: false, error: 'Пустой токен' };
    try {
      const profile = await verifyGoogleIdToken(token, clientId);
      if (!profile) return { ok: false, error: 'Не удалось проверить токен Google' };
      this.authProfiles.set(connId, profile);
      this.roomForConn(connId)?.updateName(connId, profile.name);
      return { ok: true };
    } catch (err) {
      console.error('google auth failed:', err);
      return { ok: false, error: 'Ошибка проверки токена' };
    }
  }

  createRoom(connId: number, mapType: MapType, maxPlayers: number): { ok: true } | { ok: false; error: string } {
    if (this.connToRoom.has(connId)) return { ok: false, error: 'Вы уже в комнате' };
    const preset = MAP_PRESETS[mapType];
    if (!preset) return { ok: false, error: 'Неизвестный тип карты' };
    if (!Number.isInteger(maxPlayers) || maxPlayers < preset.minPlayers || maxPlayers > preset.maxPlayers) {
      return { ok: false, error: `Игроков должно быть от ${preset.minPlayers} до ${preset.maxPlayers}` };
    }
    const room = new Room(this.nextRoomId++, randomCountryName(), mapType, maxPlayers, false, 1);
    const slot = room.addHuman(this.connName(connId), connId);
    if (slot === null) return { ok: false, error: 'Комната заполнена' };
    this.rooms.set(room.id, room);
    this.connToRoom.set(connId, room.id);
    return { ok: true };
  }

  createSolo(connId: number, mapType: MapType, aiCount: number): { ok: true } | { ok: false; error: string } {
    if (this.connToRoom.has(connId)) return { ok: false, error: 'Вы уже в комнате' };
    const preset = MAP_PRESETS[mapType];
    if (!preset) return { ok: false, error: 'Неизвестный тип карты' };
    if (!Number.isInteger(aiCount) || aiCount < 1 || aiCount > preset.maxPlayers - 1) {
      return { ok: false, error: `Компьютеров должно быть от 1 до ${preset.maxPlayers - 1}` };
    }
    const room = new Room(this.nextRoomId++, randomCountryName(), mapType, preset.maxPlayers, true, aiCount);
    const slot = room.addHuman(this.connName(connId), connId);
    if (slot === null) return { ok: false, error: 'Комната заполнена' };
    this.rooms.set(room.id, room);
    this.connToRoom.set(connId, room.id);
    return room.start(connId);
  }

  joinRoom(connId: number, roomId: number): { ok: true } | { ok: false; error: string } {
    if (this.connToRoom.has(connId)) return { ok: false, error: 'Вы уже в комнате' };
    const room = this.rooms.get(roomId);
    if (!room || room.status !== 'waiting') return { ok: false, error: 'Комната не найдена' };
    const slot = room.addHuman(this.connName(connId), connId);
    if (slot === null) return { ok: false, error: 'Комната заполнена' };
    this.connToRoom.set(connId, room.id);
    return { ok: true };
  }

  leaveRoom(connId: number): void {
    const room = this.roomForConn(connId);
    if (!room) return;
    this.connToRoom.delete(connId);
    room.humanDisconnected(connId);
    this.cleanupRoom(room);
  }

  startRoom(connId: number): { ok: true } | { ok: false; error: string } {
    const room = this.roomForConn(connId);
    if (!room) return { ok: false, error: 'Вы не в комнате' };
    return room.start(connId);
  }

  handleAction(connId: number, msg: { type: string; q?: number; r?: number; points?: number; army?: number }): ActionResult {
    const room = this.roomForConn(connId);
    if (!room) return { type: 'error', message: 'Вы не в комнате' };
    return room.handleAction(connId, msg.type, msg);
  }

  lobby(): RoomLobbyInfo[] {
    const list: RoomLobbyInfo[] = [];
    for (const room of this.rooms.values()) {
      if (room.status !== 'waiting' || room.aiMode) continue;
      list.push({
        id: room.id,
        name: room.name,
        mapType: room.mapType,
        maxPlayers: room.maxPlayers,
        humans: room.humanCount,
      });
    }
    return list;
  }

  tickAll(): void {
    for (const room of this.rooms.values()) {
      room.tick();
    }
  }

  connectionClosed(connId: number): void {
    this.leaveRoom(connId);
    this.authProfiles.delete(connId);
  }

  private cleanupRoom(room: Room): void {
    if (room.status === 'waiting' && room.isEmpty) {
      this.rooms.delete(room.id);
    }
  }

  private connName(connId: number): string {
    return this.authProfiles.get(connId)?.name ?? 'Игрок';
  }
}
```

- [ ] **Step 4: Прогнать тесты и сборку**

Run: `npm test && npm run build` (workdir: `server`)
Expected: PASS, tsc без ошибок.

- [ ] **Step 5: Коммит**

```bash
git add server/src/rooms.ts server/test/rooms.test.ts
git commit -m "feat: комнаты — RoomManager (лобби, старт, дисконнекты)"
```

---

### Task 6: Переключение сервера — ws.ts, index.ts, db.ts, удалить game.ts

**Files:**
- Modify: `server/src/ws.ts` (полная замена)
- Modify: `server/src/index.ts` (полная замена)
- Modify: `server/src/db.ts` (чистка: убрать hexes и GameRepository)
- Delete: `server/src/game.ts`

**Interfaces:**
- Consumes: `RoomManager`, `RoomView` из Task 5.
- Produces: WebSocket-протокол: `start-solo {mapType, aiCount}`, `create-room {mapType, maxPlayers}`, `join-room {roomId}`, `leave-room`, `start-room`, `menu`, `pause`, `auth`, `capture/attack/defend`; server-сообщение `state` = `{ type, playerId, auth, rooms, room }`.

- [ ] **Step 1: Переписать ws.ts**

Полностью замени `server/src/ws.ts` на:

```ts
import type { Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import type { RoomManager } from './rooms.js';

interface WsMessage {
  type: string;
  q?: number;
  r?: number;
  points?: number;
  army?: number;
  token?: string;
  mapType?: string;
  maxPlayers?: number;
  aiCount?: number;
  roomId?: number;
}

export function attachWs(server: Server, manager: RoomManager): () => void {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const connIds = new Map<WebSocket, number>();
  let connCounter = 0;

  const statePayload = (connId: number): string => {
    return JSON.stringify({
      type: 'state',
      playerId: manager.viewerPlayerId(connId),
      auth: manager.authProfileFor(connId),
      rooms: manager.lobby(),
      room: manager.roomForConn(connId)?.view() ?? null,
    });
  };

  const broadcast = (): void => {
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        const connId = connIds.get(client);
        if (connId !== undefined) client.send(statePayload(connId));
      }
    }
  };

  const sendError = (ws: WebSocket, message: string): void => {
    ws.send(JSON.stringify({ type: 'error', message }));
  };

  wss.on('connection', (ws) => {
    const connId = ++connCounter;
    connIds.set(ws, connId);
    broadcast();

    ws.on('message', async (raw) => {
      let msg: unknown;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        sendError(ws, 'Некорректный JSON');
        return;
      }
      if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) {
        sendError(ws, 'Некорректное сообщение');
        return;
      }
      const message = msg as WsMessage;
      try {
        switch (message.type) {
          case 'auth': {
            const result = await manager.handleAuth(connId, String(message.token ?? ''));
            if (result.ok) {
              broadcast();
            } else {
              sendError(ws, result.error ?? 'Ошибка входа');
            }
            return;
          }
          case 'menu':
          case 'leave-room':
            manager.leaveRoom(connId);
            broadcast();
            return;
          case 'start-solo': {
            const result = manager.createSolo(connId, String(message.mapType ?? '') as MapType, Number(message.aiCount));
            if (result.ok) broadcast();
            else sendError(ws, result.error);
            return;
          }
          case 'create-room': {
            const result = manager.createRoom(connId, String(message.mapType ?? '') as MapType, Number(message.maxPlayers));
            if (result.ok) broadcast();
            else sendError(ws, result.error);
            return;
          }
          case 'join-room': {
            const result = manager.joinRoom(connId, Number(message.roomId));
            if (result.ok) broadcast();
            else sendError(ws, result.error);
            return;
          }
          case 'start-room': {
            const result = manager.startRoom(connId);
            if (result.ok) broadcast();
            else sendError(ws, result.error);
            return;
          }
        }
        const result = manager.handleAction(connId, message);
        if (result.type === 'state') {
          broadcast();
        } else {
          ws.send(JSON.stringify(result));
        }
      } catch (err) {
        console.error('ws handler failed:', err);
        sendError(ws, 'Ошибка сервера');
      }
    });

    ws.on('close', () => {
      connIds.delete(ws);
      manager.connectionClosed(connId);
      broadcast();
    });
  });

  return broadcast;
}
```

- [ ] **Step 2: Переписать index.ts**

Полностью замени `server/src/index.ts` на:

```ts
import http from 'http';
import express from 'express';
import { closeDb, initDb } from './db.js';
import { config } from './config.js';
import { RoomManager } from './rooms.js';
import { attachWs } from './ws.js';

const PORT = Number(process.env.PORT ?? 3000);
const MAX_DB_RETRIES = 15;
const DB_RETRY_DELAY_MS = 2000;
const TICK_INTERVAL_MS = config.tickIntervalMs;

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

  const manager = new RoomManager();
  console.log('Conquest server ready: rooms in memory');

  const server = http.createServer(app);
  const broadcast = attachWs(server, manager);

  setInterval(() => {
    manager.tickAll();
    broadcast();
  }, TICK_INTERVAL_MS);

  server.listen(PORT, () => console.log(`API listening on port ${PORT}`));
}

main().catch(async (err) => {
  console.error('API failed to start:', err);
  await closeDb();
  process.exit(1);
});
```

- [ ] **Step 3: Почистить db.ts**

В `server/src/db.ts`:
1. Из импорта убери `type GameState`, `type Terrain`, `config`, `generateMap`, `MAP_COLUMNS`, `MAP_ROWS` — оставь только `reflect-metadata`, `Column/DataSource/Entity/PrimaryColumn/Repository` из typeorm.
2. Удали классы `HexEntity`, `HexesRepository`, `GameRepository` и объект `gameRepository`.
3. Удали метод `updateAiFlags` из `PlayersRepository` (не используется).
4. В `GameRepository.migrate` — замени на метод `PlayersRepository.migrate()`: удали `await this.hexes.seedIfEmpty();`.
5. Экспорты в конце файла: оставь `playersRepository`, `initDb`, `closeDb`, `dataSource`; убери `hexesRepository` и `gameRepository`.

Итоговый файл `server/src/db.ts`:

```ts
import 'reflect-metadata';
import { Column, DataSource, Entity, PrimaryColumn, Repository } from 'typeorm';

@Entity('players')
export class PlayerEntity {
  @PrimaryColumn({ name: 'id', type: 'int' })
  id!: number;

  @Column({ name: 'name', type: 'text' })
  name!: string;

  @Column({ name: 'points', type: 'int', default: 1000 })
  points!: number;

  @Column({ name: 'is_ai', type: 'boolean', default: false })
  isAi!: boolean;
}

export class PlayersRepository {
  constructor(private readonly dataSource: DataSource) {}

  private repo(): Repository<PlayerEntity> {
    return this.dataSource.getRepository(PlayerEntity);
  }

  async count(): Promise<number> {
    return this.repo().count();
  }

  async insertDefaults(): Promise<void> {
    await this.repo().save([
      { id: 1, name: 'player', points: 1000, isAi: false },
      { id: 2, name: 'ai', points: 1000, isAi: true },
    ]);
  }

  async migrate(): Promise<void> {
    if ((await this.count()) === 0) {
      await this.insertDefaults();
    }
  }
}

export const dataSource = new DataSource({
  type: 'postgres',
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5432),
  username: process.env.PGUSER ?? 'conquest',
  password: process.env.PGPASSWORD ?? 'conquest',
  database: process.env.PGDATABASE ?? 'conquest_db',
  entities: [PlayerEntity],
  synchronize: true,
});

export const playersRepository = new PlayersRepository(dataSource);

export async function initDb(): Promise<void> {
  await dataSource.initialize();
  await playersRepository.migrate();
}

export async function closeDb(): Promise<void> {
  if (dataSource.isInitialized) {
    await dataSource.destroy();
  }
}
```

Примечание: `playersRepository` остаётся экспортированным, но в коде не используется (идентичность в памяти через Google-профили) — допустимо по спеке; если tsc ругнется на неиспользуемый импорт где-то — проверь `noUnusedLocals` в tsconfig (не включён).

- [ ] **Step 4: Удалить game.ts**

```bash
git rm server/src/game.ts
```

- [ ] **Step 5: Прогнать тесты и сборку**

Run: `npm test && npm run build` (workdir: `server`)
Expected: PASS, tsc без ошибок (проверь, что нигде не осталось импортов из `./game.js`).

- [ ] **Step 6: Коммит**

```bash
git add server/src/ws.ts server/src/index.ts server/src/db.ts
git commit -m "feat: сервер на комнатах — ws-протокол, тик по комнатам, БД без состояния игр"
```

---

### Task 7: Web — типы и API-клиент

**Files:**
- Modify: `web/src/types.ts` (полная замена)
- Modify: `web/src/api.ts` (полная замена)

**Interfaces:**
- Produces: `MapType`, `MAP_INFO`, `PLAYER_COLORS`, `playerColor(playerId)`, `RoomLobbyInfo`, `RoomSlot`, `RoomView`, `GameState` (без phase/mode/paused), `ClientMessage` (новые типы), `ServerMessage`; `GameClient` методы `sendStartSolo/sendCreateRoom/sendJoinRoom/sendLeaveRoom/sendStartRoom/sendPause/sendToMenu/sendAuth`, колбэк `onState(state, playerId, auth, rooms, room)`.

- [ ] **Step 1: Переписать types.ts**

Полностью замени `web/src/types.ts` на:

```ts
export type Terrain = 'grass' | 'forest' | 'mountain' | 'water' | 'desert' | 'mine';

export type MapType = 'normal' | 'long' | 'island' | 'round' | 'belarus';

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
  belarus: { label: 'Беларусь', description: 'контур страны', minPlayers: 2, maxPlayers: 5, recommendedAi: 1 },
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
  points: number;
  hexCount: number;
  income: number;
  isAi: boolean;
}

export interface GameState {
  players: Player[];
  hexes: Hex[];
  winnerId: number | null;
  captureTicks: number;
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
  | { type: 'menu' }
  | { type: 'leave-room' }
  | { type: 'start-solo'; mapType: MapType; aiCount: number }
  | { type: 'create-room'; mapType: MapType; maxPlayers: number }
  | { type: 'join-room'; roomId: number }
  | { type: 'start-room' }
  | { type: 'auth'; token: string };

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
```

Примечание: `PLAYER_COLOR` (human/ai) удаляется — вместо него `playerColor(id)`.

- [ ] **Step 2: Переписать api.ts**

Полностью замени `web/src/api.ts` на:

```ts
import type { AuthProfile, ClientMessage, GameState, MapType, RoomLobbyInfo, RoomView, ServerMessage } from './types';

const MAX_RECONNECT_DELAY_MS = 10000;

export class GameClient {
  onState: (
    state: GameState | null,
    playerId: number | null,
    auth: AuthProfile | null,
    rooms: RoomLobbyInfo[],
    room: RoomView | null,
  ) => void = () => {};
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

  sendCapture(q: number, r: number, army = 0): void {
    this.send({ type: 'capture', q, r, army });
  }

  sendAttack(q: number, r: number, points: number): void {
    this.send({ type: 'attack', q, r, points });
  }

  sendDefend(q: number, r: number, points: number): void {
    this.send({ type: 'defend', q, r, points });
  }

  sendPause(): void {
    this.send({ type: 'pause' });
  }

  sendToMenu(): void {
    this.send({ type: 'menu' });
  }

  sendStartSolo(mapType: MapType, aiCount: number): void {
    this.send({ type: 'start-solo', mapType, aiCount });
  }

  sendCreateRoom(mapType: MapType, maxPlayers: number): void {
    this.send({ type: 'create-room', mapType, maxPlayers });
  }

  sendJoinRoom(roomId: number): void {
    this.send({ type: 'join-room', roomId });
  }

  sendLeaveRoom(): void {
    this.send({ type: 'leave-room' });
  }

  sendStartRoom(): void {
    this.send({ type: 'start-room' });
  }

  sendAuth(token: string): void {
    this.send({ type: 'auth', token });
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
        this.onState(msg.room?.game ?? null, msg.playerId, msg.auth, msg.rooms, msg.room);
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

- [ ] **Step 3: Собрать web**

Run: `npm run build` (workdir: `web`)
Expected: FAIL — App.vue/Hud.vue/HexMap.vue ещё используют старые типы. Это ожидаемо: Task 8 и Task 9 их переписывают. Коммить не нужно — просто убедись, что ошибки только в этих трёх компонентах.

- [ ] **Step 4: Коммит**

```bash
git add web/src/types.ts web/src/api.ts
git commit -m "feat: web — типы комнат и карт, API-клиент"
```

---

### Task 8: Web — экраны (App.vue)

**Files:**
- Modify: `web/src/App.vue` (полная замена)

**Interfaces:**
- Consumes: `GameClient` (Task 7), `MAP_INFO`/`playerColor`/`RoomView` (Task 7).
- Produces: экраны `menu` / `ai` (настройка с компом) / `lobby` (список + создание) / `room` (ожидание) / `game`; пауза только при `room.aiMode`.

- [ ] **Step 1: Переписать App.vue**

Полностью замени `web/src/App.vue` на:

```vue
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import ArmyBar from './components/ArmyBar.vue';
import HexMap from './components/HexMap.vue';
import Hud from './components/Hud.vue';
import { GameClient } from './api';
import { isAdjacent, MAP_INFO, TERRAIN_COSTS, type AuthProfile, type Hex, type MapType, type RoomLobbyInfo, type RoomView } from './types';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: { client_id: string; callback: (r: { credential: string }) => void }) => void;
          renderButton: (el: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

const connected = ref(false);
const error = ref<string | null>(null);
const auth = ref<AuthProfile | null>(null);
const rooms = ref<RoomLobbyInfo[]>([]);
const room = ref<RoomView | null>(null);
const playerId = ref<number | null>(null);
const screen = ref<'menu' | 'ai' | 'lobby'>('menu');
const selected = ref<Hex | null>(null);
const burgerOpen = ref(false);
const army = ref(200);
const aiMapType = ref<MapType>('normal');
const aiCount = ref(1);
const createMapType = ref<MapType>('normal');
const createMaxPlayers = ref(5);

const game = computed(() => room.value?.game ?? null);
const myPlayer = computed(() =>
  game.value && playerId.value !== null ? game.value.players.find((p) => p.id === playerId.value) ?? null : null,
);
const winner = computed(() => {
  const id = game.value?.winnerId;
  if (id == null) return null;
  return game.value?.players.find((p) => p.id === id)?.name ?? null;
});
const isHost = computed(() => room.value !== null && room.value.hostPlayerId === playerId.value);
const showPause = computed(() => room.value?.aiMode === true);
const aiMax = computed(() => MAP_INFO[aiMapType.value].maxPlayers - 1);
const createOptions = computed(() => {
  const info = MAP_INFO[createMapType.value];
  const opts: number[] = [];
  for (let i = info.minPlayers; i <= info.maxPlayers; i++) opts.push(i);
  return opts;
});

watch(
  () => myPlayer.value?.points ?? 0,
  (points) => {
    if (army.value > points) army.value = points;
  },
);

const client = new GameClient();
client.onState = (state, pid, authProfile, rms, rm) => {
  playerId.value = pid;
  auth.value = authProfile;
  rooms.value = rms;
  room.value = rm;
  error.value = null;
  if (selected.value && rm?.game) {
    const fresh = rm.game.hexes.find((h) => h.q === selected.value!.q && h.r === selected.value!.r);
    selected.value = fresh ?? null;
  }
};
client.onError = (message) => {
  error.value = message;
};
client.onStatus = (isConnected) => {
  connected.value = isConnected;
};

function onSelect(pos: { q: number; r: number }): void {
  selected.value = game.value?.hexes.find((h) => h.q === pos.q && h.r === pos.r) ?? null;
}

function isCapturable(hex: Hex): boolean {
  const g = game.value;
  if (!g || playerId.value === null || hex.ownerId !== null || hex.attackerId !== null) return false;
  const human = g.players.find((p) => p.id === playerId.value);
  if (!human) return false;
  if (human.hexCount === 0) return true;
  if (human.points - army.value < TERRAIN_COSTS[hex.terrain]) return false;
  return g.hexes.some((h) => h.ownerId === human.id && isAdjacent(h, hex));
}

function isAdjacentToMine(hex: Hex): boolean {
  const g = game.value;
  if (!g || playerId.value === null) return false;
  return g.hexes.some((h) => h.ownerId === playerId.value && isAdjacent(h, hex));
}

function onHexClick(hex: Hex): void {
  if (playerId.value === null) return;
  if (hex.attackerId !== null) {
    const send = Math.max(1, Math.min(army.value, myPlayer.value?.points ?? 0));
    if (hex.attackerId === playerId.value) {
      client.sendAttack(hex.q, hex.r, send);
    } else if (hex.ownerId === playerId.value || isAdjacentToMine(hex)) {
      client.sendDefend(hex.q, hex.r, send);
    } else {
      onSelect({ q: hex.q, r: hex.r });
    }
    return;
  }
  if (isCapturable(hex)) {
    client.sendCapture(hex.q, hex.r, army.value);
  } else {
    onSelect({ q: hex.q, r: hex.r });
  }
}

function onArmyChange(points: number): void {
  army.value = points;
}

function onPause(): void {
  client.sendPause();
}

function goToMenu(): void {
  selected.value = null;
  burgerOpen.value = false;
  screen.value = 'menu';
}

function goToAi(): void {
  aiMapType.value = 'normal';
  aiCount.value = 1;
  screen.value = 'ai';
}

function goToLobby(): void {
  createMapType.value = 'normal';
  createMaxPlayers.value = MAP_INFO.normal.maxPlayers;
  screen.value = 'lobby';
}

function startSolo(): void {
  client.sendStartSolo(aiMapType.value, aiCount.value);
}

function createRoom(): void {
  client.sendCreateRoom(createMapType.value, createMaxPlayers.value);
}

function joinRoom(id: number): void {
  client.sendJoinRoom(id);
}

function leaveRoom(): void {
  selected.value = null;
  client.sendLeaveRoom();
}

function startRoom(): void {
  client.sendStartRoom();
}

function onToMenu(): void {
  if (!window.confirm('Выйти из комнаты? Игра продолжится с компьютером вместо вас.')) return;
  selected.value = null;
  burgerOpen.value = false;
  client.sendToMenu();
}

function initGoogleButton(): void {
  if (!GOOGLE_CLIENT_ID || !window.google) return;
  const el = document.getElementById('google-btn');
  if (!el) return;
  window.google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: (response) => client.sendAuth(response.credential),
  });
  window.google.accounts.id.renderButton(el, { theme: 'outline', size: 'large', shape: 'pill' });
}

onMounted(() => {
  client.connect();
  if (GOOGLE_CLIENT_ID) {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => initGoogleButton();
    document.head.appendChild(script);
  }
});

onBeforeUnmount(() => {
  client.close();
});
</script>

<template>
  <main class="app">
    <template v-if="screen === 'menu' && !room">
      <div class="menu">
        <h1 class="menu__title">Conquest</h1>
        <p class="menu__subtitle">Выбери режим игры</p>
        <button class="menu__btn" :disabled="!connected" @click="goToAi">Играть с компьютером</button>
        <button class="menu__btn" :disabled="!connected" @click="goToLobby">Играть с людьми</button>
        <div v-if="GOOGLE_CLIENT_ID" class="menu__google">
          <div v-if="auth" class="menu__auth">Вы вошли как {{ auth.name }}</div>
          <div v-else id="google-btn"></div>
        </div>
      </div>
    </template>

    <template v-else-if="screen === 'ai' && !room">
      <div class="menu">
        <h1 class="menu__title">Conquest</h1>
        <p class="menu__subtitle">Игра с компьютером</p>
        <select v-model="aiMapType" class="menu__select">
          <option v-for="(info, type) in MAP_INFO" :key="type" :value="type">
            {{ info.label }} — {{ info.description }}
          </option>
        </select>
        <div class="menu__row">
          <span class="menu__label">Компьютеров:</span>
          <select v-model.number="aiCount" class="menu__select">
            <option v-for="n in aiMax" :key="n" :value="n">{{ n }}</option>
          </select>
        </div>
        <button class="menu__btn" :disabled="!connected" @click="startSolo">Начать игру</button>
        <button class="menu__btn menu__btn--ghost" @click="goToMenu">В меню</button>
      </div>
    </template>

    <template v-else-if="screen === 'lobby' && !room">
      <div class="menu">
        <h1 class="menu__title">Conquest</h1>
        <p class="menu__subtitle">Игра с людьми — открытые комнаты</p>
        <div class="lobby">
          <div v-for="r in rooms" :key="r.id" class="lobby__room" @click="joinRoom(r.id)">
            <span class="lobby__name">{{ r.name }}</span>
            <span class="lobby__map">{{ MAP_INFO[r.mapType].label }}</span>
            <span class="lobby__players">{{ r.humans }}/{{ r.maxPlayers }}</span>
          </div>
          <div v-if="rooms.length === 0" class="lobby__empty">Открытых комнат нет</div>
        </div>
        <div class="lobby__create">
          <h3 class="lobby__create-title">Создать комнату</h3>
          <select v-model="createMapType" class="menu__select">
            <option v-for="(info, type) in MAP_INFO" :key="type" :value="type">
              {{ info.label }} — {{ info.description }}
            </option>
          </select>
          <select v-model.number="createMaxPlayers" class="menu__select">
            <option v-for="n in createOptions" :key="n" :value="n">{{ n }} игроков</option>
          </select>
          <button class="menu__btn" :disabled="!connected" @click="createRoom">Создать</button>
        </div>
        <button class="menu__btn menu__btn--ghost" @click="goToMenu">В меню</button>
      </div>
    </template>

    <template v-else-if="room && room.status === 'waiting'">
      <div class="menu">
        <h1 class="menu__title">{{ room.name }}</h1>
        <p class="menu__subtitle">
          Карта: {{ MAP_INFO[room.mapType].label }} · {{ room.slots.length }}/{{ room.maxPlayers }} игроков
        </p>
        <div class="lobby">
          <div v-for="s in room.slots" :key="s.id" class="lobby__room">
            <span class="lobby__name">{{ s.name }}</span>
            <span v-if="s.id === room.hostPlayerId" class="lobby__host">хозяин</span>
          </div>
          <div v-if="room.maxPlayers - room.slots.length > 0" class="lobby__empty">
            Свободно мест: {{ room.maxPlayers - room.slots.length }}
          </div>
        </div>
        <button v-if="isHost" class="menu__btn" :disabled="!connected" @click="startRoom">Начать игру</button>
        <p v-else class="menu__waiting">Ожидание начала игры хозяином…</p>
        <button class="menu__btn menu__btn--ghost" @click="leaveRoom">Покинуть комнату</button>
      </div>
    </template>

    <template v-else-if="room && game">
      <div class="app__header">
        <h1>{{ room.name }}</h1>
        <div class="app__controls">
          <button v-if="showPause" class="app__btn" :disabled="!connected" @click="onPause">
            {{ room.paused ? 'Продолжить' : 'Пауза' }}
          </button>
          <button class="app__btn app__burger" @click="burgerOpen = !burgerOpen">☰</button>
        </div>
      </div>
      <div v-if="room.paused && !winner" class="banner banner--pause">Пауза</div>
      <div v-else-if="winner" class="banner banner--win">Победа: {{ winner }}!</div>
      <div v-else-if="!connected" class="banner banner--warn">Подключение…</div>
      <div v-if="error" class="banner banner--error">{{ error }}</div>
      <Hud v-if="game" :game="game" :human-id="playerId" />
      <HexMap
        v-if="game"
        :hexes="game.hexes"
        :players="game.players"
        :capture-ticks="game.captureTicks"
        @click="onHexClick"
        @select="onSelect"
      />
      <ArmyBar v-if="game" :game="game" :hex="selected" :human-id="playerId" :army="army" @army-change="onArmyChange" />
      <div v-if="room.log?.length" class="log-panel">
        <div v-for="(entry, i) in room.log" :key="i" class="log-panel__entry">{{ entry }}</div>
      </div>
    </template>

    <div v-if="burgerOpen" class="burger-overlay" @click.self="burgerOpen = false">
      <div class="burger-menu">
        <button class="burger-menu__item" @click="onToMenu">Выйти в меню</button>
      </div>
    </div>
  </main>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px;
}

.app__header {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.app__controls {
  display: flex;
  gap: 8px;
}

.app__header h1 {
  margin: 0;
}

.app__btn {
  padding: 6px 14px;
  border: 1px solid #555;
  border-radius: 6px;
  background: #2a2a31;
  color: #fff;
  font-weight: 600;
  cursor: pointer;
}

.app__btn:hover:not(:disabled) {
  background: #3a3a44;
}

.app__btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.app__burger {
  font-size: 18px;
  line-height: 1;
}

.menu {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  margin-top: 15vh;
}

.menu__title {
  font-size: 44px;
  margin: 0;
}

.menu__subtitle {
  color: #999;
  margin: 0 0 10px;
}

.menu__btn {
  padding: 12px 32px;
  border: none;
  border-radius: 8px;
  background: #2196f3;
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  min-width: 260px;
}

.menu__btn:hover:not(:disabled) {
  background: #1976d2;
}

.menu__btn--ghost {
  background: #2a2a31;
  border: 1px solid #555;
}

.menu__btn--ghost:hover:not(:disabled) {
  background: #3a3a44;
}

.menu__btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.menu__select {
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid #555;
  background: #2a2a31;
  color: #fff;
  font-size: 15px;
  min-width: 260px;
}

.menu__row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.menu__label {
  color: #ccc;
}

.menu__waiting {
  font-size: 18px;
  color: #ffd54f;
  margin: 0;
}

.menu__google {
  margin-top: 6px;
  min-height: 40px;
}

.menu__auth {
  color: #ce93d8;
  font-weight: 600;
}

.lobby {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  max-width: 420px;
  max-height: 260px;
  overflow-y: auto;
}

.lobby__room {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #2a2a31;
  border: 1px solid #555;
  border-radius: 8px;
  padding: 10px 14px;
  cursor: pointer;
}

.lobby__room:hover {
  background: #3a3a44;
}

.lobby__name {
  font-weight: 700;
}

.lobby__map {
  color: #999;
  font-size: 13px;
}

.lobby__players {
  margin-left: auto;
  color: #ffd54f;
  font-weight: 600;
}

.lobby__host {
  color: #ffd54f;
  font-size: 12px;
}

.lobby__empty {
  color: #777;
  text-align: center;
  padding: 10px;
}

.lobby__create {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  border-top: 1px solid #444;
  padding-top: 14px;
  width: 100%;
  max-width: 420px;
}

.lobby__create-title {
  margin: 0;
  color: #ccc;
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

.banner--pause {
  background: #6a1b9a;
  color: #fff;
}

.banner--error {
  background: #c62828;
  color: #fff;
}

.log-panel {
  position: fixed;
  right: 16px;
  bottom: 16px;
  width: 420px;
  max-height: 260px;
  overflow-y: auto;
  background: rgba(0, 0, 0, 0.78);
  border: 1px solid #444;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12px;
  font-family: monospace;
  color: #ccc;
  display: flex;
  flex-direction: column;
  gap: 4px;
  z-index: 10;
}

.log-panel__entry {
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  padding-bottom: 4px;
  word-break: break-word;
}

.log-panel__entry:last-child {
  border-bottom: none;
}

.burger-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 100;
  display: flex;
  justify-content: flex-end;
}

.burger-menu {
  background: #1e1e24;
  border-left: 1px solid #444;
  min-width: 220px;
  padding: 16px 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.burger-menu__item {
  padding: 10px 14px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #fff;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}

.burger-menu__item:hover {
  background: #2a2a31;
}
</style>
```

- [ ] **Step 2: Собрать web**

Run: `npm run build` (workdir: `web`)
Expected: могут остаться ошибки в HexMap.vue/Hud.vue (старая палитра) — они чинятся в Task 9. Если ошибок нет — тоже нормально.

- [ ] **Step 3: Коммит**

```bash
git add web/src/App.vue
git commit -m "feat: web — экраны настройки, лобби, комнаты, игра"
```

---

### Task 9: Web — палитра N игроков (HexMap, Hud)

**Files:**
- Modify: `web/src/components/HexMap.vue`
- Modify: `web/src/components/Hud.vue`

**Interfaces:**
- Consumes: `playerColor(playerId)` из types.ts (Task 7).
- Produces: цвета всех игроков из палитры по id слота; у HexMap убирается проп `humanId`.

- [ ] **Step 1: Обновить HexMap.vue**

В `web/src/components/HexMap.vue`:
1. Импорт: замени `import { PLAYER_COLOR, TERRAIN_COLORS, type Hex, type Player } from '../types';` на `import { playerColor, TERRAIN_COLORS, type Hex, type Player } from '../types';`
2. Пропсы: замени `defineProps<{ hexes: Hex[]; players: Player[]; humanId: number | null; captureTicks: number }>()` на `defineProps<{ hexes: Hex[]; players: Player[]; captureTicks: number }>()`.
3. Функцию `colorOf` замени на:

```ts
function colorOf(id: number | null): string {
  if (id === null) return '#999';
  return playerColor(id);
}
```

(функция `playerName` без изменений; все использования `colorOf` в battleOverlay/ownerStyle/ring/tooltip остаются корректными).

- [ ] **Step 2: Обновить Hud.vue**

Полностью замени `web/src/components/Hud.vue` на:

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { playerColor, type GameState, type Player } from '../types';

const props = defineProps<{ game: GameState; humanId: number | null }>();

const players = computed(() => {
  if (props.humanId === null) return props.game.players;
  const me = props.game.players.find((p) => p.id === props.humanId);
  const others = props.game.players.filter((p) => p.id !== props.humanId);
  return me ? [me, ...others] : props.game.players;
});

function colorOf(p: Player): string {
  return playerColor(p.id);
}
</script>

<template>
  <div class="player-list">
    <div
      v-for="p in players"
      :key="p.id"
      class="player-list__row"
      :class="{ 'player-list__row--me': p.id === humanId }"
    >
      <span class="player-list__name" :style="{ color: colorOf(p) }">{{ p.name }}</span>
      <span class="player-list__hexes">{{ p.hexCount }} кл.</span>
      <span class="player-list__points">{{ p.points }}</span>
      <span class="player-list__income">+{{ p.income }}/сек</span>
    </div>
  </div>
</template>

<style scoped>
.player-list {
  position: fixed;
  top: 16px;
  left: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  z-index: 20;
  min-width: 300px;
}

.player-list__row {
  display: flex;
  align-items: center;
  gap: 14px;
  background: rgba(0, 0, 0, 0.72);
  border: 1px solid #555;
  border-radius: 10px;
  padding: 14px 18px;
  font-size: 18px;
}

.player-list__row--me {
  border-color: #888;
  border-width: 2px;
}

.player-list__name {
  font-weight: 700;
  font-size: 20px;
  white-space: nowrap;
}

.player-list__hexes {
  color: #aaa;
  font-size: 14px;
}

.player-list__points {
  font-weight: 700;
  font-size: 20px;
  color: #fff;
  margin-left: auto;
}

.player-list__income {
  color: #7cb342;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
}
</style>
```

- [ ] **Step 3: Собрать web и сервер**

Run: `npm run build` (workdir: `web`) и `npm test && npm run build` (workdir: `server`)
Expected: обе сборки чистые, тесты PASS.

- [ ] **Step 4: Коммит**

```bash
git add web/src/components/HexMap.vue web/src/components/Hud.vue
git commit -m "feat: web — палитра цветов для N игроков"
```

---

### Task 10: Итоговая проверка

**Files:** нет (проверка).

- [ ] **Step 1: Тесты сервера**

Run: `npm test` (workdir: `server`)
Expected: PASS (все файлы: rules, ai, map, rooms).

- [ ] **Step 2: Сборка сервера**

Run: `npm run build` (workdir: `server`)
Expected: tsc без ошибок.

- [ ] **Step 3: Сборка web**

Run: `npm run build` (workdir: `web`)
Expected: vue-tsc + vite без ошибок.

- [ ] **Step 4: Smoke-тест**

Запусти dev-профиль `docker compose up --build -d`, открой игру:
- меню → «Играть с компьютером» → выбери тип карты и 2 компов → игра стартует с 3 игроками, цвета разные, пауза работает;
- меню → «Играть с людьми» → создай комнату (круглая, 4 игрока) → открой вторую вкладку, присоединись → хозяин нажимает «Начать игру» → игра на 4 (2 человека + 2 компа);
- проверь лобби: комната видна, заполненность обновляется;
- хозяин покинул waiting-комнату → хозяин перешёл второму;
- игрок отключился в игре → его слот стал компьютером;
- в комнате с людьми кнопки паузы нет.

Если какой-то шаг невозможен в окружении — отметь в отчёте.

- [ ] **Step 5: Коммит (если smoke-тест выявил фиксы — отдельными коммитами с описанием)**

```bash
git log --oneline -12
```
Expected: 10 коммитов этапа (типы карт → правила N → ИИ → Room → RoomManager → сервер → web-типы → экраны → палитра → проверка).
