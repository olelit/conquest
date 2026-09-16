# Дружелюбный ИИ в режиме обучения — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** В обучении ИИ не может победить игрока и первым объявить войну, а его первый гекс ставится рядом с игроком; этапы «Атака» и «Защита» работают.

**Architecture:** Обучение остаётся флагом `Room.training` (уже есть). Чистые функции `ai.ts` получают опции `{ training, maxHexes }`; `rules.ts` получает `placeFirstHex` (первый гекс без боя у границы) и опцию `canCapture` в `tickBattles` (столица игрока не захватывается). `rooms.ts` прокидывает опции, пропускает дипломатию ИИ в обучении и страхует от выбывания/победы ИИ.

**Tech Stack:** Node.js 22, TypeScript, vitest; сервер — Express/ws/TypeORM.

## Global Constraints

- Никаких новых npm-зависимостей.
- Обычный режим (не training) не меняется: все новые опции по умолчанию выключены.
- Лимит гексов ИИ в обучении: env `CONQUEST_TRAINING_AI_MAX_HEXES`, по умолчанию 5.
- Первый гекс ИИ — только свободный (`ownerId === null`, `attackerId === null`), не вода, сосед гекса игрока.
- Столица игрока в обучении не может сменить владельца из-за ИИ; игрок не выбывает, ИИ не получает `winnerId`.
- Тесты сервера: `npm test` (из `server/`); сборка: `npm run build` (из `server/`).
- Имена тестов и сообщения коммитов — на русском, как в репозитории.

---

### Task 1: `rules.placeFirstHex` — первый гекс без боя у границы

**Files:**
- Modify: `server/src/rules.ts` (после `applyCapture`, ~строка 253)
- Test: `server/test/rules.test.ts` (в конец файла)

**Interfaces:**
- Produces: `export function placeFirstHex(state: GameState, playerId: number, q: number, r: number): boolean` — ставит владельца на свободный гекс, назначает столицу, если её нет, очки не списывает; `false`, если гекс занят/в бою или игрок не найден/выбыл.
- Consumes: `findHex` (уже в `rules.ts`).

- [ ] **Step 1: Написать падающий тест**

Добавить `placeFirstHex` в алфавитный импорт из `../src/rules.js` (рядом с `pointLimit`) и в конец `server/test/rules.test.ts`:

```ts
describe('placeFirstHex', () => {
  it('ставит владельца и столицу бесплатно, без боя', () => {
    const s = makeState();
    expect(placeFirstHex(s, P, 3, 3)).toBe(true);
    const hex = findHex(s, 3, 3)!;
    expect(hex.ownerId).toBe(P);
    expect(hex.attackerId).toBeNull();
    expect(s.players[0].capital).toEqual({ q: 3, r: 3 });
    expect(s.players[0].points).toBe(1000);
  });
  it('отказывает на занятом гексе', () => {
    const s = makeState([{ q: 3, r: 3, ownerId: AI }]);
    expect(placeFirstHex(s, P, 3, 3)).toBe(false);
    expect(findHex(s, 3, 3)!.ownerId).toBe(AI);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test -- test/rules.test.ts -t "placeFirstHex"`
Expected: FAIL — `placeFirstHex is not a function` / ошибка импорта.

- [ ] **Step 3: Реализовать**

В `server/src/rules.ts` сразу после `applyCapture`:

```ts
// Первый гекс без боя: в обучении ИИ ставится вплотную к игроку,
// поэтому правила «сначала объяви войну» и боя у границы обходятся.
export function placeFirstHex(state: GameState, playerId: number, q: number, r: number): boolean {
  const hex = findHex(state, q, r);
  if (!hex || hex.ownerId !== null || hex.attackerId !== null) return false;
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.eliminated) return false;
  hex.ownerId = playerId;
  hex.fortress = false;
  if (!player.capital) player.capital = { q, r };
  return true;
}
```

- [ ] **Step 4: Прогнать тесты**

Run: `npm test -- test/rules.test.ts`
Expected: PASS, в том числе старые тесты `rules.test.ts`.

- [ ] **Step 5: Коммит**

```bash
git add server/src/rules.ts server/test/rules.test.ts
git commit -m "feat: placeFirstHex — первый гекс без боя у границы"
```

---

