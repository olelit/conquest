# Столица, отрезание, выбытие, армия в %, перезапуск — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать 4 изменения: армия в процентах от очков, перезапуск игры в соло, столица (первый гекс, потеря = выбытие с 90/10 судьбой территории), отрезание вражеской территории через захват «шейки».

**Architecture:** Правила (rules.ts) получают новые чистые функции и данные: `PlayerState.capital`, `PlayerState.eliminated`, `applyCut`, `eliminateIfCapitalLost`, обновлённый `tickBattles` (с `loserId` в `BattleResult`) и `computeWinner`. Room (rooms.ts) оркеструет: после битв применяет выбытие/отрезание, создаёт слоты порождённых ИИ, завершает соло-игру, реализует `restart`. Web: `army` становится процентом, добавляется пункт меню, баннеры, маркер столицы.

**Tech Stack:** Node.js + TypeScript, vitest (server), Vue 3 + Vite (web).

## Global Constraints

- Тесты сервера: `npx vitest run` из `server/` (все 122 существующих теста должны остаться зелёными).
- Проверка web: `npm run build` из `web/` (vue-tsc + vite; тестового раннера в web нет — проверка типов и сборка).
- Сообщения клиент-сервер передаются через WebSocket JSON: см. `server/src/ws.ts`, `web/src/api.ts`, `web/src/types.ts`.
- Язык сообщений и логов — русский (существующий стиль).
- TDD: сначала тест, потом реализация, часто коммитим.
- `PlayerState` — расширяем опциональными полями (`capital?: { q: number; r: number } | null`, `eliminated?: boolean`), чтобы не ломать существующие тесты.
- Спецификация: `docs/superpowers/specs/2026-08-13-capital-cut-army-restart-design.md`.

---

### Task 1: Правила — столица

**Files:**
- Modify: `server/src/rules.ts`
- Test: `server/test/rules.test.ts`

**Interfaces:**
- Produces: `PlayerState.capital?: { q: number; r: number } | null`; столица выставляется в `applyCapture` (мгновенный захват первого гекса) и в `tickBattles` (первая клетка, доставшаяся игроку через бой).

- [ ] **Step 1: Написать падающие тесты**

Добавить в конец `server/test/rules.test.ts` (после блока «экономика»):

```ts
describe('столица', () => {
  it('первый захваченный гекс становится столицей', () => {
    const s = makeState([{ q: 5, r: 5 }]);
    applyCapture(s, P, 5, 5);
    expect(s.players[0].capital).toEqual({ q: 5, r: 5 });
  });
  it('второй захват не меняет столицу', () => {
    const s = makeState([{ q: 5, r: 5 }, { q: 6, r: 5 }]);
    applyCapture(s, P, 5, 5);
    applyCapture(s, P, 6, 5);
    expect(s.players[0].capital).toEqual({ q: 5, r: 5 });
  });
  it('первая клетка через бой становится столицей после победы', () => {
    const s = makeState(
      [{ q: 5, r: 5 }, { q: 6, r: 5, ownerId: AI }],
      [{ id: 1, points: 1000 }, { id: 2, points: 1000 }],
    );
    applyCapture(s, P, 5, 5); // бой у границы врага
    expect(s.players[0].capital).toBeUndefined();
    const hex = s.hexes.find((h) => h.q === 5 && h.r === 5)!;
    hex.attackInvestment = 300;
    hex.defenseInvestment = 0;
    hex.battleProgress = CAPTURE_TICKS - 1;
    tickBattles(s);
    expect(s.players[0].capital).toEqual({ q: 5, r: 5 });
  });
});
```

`P` и `AI` уже определены в начале `rules.test.ts` (см. строки 45–50), `CAPTURE_TICKS` и `tickBattles` уже импортируются.

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run test/rules.test.ts -t "столица"`
Expected: FAIL — `undefined` вместо `{ q: 5, r: 5 }` (поле `capital` не существует).

- [ ] **Step 3: Реализовать**

В `server/src/rules.ts`:

1. В интерфейс `PlayerState` (после `isAi?: boolean`) добавить:

```ts
  capital?: { q: number; r: number } | null;
```

2. В `applyCapture` (ветка мгновенного захвата, `server/src/rules.ts:172-174`):

```ts
  } else {
    hex.ownerId = playerId;
    if (isFirst && !player.capital) player.capital = { q, r };
  }
```

3. В `tickBattles` — в обеих ветках победы (атакующего, `server/src/rules.ts:234-237`, и защитника, `:247-249`) перед `results.push`:

```ts
      const winner = state.players.find((p) => p.id === hex.attackerId);
      if (winner) winner.points += hex.attackInvestment;
      hex.ownerId = hex.attackerId;
      if (winner && !winner.capital && hexCount(state, winner.id) === 1) {
        winner.capital = { q: hex.q, r: hex.r };
      }
      results.push({ q: hex.q, r: hex.r, winnerId: hex.attackerId });
```

и

```ts
      const winner = state.players.find((p) => p.id === hex.defenderId);
      if (winner) winner.points += hex.defenseInvestment;
      hex.ownerId = hex.defenderId;
      if (winner && !winner.capital && hexCount(state, winner.id) === 1) {
        winner.capital = { q: hex.q, r: hex.r };
      }
      results.push({ q: hex.q, r: hex.r, winnerId: hex.defenderId });
```

(`hexCount` вызывается ПОСЛЕ переназначения `ownerId`, поэтому счётчик уже включает новую клетку.)

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run test/rules.test.ts -t "столица"`
Expected: PASS (3 теста).

- [ ] **Step 5: Полный прогон и коммит**

Run: `npx vitest run`
Expected: все тесты зелёные.

```bash
git add server/src/rules.ts server/test/rules.test.ts
git commit -m "feat: столица — первый захваченный гекс игрока"
```

---

### Task 2: Правила — отрезание территории

**Files:**
- Modify: `server/src/rules.ts`
- Test: `server/test/rules.test.ts`

**Interfaces:**
- Produces: `export function applyCut(state: GameState, playerId: number): HexState[]` — нейтрализует компоненты территории игрока, не содержащие столицу; возвращает нейтрализованные гексы (пусто, если территория связная или игрок выбыл).

- [ ] **Step 1: Написать падающие тесты**

Добавить в `server/test/rules.test.ts`:

```ts
describe('отрезание территории', () => {
  it('захват шейки отрезает часть без столицы', () => {
    const s = makeState([
      { q: 2, r: 2, ownerId: P }, { q: 3, r: 2, ownerId: P }, { q: 4, r: 2, ownerId: P },
      { q: 5, r: 2, ownerId: P }, { q: 6, r: 2, ownerId: P }, { q: 7, r: 2, ownerId: P },
    ]);
    s.players[0].capital = { q: 2, r: 2 };
    s.hexes.find((h) => h.q === 4 && h.r === 2)!.ownerId = null; // шейку уже захватил враг
    const cut = applyCut(s, P);
    expect(cut.map((h) => `${h.q},${h.r}`).sort()).toEqual(['5,2', '6,2', '7,2'].sort());
    expect(s.hexes.find((h) => h.q === 5 && h.r === 2)!.ownerId).toBeNull();
    expect(s.hexes.find((h) => h.q === 2 && h.r === 2)!.ownerId).toBe(P);
    expect(s.hexes.find((h) => h.q === 3 && h.r === 2)!.ownerId).toBe(P);
  });
  it('связная территория не режется', () => {
    const s = makeState([{ q: 2, r: 2, ownerId: P }, { q: 3, r: 2, ownerId: P }]);
    s.players[0].capital = { q: 2, r: 2 };
    expect(applyCut(s, P)).toHaveLength(0);
  });
  it('выбывший игрок не режется', () => {
    const s = makeState([{ q: 2, r: 2, ownerId: P }, { q: 5, r: 5, ownerId: P }]);
    s.players[0].eliminated = true;
    expect(applyCut(s, P)).toHaveLength(0);
  });
  it('без столицы главный — первый компонент', () => {
    const s = makeState([{ q: 2, r: 2, ownerId: P }, { q: 5, r: 5, ownerId: P }]);
    const cut = applyCut(s, P);
    expect(cut.map((h) => `${h.q},${h.r}`)).toEqual(['5,5']);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run test/rules.test.ts -t "отрезание"`
Expected: FAIL — `applyCut is not defined`.

- [ ] **Step 3: Реализовать**

В `server/src/rules.ts` добавить (рядом с `applyEnclosure`, после `resetBattle`):

```ts
export function applyCut(state: GameState, playerId: number): HexState[] {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.eliminated) return [];
  const owned = state.hexes.filter((h) => h.ownerId === playerId);
  if (owned.length === 0) return [];
  const components: HexState[][] = [];
  const visited = new Set<HexState>();
  for (const start of owned) {
    if (visited.has(start)) continue;
    const component: HexState[] = [];
    const queue = [start];
    visited.add(start);
    while (queue.length > 0) {
      const hex = queue.pop()!;
      component.push(hex);
      for (const [dq, dr] of NEIGHBOR_OFFSETS) {
        const neighbor = findHex(state, hex.q + dq, hex.r + dr);
        if (!neighbor || neighbor.ownerId !== playerId || visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    components.push(component);
  }
  if (components.length <= 1) return [];
  let main = components[0];
  if (player.capital) {
    main = components.find((c) => c.some((h) => h.q === player.capital!.q && h.r === player.capital!.r)) ?? components[0];
  }
  const cut: HexState[] = [];
  for (const component of components) {
    if (component === main) continue;
    for (const hex of component) {
      hex.ownerId = null;
      cut.push(hex);
    }
  }
  return cut;
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run test/rules.test.ts -t "отрезание"`
Expected: PASS (4 теста).

- [ ] **Step 5: Полный прогон и коммит**

Run: `npx vitest run` → зелёные.

```bash
git add server/src/rules.ts server/test/rules.test.ts
git commit -m "feat: отрезание территории — компонент без столицы становится нейтральным"
```

---

### Task 3: Правила — выбытие при потере столицы

**Files:**
- Modify: `server/src/rules.ts`
- Test: `server/test/rules.test.ts`

**Interfaces:**
- Produces:
  - `export interface NewAiInfo { id: number; hexes: HexState[] }`
  - `export interface EliminationResult { eliminatedId: number; neutralHexes: HexState[]; newAis: NewAiInfo[]; capturerId: number | null }`
  - `export function eliminateIfCapitalLost(state: GameState, playerId: number, rng: () => number = Math.random): EliminationResult | null`
  - `BattleResult` получает `loserId?: number` (терявший клетку в битве).
  - `computeWinner` дополнен правилом выбытия.