### Task 2: `rules.tickBattles` — опция `canCapture` (столица под защитой)

**Files:**
- Modify: `server/src/rules.ts:294-342` (`tickBattles`)
- Test: `server/test/rules.test.ts` (в конец файла)

**Interfaces:**
- Produces: `export interface TickBattlesOptions { canCapture?: (hex: HexState, attackerId: number) => boolean }`; `tickBattles(state, opts: TickBattlesOptions = {})`. Если `canCapture` вернул `false` на выигранном бою — результат `{ q, r, winnerId: null }` (ничья), `resetBattle`, владелец не меняется.
- Consumes: `resetBattle` (приватная в `rules.ts`), `CAPTURE_TICKS`.

- [ ] **Step 1: Написать падающие тесты**

В конец `server/test/rules.test.ts`:

```ts
describe('tickBattles: canCapture', () => {
  it('запрещает захват защищённого гекса — ничья', () => {
    const s = makeState([
      { q: 3, r: 3, ownerId: P, attackerId: AI, attackInvestment: 500, defenseInvestment: 0, battleProgress: CAPTURE_TICKS - 1 },
    ]);
    const results = tickBattles(s, { canCapture: (hex) => hex.ownerId !== P });
    const hex = findHex(s, 3, 3)!;
    expect(results).toEqual([{ q: 3, r: 3, winnerId: null }]);
    expect(hex.ownerId).toBe(P);
    expect(hex.attackerId).toBeNull();
    expect(hex.battleProgress).toBe(0);
  });
  it('без опции захват проходит как раньше', () => {
    const s = makeState([
      { q: 3, r: 3, ownerId: P, attackerId: AI, attackInvestment: 500, defenseInvestment: 0, battleProgress: CAPTURE_TICKS - 1 },
    ]);
    const results = tickBattles(s);
    expect(results[0].winnerId).toBe(AI);
    expect(findHex(s, 3, 3)!.ownerId).toBe(AI);
  });
});
```

- [ ] **Step 2: Убедиться, что первый тест падает**

Run: `npm test -- test/rules.test.ts -t "canCapture"`
Expected: FAIL — первый тест: владелец стал `AI` (нет опции), второй PASS.

- [ ] **Step 3: Реализовать**

Заменить сигнатуру и добавить интерфейс перед `tickBattles`:

```ts
export interface TickBattlesOptions {
  canCapture?: (hex: HexState, attackerId: number) => boolean;
}

export function tickBattles(state: GameState, opts: TickBattlesOptions = {}): BattleResult[] {
```

В ветке `if (hex.battleProgress >= CAPTURE_TICKS) {` первой строкой:

```ts
    if (hex.battleProgress >= CAPTURE_TICKS) {
      if (opts.canCapture && !opts.canCapture(hex, hex.attackerId)) {
        results.push({ q: hex.q, r: hex.r, winnerId: null });
        resetBattle(hex);
        continue;
      }
      const oldOwnerId = hex.ownerId;
```

- [ ] **Step 4: Прогнать тесты**

Run: `npm test -- test/rules.test.ts`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add server/src/rules.ts server/test/rules.test.ts
git commit -m "feat: tickBattles.canCapture — защита гекса от захвата"
```

---

### Task 3: `config.trainingAiMaxHexes` + обучение в `ai.ts`

**Files:**
- Modify: `server/src/config.ts:45-46`
- Modify: `server/src/ai.ts:22-30, 40-48, 111-119, 163-184`
- Test: `server/test/ai.test.ts` (в конец файла)

**Interfaces:**
- Produces: `export interface AiOptions { training?: boolean; maxHexes?: number }`; `chooseAiAction(state: GameState, aiId: number, opts: AiOptions = {}): AiAction | null`.
- Consumes: `config.trainingAiMaxHexes` вызывает `rooms.ts` (Task 4); `isAdjacent`, `terrainCost`, `hexCount` уже импортированы в `ai.ts`.

- [ ] **Step 1: Добавить конфиг**

В `server/src/config.ts` после `feedbackRateLimit`:

```ts
  trainingAiMaxHexes: number('CONQUEST_TRAINING_AI_MAX_HEXES', 5),