- Consumes: `PlayerState.capital` (Task 1), `findHex`, `hexCount`.

- [ ] **Step 1: Написать падающие тесты**

Добавить в `server/test/rules.test.ts`:

```ts
describe('выбытие', () => {
  it('потеря столицы = выбытие, территория нейтральна (90%)', () => {
    const s = makeState([{ q: 2, r: 2, ownerId: P }, { q: 3, r: 2, ownerId: P }]);
    s.players[0].capital = { q: 2, r: 2 };
    s.hexes.find((h) => h.q === 2 && h.r === 2)!.ownerId = AI; // столица уже захвачена
    const res = eliminateIfCapitalLost(s, P, () => 0.5);
    expect(res).not.toBeNull();
    expect(s.players[0].eliminated).toBe(true);
    expect(res!.capturerId).toBe(AI);
    expect(res!.neutralHexes.map((h) => `${h.q},${h.r}`)).toEqual(['3,2']);
    expect(res!.newAis).toHaveLength(0);
    expect(s.hexes.find((h) => h.q === 3 && h.r === 2)!.ownerId).toBeNull();
  });
  it('столица на месте — выбытия нет', () => {
    const s = makeState([{ q: 2, r: 2, ownerId: P }]);
    s.players[0].capital = { q: 2, r: 2 };
    expect(eliminateIfCapitalLost(s, P, () => 0.5)).toBeNull();
    expect(s.players[0].eliminated).toBeUndefined();
  });
  it('10% — территория делится на ИИ поровну, остаток нейтральный', () => {
    const hexes: Partial<HexState>[] = [];
    for (let i = 0; i < 22; i++) hexes.push({ q: i % 16, r: 5 + Math.floor(i / 16), ownerId: P });
    const s = makeState(hexes);
    s.players[0].capital = { q: 5, r: 5 };
    s.hexes.find((h) => h.q === 5 && h.r === 5)!.ownerId = AI; // столица захвачена, владений 21
    const res = eliminateIfCapitalLost(s, P, () => 0.05)!;
    expect(res.newAis).toHaveLength(2);
    expect(res.newAis[0].hexes).toHaveLength(10);
    expect(res.newAis[1].hexes).toHaveLength(10);
    expect(res.neutralHexes).toHaveLength(1);
    expect(res.newAis.map((a) => a.id)).toEqual([3, 4]);
    for (const ai of res.newAis) {
      for (const hex of ai.hexes) expect(hex.ownerId).toBe(ai.id);
    }
    expect(s.hexes.find((h) => h.q === 5 && h.r === 6)!.ownerId).toBeNull(); // остаток нейтральный
  });
  it('выбывший повторно не выбывает', () => {
    const s = makeState([]);
    s.players[0].eliminated = true;
    expect(eliminateIfCapitalLost(s, P, () => 0.5)).toBeNull();
  });
  it('выбывший игрок не может действовать', () => {
    const s1 = makeState([{ q: 5, r: 5, ownerId: P }, { q: 7, r: 5 }]);
    s1.players[0].eliminated = true;
    expect(validateCapture(s1, P, 7, 5).ok).toBe(false);
    const s2 = makeState([{ q: 5, r: 5, ownerId: P }, { q: 6, r: 5, attackerId: AI }]);
    s2.players[0].eliminated = true;
    expect(validateDefend(s2, P, 6, 5, 150).ok).toBe(false);
    const s3 = makeState([{ q: 5, r: 5, ownerId: P }, { q: 6, r: 5, ownerId: AI }]);
    s3.players[0].eliminated = true;
    expect(validateAttack(s3, P, 6, 5, 150).ok).toBe(false);
  });
  it('последний оставшийся — победитель', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: P }], [{ id: 1, points: 100 }, { id: 2, points: 100 }]);
    s.players[0].capital = { q: 5, r: 5 };
    s.players[1].eliminated = true;
    computeWinner(s);
    expect(s.winnerId).toBe(P);
  });
  it('битва за столицу: результат содержит loserId', () => {
    const s = makeState(
      [{ q: 5, r: 5, ownerId: P }, { q: 6, r: 5, ownerId: AI }],
      [{ id: 1, points: 1000 }, { id: 2, points: 1000 }],
    );
    s.players[0].capital = { q: 5, r: 5 };
    const hex = s.hexes.find((h) => h.q === 5 && h.r === 5)!;
    hex.attackerId = AI;
    hex.defenderId = P;
    hex.attackInvestment = 500;
    hex.defenseInvestment = 0;
    hex.battleProgress = CAPTURE_TICKS - 1;
    const results = tickBattles(s);
    expect(results).toHaveLength(1);
    expect(results[0].winnerId).toBe(AI);
    expect(results[0].loserId).toBe(P);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run test/rules.test.ts -t "выбытие"`
Expected: FAIL — `eliminateIfCapitalLost is not defined`; тест `loserId` — `undefined`.

- [ ] **Step 3: Реализовать**

В `server/src/rules.ts`:

0. Валидации — блокировать выбывших. В `validateCapture`, `validateAttack` и `validateDefend` сразу после нахождения игрока (`const player = state.players.find((p) => p.id === playerId);` с последующей проверкой `if (!player) return ...`) добавить:

```ts
  if (player.eliminated) return { ok: false, error: 'Вы выбыли из игры' };
```

(в `validateCapture` строка ~105, в `validateAttack` ~132, в `validateDefend` ~152).

1. В `PlayerState` после `capital` добавить:

```ts
  eliminated?: boolean;
```

2. `BattleResult` (строка ~207) — добавить поле:

```ts
export interface BattleResult {
  q: number;
  r: number;
  winnerId: number | null;
  loserId?: number;
}
```

3. В `tickBattles` в ветке победы атакующего (перед `results.push`):

```ts
      const oldOwnerId = hex.ownerId;
      const winner = state.players.find((p) => p.id === hex.attackerId);
      if (winner) winner.points += hex.attackInvestment;
      hex.ownerId = hex.attackerId;
      if (winner && !winner.capital && hexCount(state, winner.id) === 1) {
        winner.capital = { q: hex.q, r: hex.r };
      }
      results.push({ q: hex.q, r: hex.r, winnerId: hex.attackerId, loserId: oldOwnerId ?? undefined });
```

4. Добавить новые функции (после `applyCut`):

```ts
export interface NewAiInfo {
  id: number;
  hexes: HexState[];
}

export interface EliminationResult {
  eliminatedId: number;
  neutralHexes: HexState[];
  newAis: NewAiInfo[];
  capturerId: number | null;
}

export function eliminateIfCapitalLost(
  state: GameState,
  playerId: number,
  rng: () => number = Math.random,
): EliminationResult | null {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.eliminated) return null;
  if (!player.capital) return null;
  const capitalHex = findHex(state, player.capital.q, player.capital.r);
  if (capitalHex && capitalHex.ownerId === playerId) return null;
  player.eliminated = true;
  const capturerId = capitalHex ? capitalHex.ownerId : null;
  const owned = state.hexes.filter((h) => h.ownerId === playerId);
  const neutralHexes: HexState[] = [];
  const newAis: NewAiInfo[] = [];
  if (owned.length > 0) {
    if (rng() < 0.1 && owned.length >= 2) {
      const k = Math.min(Math.max(Math.round(owned.length / 10), 2), 5);
      const perAi = Math.floor(owned.length / k);
      const baseId = Math.max(0, ...state.players.map((p) => p.id)) + 1;
      for (let i = 0; i < k; i++) {
        const chunk = owned.slice(i * perAi, (i + 1) * perAi);
        if (chunk.length === 0) continue;
        newAis.push({ id: baseId + i, hexes: chunk });
      }
      for (let i = k * perAi; i < owned.length; i++) {
        owned[i].ownerId = null;
        neutralHexes.push(owned[i]);
      }
    } else {
      for (const hex of owned) {
        hex.ownerId = null;
        neutralHexes.push(hex);
      }
    }
  }
  for (const ai of newAis) {
    for (const hex of ai.hexes) hex.ownerId = ai.id;
  }
  return { eliminatedId: playerId, neutralHexes, newAis, capturerId };
}
```

5. `computeWinner` — добавить правило выбытия:

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
  const remaining = state.players.filter((p) => !p.eliminated);
  if (remaining.length === 1 && hexCount(state, remaining[0].id) > 0) {
    state.winnerId = remaining[0].id;
  }
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run test/rules.test.ts -t "выбытие"`
Expected: PASS (6 тестов).

- [ ] **Step 5: Полный прогон и коммит**

Run: `npx vitest run` → зелёные.

```bash
git add server/src/rules.ts server/test/rules.test.ts
git commit -m "feat: выбытие при потере столицы — нейтрализация или раздел территории на ИИ"
```

---

### Task 4: Комната — интеграция выбытия/отрезания в тик

**Files:**
- Modify: `server/src/rooms.ts`, `server/src/ai.ts`
- Test: `server/test/rooms.test.ts`

**Interfaces:**
- Consumes: `rules.tickBattles` (с `loserId`), `rules.applyCut`, `rules.eliminateIfCapitalLost`, `rules.BASE_POINTS`, `uniqueCountryName` (локальная), `randomCountryName`.
- Produces: Room получает опциональный генератор случайности `rng` в конструкторе (для детерминированных тестов); `eliminationSpawned: Set<number>` (id слотов, порождённых выбытием — для рестарта в Task 5).

- [ ] **Step 1: Написать падающие тесты**

Добавить в `server/test/rooms.test.ts` (после блока «Room: действия и тик»):

```ts
describe('Room: выбытие', () => {
  it('10%: столица захвачена — игрок выбывает, территория делится на ИИ, соло заканчивается', () => {
    const room = new Room(1, 'Тест', 'normal', 6, true, 1, () => 0.05);
    room.addHuman('A', 1);
    room.start(1);
    const g = room.gameState!;
    const capital = g.hexes[0];
    capital.ownerId = 1;
    g.players[0].capital = { q: capital.q, r: capital.r };
    for (let i = 1; i <= 20; i++) g.hexes[i].ownerId = 1;
    capital.attackerId = 2;
    capital.attackInvestment = 500;
    capital.defenseInvestment = 0;
    capital.battleProgress = rules.CAPTURE_TICKS - 1;
    room.tick();
    expect(g.players[0].eliminated).toBe(true);
    expect(g.winnerId).toBe(2);
    expect(g.players).toHaveLength(4);
    expect(room.slotsCount).toBe(4);
    expect(room.view().slots.filter((s) => s.isAi)).toHaveLength(3);
  });
  it('отрезание: захват шейки нейтрализует дальний кусок', () => {
    const room = new Room(1, 'Тест', 'normal', 6, true, 1, () => 0.5);
    room.addHuman('A', 1);
    room.start(1);
    const g = room.gameState!;
    const chain = [g.hexes[0], g.hexes[1], g.hexes[2], g.hexes[3], g.hexes[4], g.hexes[5]];
    for (const hex of chain) hex.ownerId = 1;
    g.players[0].capital = { q: chain[0].q, r: chain[0].r };
    // игрок 2 (ИИ) захватывает шейку chain[2] через битву
    const neck = chain[2];
    neck.attackerId = 2;
    neck.attackInvestment = 500;
    neck.defenseInvestment = 0;
    neck.battleProgress = rules.CAPTURE_TICKS - 1;
    room.tick();
    expect(neck.ownerId).toBe(2);
    expect(chain[0].ownerId).toBe(1);
    expect(chain[3].ownerId).toBeNull();
    expect(chain[5].ownerId).toBeNull();
  });
});
```

`rules` в `rooms.test.ts` ещё не импортирован — в начало файла добавить строку:

```ts
import * as rules from '../src/rules.js';
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run test/rooms.test.ts -t "выбытие"`
Expected: FAIL — конструктор `Room` не принимает 7-й аргумент (rng), `eliminated` отсутствует.

- [ ] **Step 3: Реализовать**

В `server/src/rooms.ts`:

1. Конструктор Room — добавить rng:

```ts
  constructor(
    readonly id: number,
    readonly name: string,
    readonly mapType: MapType,
    readonly maxPlayers: number,
    readonly aiMode: boolean,
    private readonly aiCount: number,
    private readonly rng: () => number = Math.random,
  ) {}