```

- [ ] **Step 2: Написать падающие тесты**

В конец `server/test/ai.test.ts`:

```ts
describe('chooseAiAction: обучение', () => {
  const training = { training: true, maxHexes: 5 };
  it('ждёт, пока у игрока не появится гекс', () => {
    const s = makeState([]);
    s.players[0].isAi = true;
    expect(chooseAiAction(s, AI, training)).toBeNull();
  });
  it('первый гекс — свободный неводный сосед игрока, самый дешёвый', () => {
    const s = makeState([{ q: 4, r: 4, ownerId: P }]);
    s.players[0].isAi = true;
    for (const h of s.hexes) h.terrain = 'water';
    const find = (q: number, r: number) => s.hexes.find((h) => h.q === q && h.r === r)!;
    find(5, 4).terrain = 'forest';
    find(4, 5).terrain = 'grass';
    expect(chooseAiAction(s, AI, training)).toEqual({ type: 'capture', q: 4, r: 5 });
  });
  it('при лимите гексов не захватывает нейтралов', () => {
    const hexes: Partial<HexState>[] = [];
    for (let i = 0; i < 5; i++) hexes.push({ q: 10 + i, r: 8, ownerId: AI });
    const s = makeState(hexes);
    s.players[0].isAi = true;
    expect(chooseAiAction(s, AI, training)).toBeNull();
  });
  it('при лимите гексов отвечает атакой на войне', () => {
    const hexes: Partial<HexState>[] = [{ q: 4, r: 4, ownerId: P }];
    for (let i = 0; i < 5; i++) hexes.push({ q: 5 + i, r: 4, ownerId: AI });
    const s = makeState(hexes);
    s.players[0].isAi = true;
    declareWar(s, AI, P);
    expect(chooseAiAction(s, AI, training)).toEqual({ type: 'attack', q: 4, r: 4, points: 150 });
  });
});
```

- [ ] **Step 3: Убедиться, что тесты падают**

Run: `npm test -- test/ai.test.ts -t "обучение"`
Expected: FAIL — третий аргумент игнорируется: «ждёт» вернёт `capture` с дальнего гекса, «первый гекс» — не `(4,5)`, «лимит» — capture нейтрала.

- [ ] **Step 4: Реализовать в `ai.ts`**

Интерфейс после `DiplomacyContext`:

```ts
export interface AiOptions {
  training?: boolean;
  maxHexes?: number;
}
```

Заменить строку сигнатуры `chooseAiAction` (`ai.ts:40`) на:

```ts
export function chooseAiAction(state: GameState, aiId: number, opts: AiOptions = {}): AiAction | null {
```

Заменить первый вызов первого захвата (`ai.ts:47`) на:

```ts
    return chooseFirstCapture(state, aiId, opts.training === true);
```

Перед `const affordableNeutral = ...` (строка ~111) добавить гейт лимита:

```ts
  const capturesAllowed =
    !opts.training || aiHexCount < (opts.maxHexes ?? Number.POSITIVE_INFINITY);

  const affordableNeutral = capturesAllowed
    ? state.hexes
        .filter((hex) => hex.ownerId === null && hex.attackerId === null && hasAdjacentOwner(state, hex.q, hex.r, aiId))
        .filter((hex) => terrainCost(hex.terrain) <= ai.points)
        .filter((hex) => !hasPeacefulNeighbor(state, hex.q, hex.r, aiId))
        .sort((a, b) => captureScore(state, a, aiId) - captureScore(state, b, aiId))
    : [];
```

`chooseFirstCapture` целиком (замена существующей функции):

```ts
function chooseFirstCapture(state: GameState, aiId: number, training = false): AiAction | null {
  if (training) {
    const humanHexes = state.hexes.filter((hex) => {
      if (hex.ownerId === null) return false;
      const owner = state.players.find((p) => p.id === hex.ownerId);
      return owner !== undefined && !owner.isAi && !owner.eliminated;
    });
    if (humanHexes.length === 0) return null;
    const candidates = state.hexes.filter(
      (hex) =>
        hex.ownerId === null &&
        hex.attackerId === null &&
        hex.terrain !== 'water' &&
        humanHexes.some((h) => isAdjacent(h, hex)),
    );
    if (candidates.length === 0) return null;
    const best = candidates.sort(
      (a, b) => terrainCost(a.terrain) - terrainCost(b.terrain) || a.q - b.q || a.r - b.r,
    )[0];
    return { type: 'capture', q: best.q, r: best.r };
  }
  const free = state.hexes.filter(
    (hex) => hex.ownerId === null && hex.attackerId === null && hex.terrain !== 'water',
  );
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
```

- [ ] **Step 5: Прогнать тесты**

Run: `npm test -- test/ai.test.ts`
Expected: PASS, включая все старые тесты `ai.test.ts`.

- [ ] **Step 6: Коммит**

```bash
git add server/src/config.ts server/src/ai.ts server/test/ai.test.ts
git commit -m "feat: обучение — лимит гексов и первый гекс рядом с игроком"
```

---

### Task 4: `rooms.ts` — ожидание, первый гекс рядом, лимит

**Files:**
- Modify: `server/src/rooms.ts:425` (вызов `chooseAiAction`), `server/src/rooms.ts:804-838` (`applyAiAction`, case `capture`)
- Test: `server/test/rooms.test.ts` (в `describe('Room: обучение', ...)`, после строки 895)

**Interfaces:**
- Consumes: `chooseAiAction(state, aiId, opts)` и `config.trainingAiMaxHexes` (Task 3); `rules.placeFirstHex` (Task 1); `config` уже импортирован в `rooms.ts:6`.
- Produces: в обучении первый захват ИИ выполняется через `placeFirstHex`.

- [ ] **Step 1: Написать падающие тесты**

В `server/test/rooms.test.ts` внутри `describe('Room: обучение', ...)`:

```ts
  it('ИИ ждёт первый гекс игрока, затем ставит свой рядом', () => {
    const room = new Room(1, 'Тест', 'tutorial', 2, true, 1, () => 0.5, 'easy', false, true);
    room.addHuman('A', 1);
    room.start(1);
    const g = room.gameState!;
    const ai = g.players.find((p) => p.isAi)!;
    const find = (q: number, r: number) => g.hexes.find((h) => h.q === q && h.r === r)!;
    find(4, 3).terrain = 'grass';
    find(5, 3).terrain = 'grass';
    room.tick();
    expect(g.hexes.some((h) => h.ownerId === ai.id)).toBe(false);
    expect(room.handleAction(1, 'capture', { q: 4, r: 3 }).type).toBe('state');
    room['aiLastActionAt'].set(ai.id, Date.now() - 2000);
    room.tick();
    const aiHexes = g.hexes.filter((h) => h.ownerId === ai.id);
    expect(aiHexes).toHaveLength(1);
    expect(rules.isAdjacent(aiHexes[0], find(4, 3))).toBe(true);
    expect(aiHexes[0].attackerId).toBeNull();
  });
  it('ИИ не расширяется сверх лимита гексов', () => {
    const room = new Room(1, 'Тест', 'tutorial', 2, true, 1, () => 0.5, 'easy', false, true);
    room.addHuman('A', 1);
    room.start(1);
    const g = room.gameState!;
    const ai = g.players.find((p) => p.isAi)!;
    const find = (q: number, r: number) => g.hexes.find((h) => h.q === q && h.r === r)!;
    find(1, 1).ownerId = ai.id;
    find(2, 1).ownerId = ai.id;
    find(3, 1).ownerId = ai.id;
    find(1, 2).ownerId = ai.id;
    find(2, 2).ownerId = ai.id;
    find(3, 2).terrain = 'grass';
    expect(rules.hexCount(g, ai.id)).toBe(5);
    room.tick();
    expect(rules.hexCount(g, ai.id)).toBe(5);
    expect(find(3, 2).ownerId).toBeNull();
  });
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test -- test/rooms.test.ts -t "обучение"`
Expected: FAIL — в первом тесте ИИ захватит гекс до хода игрока или поставит бой/далёкий гекс; во втором захватит 6-й гекс.

- [ ] **Step 3: Реализовать в `rooms.ts`**

Вызов ИИ (строка ~425):

```ts
      const action = chooseAiAction(state, player.id, {
        training: this.training,
        maxHexes: config.trainingAiMaxHexes,
      });
```

`applyAiAction`, case `capture`:

```ts
      case 'capture':
        if (this.training && rules.hexCount(state, playerId) === 0) {
          if (rules.placeFirstHex(state, playerId, action.q, action.r)) {
            this.stats.record({ type: 'action', t: Date.now(), playerId, action: 'capture', q: action.q, r: action.r });
          }
          break;
        }
        if (rules.validateCapture(state, playerId, action.q, action.r).ok) {
          rules.applyCapture(state, playerId, action.q, action.r);
          this.stats.record({ type: 'action', t: Date.now(), playerId, action: 'capture', q: action.q, r: action.r });
          this.recordReaction(playerId, action.q, action.r, Date.now());
        }
        break;
```

- [ ] **Step 4: Прогнать тесты**

Run: `npm test -- test/rooms.test.ts`
Expected: PASS, включая все старые тесты `rooms.test.ts`.

- [ ] **Step 5: Коммит**

```bash
git add server/src/rooms.ts server/test/rooms.test.ts
git commit -m "feat: обучение — ИИ ждёт игрока и ставит первый гекс рядом"
```

---

### Task 5: `rooms.ts` — пацифизм, неприкосновенная столица, страховки

**Files:**
- Modify: `server/src/rooms.ts:346` (`tickBattles`), `server/src/rooms.ts:419-429` (дипломатия ИИ), `server/src/rooms.ts:436-454` (`updateWinner`), `server/src/rooms.ts:505-509` (`handlePlayerLoss`), новый метод `isHumanCapital`
- Test: `server/test/rooms.test.ts` (в `describe('Room: обучение', ...)`)

**Interfaces:**
- Consumes: `rules.tickBattles(state, opts)` (Task 2), `rules.findHex`, `rules.hexCount`, `rules.applyCut`.
- Produces: гарантии «ИИ не объявляет войну», «ИИ не берёт столицу», «человек не выбывает», «ИИ не побеждает».

- [ ] **Step 1: Написать падающие тесты**

В `server/test/rooms.test.ts` внутри `describe('Room: обучение', ...)`:

```ts
  it('ИИ не объявляет войну игроку в обучении', () => {
    const room = new Room(1, 'Тест', 'tutorial', 2, true, 1, () => 0.5, 'easy', false, true);
    room.addHuman('A', 1);
    room.start(1);
    const g = room.gameState!;
    const ai = g.players.find((p) => p.isAi)!;
    const find = (q: number, r: number) => g.hexes.find((h) => h.q === q && h.r === r)!;
    find(6, 5).ownerId = 1;
    g.players[0].capital = { q: 6, r: 5 };
    find(7, 5).ownerId = ai.id;
    find(8, 5).ownerId = ai.id;
    find(8, 6).ownerId = ai.id;
    g.players[1].capital = { q: 7, r: 5 };
    room.tick();
    expect(rules.relation(g, 1, ai.id)).toBe('peace');
    expect(room.view(1).log.some((l) => l.text.includes('declared war'))).toBe(false);
  });
  it('после объявления войны игроком ИИ атакует его гекс', () => {
    const room = new Room(1, 'Тест', 'tutorial', 2, true, 1, () => 0.5, 'easy', false, true);
    room.addHuman('A', 1);
    room.start(1);
    const g = room.gameState!;
    const ai = g.players.find((p) => p.isAi)!;
    const find = (q: number, r: number) => g.hexes.find((h) => h.q === q && h.r === r)!;
    find(6, 5).ownerId = 1;
    g.players[0].capital = { q: 6, r: 5 };
    find(7, 5).ownerId = ai.id;
    g.players[1].capital = { q: 7, r: 5 };
    rules.declareWar(g, 1, ai.id);
    room.tick();
    expect(g.hexes.some((h) => h.ownerId === 1 && h.attackerId === ai.id)).toBe(true);
  });
  it('ИИ не забирает столицу игрока — бой заканчивается ничьей', () => {
    const room = new Room(1, 'Тест', 'tutorial', 2, true, 1, () => 0.5, 'easy', false, true);
    room.addHuman('A', 1);
    room.start(1);
    const g = room.gameState!;
    const ai = g.players.find((p) => p.isAi)!;
    const find = (q: number, r: number) => g.hexes.find((h) => h.q === q && h.r === r)!;
    find(6, 5).ownerId = 1;
    find(6, 5).attackerId = ai.id;
    find(6, 5).attackInvestment = 500;
    find(6, 5).defenseInvestment = 0;
    find(6, 5).battleProgress = rules.CAPTURE_TICKS - 1;
    g.players[0].capital = { q: 6, r: 5 };
    find(7, 5).ownerId = ai.id;
    g.players[1].capital = { q: 7, r: 5 };
    rules.declareWar(g, 1, ai.id);
    room.tick();
    expect(find(6, 5).ownerId).toBe(1);
    expect(g.players[0].eliminated).not.toBe(true);
  });
  it('при потере столицы человек не выбывает, гекс возвращается', () => {
    const room = new Room(1, 'Тест', 'tutorial', 2, true, 1, () => 0.5, 'easy', false, true);
    room.addHuman('A', 1);
    room.start(1);
    const g = room.gameState!;
    const ai = g.players.find((p) => p.isAi)!;
    const find = (q: number, r: number) => g.hexes.find((h) => h.q === q && h.r === r)!;
    find(6, 5).ownerId = ai.id;
    g.players[0].capital = { q: 6, r: 5 };
    room['handlePlayerLoss'](1);
    expect(find(6, 5).ownerId).toBe(1);
    expect(g.players[0].eliminated).not.toBe(true);
  });
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test -- test/rooms.test.ts -t "обучение"`
Expected: FAIL — первый тест: ИИ объявит войну (3 гекса против 1); третий: столица перейдёт ИИ; четвёртый: игрок выбудет и гекс останется у ИИ.

- [ ] **Step 3: Реализовать в `rooms.ts`**

`tick()`, вызов боёв (строка ~346):

```ts
    const results = rules.tickBattles(
      state,
      this.training ? { canCapture: (hex) => !this.isHumanCapital(hex) } : {},
    );
```

`tick()`, дипломатия ИИ (строка ~424):

```ts
      if (!this.training) this.handleAiDiplomacy(state, player.id);
```

`updateWinner`:

```ts
    if (majority !== undefined) {
      if (majority.isAi) {
        if (!this.training) state.winnerId = majority.id;
      } else {
        this.majorityHolderId = majority.id;
      }
      return;
    }
    this.majorityHolderId = null;
    const remaining = state.players.filter((p) => !p.eliminated);
    if (remaining.length === 1 && rules.hexCount(state, remaining[0].id) > 0) {
      if (!(this.training && remaining[0].isAi)) state.winnerId = remaining[0].id;
    }
```

`handlePlayerLoss` — первой строкой после `const state = this.state!;`:

```ts
    if (this.training) {
      const player = state.players.find((p) => p.id === playerId);
      if (player && !player.isAi) {
        if (player.capital) {
          const capitalHex = rules.findHex(state, player.capital.q, player.capital.r);
          if (capitalHex && capitalHex.ownerId !== playerId) {
            capitalHex.ownerId = playerId;
            capitalHex.fortress = false;
          }
        }
        const cut = rules.applyCut(state, playerId);
        if (cut.length > 0) {
          this.addLog(`${this.playerName(playerId)} was cut off: ${cut.length} hexes became neutral`);
        }
        return;
      }
    }
```

Новый приватный метод (рядом с `playerName`):

```ts
  private isHumanCapital(hex: HexState): boolean {
    const human = this.state?.players.find((p) => !p.isAi && !p.eliminated);
    if (!human?.capital) return false;
    return human.capital.q === hex.q && human.capital.r === hex.r;
  }
```

- [ ] **Step 4: Прогнать тесты**

Run: `npm test -- test/rooms.test.ts`
Expected: PASS.

- [ ] **Step 5: Полный прогон сервера и сборка**

Run: `npm test`
Expected: PASS (все файлы тестов).

Run: `npm run build`
Expected: без ошибок TypeScript.

- [ ] **Step 6: Коммит**

```bash
git add server/src/rooms.ts server/test/rooms.test.ts
git commit -m "feat: обучение — ИИ не объявляет войну, не берёт столицу и не побеждает"
```

---

## Проверка после всех задач

- `npm test` (из `server/`) — зелёный.
- `npm run build` (из `server/`) — без ошибок.
- Ручная проверка (по желанию): запустить сервер и web, нажать «Обучение»:
  ИИ не ходит до первого гекса игрока; после — ставит свой гекс вплотную;
  сам не объявляет войну; на этапе «Атака» игрок объявляет войну и атакует;
  на этапе «Защита» ИИ атакует гекс игрока; столицу забрать не может.