```

2. Поля класса (после `private log: string[] = [];`):

```ts
  private eliminationSpawned = new Set<number>();
```

3. В `tick()` после цикла логов битв (сейчас строки ~176-182) добавить обработку выбытия/отрезания:

```ts
    for (const result of results) {
      if (result.loserId === undefined) continue;
      const elim = rules.eliminateIfCapitalLost(state, result.loserId, this.rng);
      if (elim) {
        this.addLog(`${this.playerName(elim.eliminatedId)} потерял столицу и выбыл из игры`);
        if (elim.neutralHexes.length > 0) {
          this.addLog(`Территория ${this.playerName(elim.eliminatedId)} стала нейтральной`);
        }
        if (elim.newAis.length > 0) {
          const usedNames = new Set(this.slots.map((s) => s.name));
          const names: string[] = [];
          for (const ai of elim.newAis) {
            const name = uniqueCountryName(usedNames);
            names.push(name);
            state.players.push({
              id: ai.id,
              name,
              points: rules.BASE_POINTS,
              isAi: true,
              capital: { q: ai.hexes[0].q, r: ai.hexes[0].r },
            });
            this.slots.push({ id: ai.id, name, isAi: true, connId: null, disconnected: false });
            this.eliminationSpawned.add(ai.id);
          }
          this.addLog(`Территория ${this.playerName(elim.eliminatedId)} разделена между: ${names.join(', ')}`);
        }
        if (this.aiMode) {
          const human = this.slots.find((s) => s.connId !== null);
          if (human?.id === elim.eliminatedId && elim.capturerId !== null) {
            state.winnerId = elim.capturerId;
          }
        }
      } else {
        const cut = rules.applyCut(state, result.loserId);
        if (cut.length > 0) {
          this.addLog(`${this.playerName(result.loserId)} отрезан: ${cut.length} клеток стали нейтральными`);
        }
      }
    }
```

4. В цикле ИИ (в `tick()`) пропускать выбывших:

```ts
    for (const player of state.players) {
      if (!player.isAi || player.eliminated) continue;
```

5. `view()` — добавить поля в players:

```ts
            players: this.state.players.map((p) => ({
              id: p.id,
              name: p.name ?? `Игрок ${p.id}`,
              points: p.points,
              hexCount: rules.hexCount(this.state!, p.id),
              income: rules.playerIncome(this.state!, p.id),
              limit: rules.pointLimit(rules.hexCount(this.state!, p.id)),
              isAi: p.isAi ?? false,
              capital: p.capital ?? null,
              eliminated: p.eliminated ?? false,
            })),
```

В `server/src/ai.ts` — защита от выбывшего ИИ (в начало `chooseAiAction`, после `if (!ai) return null;`):

```ts
  if (ai.eliminated) return null;
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run test/rooms.test.ts -t "выбытие"`
Expected: PASS (2 теста).

- [ ] **Step 5: Полный прогон и коммит**

Run: `npx vitest run`
Expected: все тесты зелёные (в т.ч. 122 старых).

```bash
git add server/src/rooms.ts server/src/ai.ts server/test/rooms.test.ts
git commit -m "feat: тик обрабатывает выбытие и отрезание, порождает ИИ-игроков"
```

---

### Task 5: Комната — перезапуск игры

**Files:**
- Modify: `server/src/rooms.ts`, `server/src/ws.ts`
- Test: `server/test/rooms.test.ts`

**Interfaces:**
- Produces: `Room.restart(): { ok: true } | { ok: false; error: string }`; `RoomManager.restart(connId)`; сообщение `restart` в ws.
- Consumes: `generateMap`, `MAP_PRESETS`, `rules.BASE_POINTS`, `this.eliminationSpawned` (Task 4).

- [ ] **Step 1: Написать падающие тесты**

Добавить в `server/test/rooms.test.ts`:

```ts
describe('Room: перезапуск', () => {
  it('рестарт только в соло-режиме', () => {
    const room = makeRoom(false, 1, 2);
    room.addHuman('A', 1);
    room.start(1);
    expect(room.restart().ok).toBe(false);
  });
  it('рестарт сбрасывает состояние', () => {
    const room = makeRoom(true, 1, 2);
    room.addHuman('A', 1);
    room.start(1);
    room.handleAction(1, 'capture', { q: 0, r: 0 });
    room.tick();
    expect(room.view().game!.players[0].hexCount).toBe(1);
    expect(room.restart().ok).toBe(true);
    const g = room.view().game!;
    expect(g.players[0].hexCount).toBe(0);
    expect(g.players[0].points).toBe(1000);
    expect(g.winnerId).toBeNull();
    expect(g.players).toHaveLength(2);
  });
  it('рестарт убирает порождённых ИИ и чинит паузу', () => {
    const room = new Room(1, 'Тест', 'normal', 6, true, 1, () => 0.05);
    room.addHuman('A', 1);
    room.start(1);
    const g = room.gameState!;
    g.hexes[0].ownerId = 1;
    g.players[0].capital = { q: g.hexes[0].q, r: g.hexes[0].r };
    for (let i = 1; i <= 20; i++) g.hexes[i].ownerId = 1;
    g.hexes[0].attackerId = 2;
    g.hexes[0].attackInvestment = 500;
    g.hexes[0].defenseInvestment = 0;
    g.hexes[0].battleProgress = rules.CAPTURE_TICKS - 1;
    room.tick();
    expect(g.players).toHaveLength(4);
    room.paused = true;
    expect(room.restart().ok).toBe(true);
    expect(room.view().game!.players).toHaveLength(2);
    expect(room.paused).toBe(false);
    expect(room.view().game!.winnerId).toBeNull();
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run test/rooms.test.ts -t "перезапуск"`
Expected: FAIL — `room.restart is not a function`.

- [ ] **Step 3: Реализовать**

В `server/src/rooms.ts`:

1. Вынести создание гексов в приватный метод (рядом с `start`):

```ts
  private buildHexes(): HexState[] {
    return generateMap(this.mapType).map((h) => ({
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
  }
```

2. В `start()` заменить блок `const hexes: HexState[] = generateMap(this.mapType).map(...)` на:

```ts
    const hexes = this.buildHexes();
```

3. Добавить метод (после `start`):

```ts
  restart(): { ok: true } | { ok: false; error: string } {
    if (!this.aiMode) return { ok: false, error: 'Перезапуск доступен только в игре с компьютером' };
    if (this.status !== 'playing' || !this.state) return { ok: false, error: 'Игра ещё не началась' };
    this.slots = this.slots.filter((s) => !this.eliminationSpawned.has(s.id));
    const players: PlayerState[] = this.slots.map((s) => ({
      id: s.id,
      name: s.name,
      points: rules.BASE_POINTS,
      isAi: s.isAi,
    }));
    const preset = MAP_PRESETS[this.mapType];
    this.state = { players, hexes: this.buildHexes(), columns: preset.columns, rows: preset.rows, winnerId: null, qOffset: preset.qOffset };
    this.paused = false;
    this.finishedAt = null;
    this.aiLastActionAt.clear();
    this.addLog('Игра перезапущена');
    return { ok: true };
  }
```

4. В `RoomManager` (после `startRoom`) добавить:

```ts
  restart(connId: number): { ok: true } | { ok: false; error: string } {
    const room = this.roomForConn(connId);
    if (!room) return { ok: false, error: 'Вы не в комнате' };
    return room.restart();
  }
```

В `server/src/ws.ts` — новый case (после `'start-room'`):

```ts
          case 'restart': {
            const result = manager.restart(connId);
            if (result.ok) broadcast();
            else sendError(ws, result.error);
            return;
          }
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run test/rooms.test.ts -t "перезапуск"`
Expected: PASS (3 теста).

- [ ] **Step 5: Полный прогон и коммит**

Run: `npx vitest run` → зелёные.

```bash
git add server/src/rooms.ts server/src/ws.ts server/test/rooms.test.ts
git commit -m "feat: перезапуск игры (только соло)"
```

---

### Task 6: Web — типы и API

**Files:**
- Modify: `web/src/types.ts`, `web/src/api.ts`

**Interfaces:**
- Produces: `ClientMessage` + `{ type: 'restart' }`; `Player` + `capital: { q: number; r: number } | null` и `eliminated: boolean`; `GameClient.sendRestart(): void`.
- Consumes: серверный `view()` из Task 4/5.

- [ ] **Step 1: Расширить типы**

В `web/src/types.ts`:

1. В интерфейс `Player` (после `isAi: boolean;`):

```ts
  capital: { q: number; r: number } | null;
  eliminated: boolean;
```

2. В union `ClientMessage` (после `{ type: 'pause' }`):

```ts
  | { type: 'restart' }
```

В `web/src/api.ts` (после `sendPause`):

```ts
  sendRestart(): void {
    this.send({ type: 'restart' });
  }
```

- [ ] **Step 2: Проверка типов**

Run: `npm run build` (в `web/`)
Expected: сборка проходит (vue-tsc не ругается; существующие места, использующие `Player`, не обязаны читать новые поля — они обязательные, но нигде в шаблонах они не используются до Task 7-9).

- [ ] **Step 3: Коммит**

```bash
git add web/src/types.ts web/src/api.ts
git commit -m "feat: web — типы столицы/выбытия и сообщение restart"
```

---

### Task 7: Web — армия в процентах

**Files:**
- Modify: `web/src/App.vue`, `web/src/components/ArmyBar.vue`, `web/src/components/Hud.vue`

**Interfaces:**
- Consumes: `props.army` в ArmyBar/Hud — теперь проценты (0–100).
- Produces: `armyPoints(): number` в App.vue — абсолютное значение на момент действия.

- [ ] **Step 1: App.vue — процент и конвертация**

В `web/src/App.vue`:

1. `const army = ref(200);` → `const army = ref(50);` (процент).

2. Удалить watch:

```ts
watch(
  () => myPlayer.value?.points ?? 0,
  (points) => {
    if (army.value > points) army.value = points;
  },
);
```

3. Добавить функцию (рядом с `isCapturable`):

```ts
function armyPoints(): number {
  const points = myPlayer.value?.points ?? 0;
  return Math.min(points, Math.max(1, Math.floor((points * army.value) / 100)));
}
```

4. В `isCapturable` заменить проверку бюджета:

```ts
  const human = g.players.find((p) => p.id === playerId.value);
  if (!human) return false;
  if (human.eliminated) return false;
  if (human.hexCount === 0) return true;
  if (human.points - armyPoints() < TERRAIN_COSTS[hex.terrain]) return false;
  return g.hexes.some((h) => h.ownerId === human.id && isAdjacent(h, hex));
```

5. В `onHexClick` заменить расчёт `send`:

```ts
function onHexClick(hex: Hex): void {
  if (playerId.value === null) return;
  if (myPlayer.value?.eliminated) return;
  const send = armyPoints();
  if (send < 1) return;
  if (hex.attackerId !== null) {
    if (hex.attackerId === playerId.value) {
      client.sendAttack(hex.q, hex.r, send);
    } else if (hex.ownerId === playerId.value || isAdjacentToMine(hex)) {
      client.sendDefend(hex.q, hex.r, send);
    }
    return;
  }
  if (isCapturable(hex)) {
    client.sendCapture(hex.q, hex.r, send);
    return;
  }
  if (hex.ownerId !== null && hex.ownerId !== playerId.value && isAdjacentToMine(hex)) {
    client.sendAttack(hex.q, hex.r, send);
  }
}
```

- [ ] **Step 2: ArmyBar.vue — проценты**

В `web/src/components/ArmyBar.vue` заменить весь `<script setup>` и шаблон блока:

```ts
const props = defineProps<{ game: GameState; humanId: number | null; army: number }>();

const emit = defineEmits<{ armyChange: [percent: number] }>();

const human = computed(() => props.game.players.find((p) => p.id === props.humanId) ?? null);
const max = computed(() => 100);
const points = computed(() => human.value?.points ?? 0);
const reserve = computed(() => Math.floor((points.value * props.army) / 100));
const available = computed(() => Math.max(0, points.value - reserve.value));
const limit = computed(() => human.value?.limit ?? 0);

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.floor(Number.isFinite(value) ? value : 0)));
}

function change(value: number): void {
  emit('armyChange', clamp(value));
}

function step(delta: number): void {
  change(props.army + delta);
}
```

Шаблон:

```html
    <div class="army-bar__row">
      <span class="army-bar__label">Армия</span>
      <button class="army-bar__btn" @click="step(-5)">−</button>
      <div class="army-bar__input-wrap">
        <input
          class="army-bar__input"
          type="number"
          min="0"
          max="100"
          :value="army"
          @change="change(Number(($event.target as HTMLInputElement).value))"
        />
        <span class="army-bar__percent">%</span>
      </div>
      <button class="army-bar__btn" @click="step(5)">+</button>
      <span class="army-bar__hint">% от очков · доступно {{ available }}/{{ limit }}</span>
    </div>
```

CSS: добавить:

```css
.army-bar__input-wrap {
  position: relative;
}

.army-bar__percent {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: #999;
  font-weight: 600;
  pointer-events: none;
}
```

- [ ] **Step 3: Hud.vue — резерв в процентах**

В `web/src/components/Hud.vue` заменить `pointsText`:

```ts
function pointsText(p: Player): string {
  if (p.id === props.humanId) {
    const reserve = Math.floor((p.points * props.army) / 100);
    return `${Math.max(0, p.points - reserve)}/${p.limit}`;
  }
  return `${p.points}/${p.limit}`;
}
```

- [ ] **Step 4: Проверка сборки**

Run: `npm run build` (в `web/`)
Expected: сборка проходит.

- [ ] **Step 5: Коммит**

```bash
git add web/src/App.vue web/src/components/ArmyBar.vue web/src/components/Hud.vue
git commit -m "feat: web — армия в процентах от очков"
```

---

### Task 8: Web — перезапуск в меню и баннеры победы/поражения

**Files:**
- Modify: `web/src/App.vue`

**Interfaces:**
- Consumes: `client.sendRestart()` (Task 6), `Player.eliminated` (Task 6), `room.aiMode`.

- [ ] **Step 1: Баннеры и пункт меню**

В `web/src/App.vue`:

1. Добавить computed (после `winner`):

```ts
const defeated = computed(() => {
  if (playerId.value === null || !game.value) return false;
  return game.value.players.find((p) => p.id === playerId.value)?.eliminated ?? false;
});
```

2. Функция (после `onPause`):

```ts
function onRestart(): void {
  if (!window.confirm('Перезапустить игру?')) return;
  burgerOpen.value = false;
  client.sendRestart();
}
```

3. Баннеры (заменить существующий `v-else-if="winner"`):

```html
        <div v-if="winner && defeated" class="banner banner--error">Поражение: {{ winner }}!</div>
        <div v-else-if="winner" class="banner banner--win">Победа: {{ winner }}!</div>
```

4. Burger-меню (добавить пункт перед «Выйти в меню»):

```html
        <button v-if="room?.aiMode" class="burger-menu__item" @click="onRestart">Перезапустить игру</button>
        <button class="burger-menu__item" @click="onToMenu">Выйти в меню</button>
```

- [ ] **Step 2: Hud.vue — метка «выбыл»**

В `web/src/components/Hud.vue` шаблон строки:

```html
      <span class="player-list__hexes">{{ p.hexCount }} кл.</span>
      <span v-if="p.eliminated" class="player-list__dead">выбыл</span>
```

CSS:

```css
.player-list__dead {
  color: #c62828;
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
}
```

и в класс строки добавить приглушение:

```html
      :class="{ 'player-list__row--me': p.id === humanId, 'player-list__row--dead': p.eliminated }"
```

```css
.player-list__row--dead {
  opacity: 0.45;
}
```

- [ ] **Step 3: Проверка сборки**

Run: `npm run build` (в `web/`)
Expected: сборка проходит.

- [ ] **Step 4: Коммит**

```bash
git add web/src/App.vue web/src/components/Hud.vue
git commit -m "feat: web — перезапуск в меню, баннеры победы/поражения, метка выбывшего"
```

---

### Task 9: Web — столица на карте

**Files:**
- Modify: `web/src/components/HexMap.vue`

**Interfaces:**
- Consumes: `Player.capital` (Task 6), `hexCenter(q, r)` (уже есть в HexMap.vue).

- [ ] **Step 1: Маркер и тултип**

В `web/src/components/HexMap.vue`:

1. Функция (после `captureState`):

```ts
function capitalPlayer(hex: Hex): Player | null {
  return props.players.find((p) => p.capital !== null && p.capital.q === hex.q && p.capital.r === hex.r) ?? null;
}
```

2. В шаблоне hex-group (после tint-полигона):

```html
        <text
          v-if="capitalPlayer(hex)"
          :x="hexCenter(hex.q, hex.r).x"
          :y="hexCenter(hex.q, hex.r).y + 11"
          text-anchor="middle"
          class="hex-capital"
        >★</text>
```

3. В тултипе строку владельца:

```html
      <div class="battle-tooltip__row">
        <span>Владелец: {{ playerName(hovered.ownerId) }}{{ capitalPlayer(hovered) ? ' ★ столица' : '' }}</span>
      </div>
```

4. CSS:

```css
.hex-capital {
  font-size: 26px;
  fill: #ffd54f;
  stroke: #1a1a1a;
  stroke-width: 1.5;
  pointer-events: none;
}
```

- [ ] **Step 2: Проверка сборки**

Run: `npm run build` (в `web/`)
Expected: сборка проходит.

- [ ] **Step 3: Коммит**

```bash
git add web/src/components/HexMap.vue
git commit -m "feat: web — маркер столицы на карте и в тултипе"
```

---

### Task 10: Финальная проверка

**Files:**
- нет изменений

- [ ] **Step 1: Все тесты сервера**

Run: `npx vitest run` (в `server/`)
Expected: все тесты зелёные (122 старых + новые).

- [ ] **Step 2: Сборка web**

Run: `npm run build` (в `web/`)
Expected: сборка проходит.

- [ ] **Step 3: Ручная проверка в dev-режиме**

Run: `npm run dev` (в `web/`) + сервер (`npm run dev` в `server/`), затем:
1. Соло-игра: ползунок армии в %, клик по нейтральному гексу — захват, стоимость в абсолютных очках.
2. Первый захваченный гекс — звезда; тултип «★ столица».
3. Burger-меню: «Перезапустить игру» только в соло; после рестарта всё сброшено.
4. Отрезание: выстроить ИИ цепочку клеток, захватить шейку — дальний кусок нейтрален.
5. Захват столицы ИИ (много атак) — ИИ выбывает, баннер победы.
6. Игра с людьми: «Перезапустить» отсутствует; после чужого выбытия строка «выбыл».

- [ ] **Step 4: Финальный коммит (если были правки)**

```bash
git add -A
git commit -m "fix: правки по итогам ручной проверки"
```
