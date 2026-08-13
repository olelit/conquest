# Анализ скорости ИИ (статистика) + уровни сложности + дефолт армии 20% — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать модуль статистики игры (JSON-лог для анализа темпа ИИ vs человека), уровни сложности ИИ (множитель дохода) и дефолт армии 20%.

**Architecture:** `GameStatsRecorder` (server/src/stats.ts) собирает события (start/action/battle/reaction/snapshot/end) и при завершении игры пишет JSON в `stats/`. Сложность — `Difficulty = 'easy'|'medium'|'hard'`, множители дохода ИИ 0.5/0.75/1.0 через `PlayerState.incomeMultiplier` в `applyIncome`. Web: выбор сложности в соло-меню, дефолт армии 20%.

**Tech Stack:** Node.js + TypeScript, vitest (server); Vue 3 + Vite (web).

## Global Constraints

- Тесты сервера: `npx vitest run` из `server/` (145 существующих тестов должны остаться зелёными).
- Проверка web: `npm run build` из `web/` (vue-tsc + vite).
- Язык логов/сообщений — русский.
- Спецификация: `docs/superpowers/specs/2026-08-13-ai-stats-difficulty-design.md`.
- `Room` constructor: параметры `(id, name, mapType, maxPlayers, aiMode, aiCount, rng = Math.random, difficulty: Difficulty = 'medium')` — порядок не менять (тесты передают rng 7-м).
- `PlayerState.incomeMultiplier?: number` — по умолчанию 1 (undefined).
- Доход за гекс = 2 (CONQUEST_INCOME_PER_HEX=2), множитель применяется к полному доходу игрока за тик с `Math.floor`.

---

### Task 1: Дефолт армии — 20%

**Files:**
- Modify: `web/src/App.vue`

- [ ] **Step 1: Изменить значение**

В `web/src/App.vue`: `const army = ref(50);` → `const army = ref(20);`

- [ ] **Step 2: Проверить сборку**

Run: `npm run build` (в `web/`)
Expected: сборка проходит.

- [ ] **Step 3: Коммит**

```bash
git add web/src/App.vue
git commit -m "feat: дефолт армии — 20%"
```

---

### Task 2: Сложность — конфиг и правила

**Files:**
- Modify: `server/src/config.ts`, `server/src/rules.ts`
- Test: `server/test/rules.test.ts`

**Interfaces:**
- Produces: `export type Difficulty = 'easy' | 'medium' | 'hard'` (из `server/src/config.ts`); `config.aiIncomeMultipliers: Record<Difficulty, number>` (0.5/0.75/1); `config.statsDir: string` (env `CONQUEST_STATS_DIR`, default `'stats'`); `PlayerState.incomeMultiplier?: number`; `applyIncome` учитывает множитель.

- [ ] **Step 1: Написать падающие тесты**

В `server/test/rules.test.ts` добавить (после блока «экономика»):

```ts
describe('доход с множителем', () => {
  it('множитель 0.5 округляет доход вниз', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: P }, { q: 6, r: 5, ownerId: P }, { q: 7, r: 5, ownerId: P }]);
    s.players[0].incomeMultiplier = 0.5;
    applyIncome(s);
    expect(s.players[0].points).toBe(1003); // 3 гекса × 2 очка = 6, × 0.5 = 3
  });
  it('без множителя доход как раньше', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: P }]);
    applyIncome(s);
    expect(s.players[0].points).toBe(1002);
  });
  it('множитель 1 не меняет доход', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: P }, { q: 6, r: 5, ownerId: P }]);
    s.players[0].incomeMultiplier = 1;
    applyIncome(s);
    expect(s.players[0].points).toBe(1004);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run test/rules.test.ts -t "множителем"`
Expected: FAIL — `incomeMultiplier` игнорируется (доход без множителя).

- [ ] **Step 3: Реализовать**

В `server/src/config.ts`:

1. В начало файла (после импорта `Terrain`) добавить:

```ts
export type Difficulty = 'easy' | 'medium' | 'hard';
```

2. В объект `config` добавить (после `aiActionIntervalMs`):

```ts
  statsDir: process.env.CONQUEST_STATS_DIR ?? 'stats',
  aiIncomeMultipliers: {
    easy: number('CONQUEST_AI_INCOME_EASY', 0.5),
    medium: number('CONQUEST_AI_INCOME_MEDIUM', 0.75),
    hard: number('CONQUEST_AI_INCOME_HARD', 1),
  } as Record<Difficulty, number>,
```

В `server/src/rules.ts`:

1. В `PlayerState` (после `isAi?: boolean`) добавить:

```ts
  incomeMultiplier?: number;
```

2. Заменить `applyIncome`:

```ts
export function applyIncome(state: GameState): void {
  for (const player of state.players) {
    const count = hexCount(state, player.id);
    const income = Math.floor(playerIncome(state, player.id) * (player.incomeMultiplier ?? 1));
    player.points = Math.min(player.points + income, pointLimit(count));
  }
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run test/rules.test.ts -t "множителем"`
Expected: PASS (3 теста). Затем `npx vitest run` — все зелёные (145 + 3).

- [ ] **Step 5: Коммит**

```bash
git add server/src/config.ts server/src/rules.ts server/test/rules.test.ts
git commit -m "feat: сложность — множитель дохода ИИ в applyIncome"
```

---

### Task 3: Сложность — комната, соло-создание, ws

**Files:**
- Modify: `server/src/rooms.ts`, `server/src/ws.ts`
- Test: `server/test/rooms.test.ts`

**Interfaces:**
- Consumes: `Difficulty`, `config.aiIncomeMultipliers` (Task 2).
- Produces: `Room` constructor 8-й параметр `difficulty: Difficulty = 'medium'`; `RoomManager.createSolo(connId, mapType, aiCount, difficulty)`; ws-сообщение `start-solo` с полем `difficulty`; ИИ-игроки получают `incomeMultiplier` по сложности комнаты (мультиплеер — medium 0.75).

- [ ] **Step 1: Написать падающие тесты**

В `server/test/rooms.test.ts` добавить (после блока «Room: перезапуск»):

```ts
describe('Room: сложность', () => {
  it('соло с easy: ИИ получает множитель 0.5, человек — без множителя', () => {
    const m = new RoomManager();
    expect(m.createSolo(1, 'normal', 1, 'easy').ok).toBe(true);
    const g = m.roomForConn(1)!.gameState!;
    const human = g.players.find((p) => !p.isAi)!;
    const ai = g.players.find((p) => p.isAi)!;
    expect(human.incomeMultiplier).toBeUndefined();
    expect(ai.incomeMultiplier).toBe(0.5);
  });
  it('неизвестная сложность — ошибка', () => {
    const m = new RoomManager();
    expect(m.createSolo(1, 'normal', 1, 'impossible' as Difficulty).ok).toBe(false);
  });
  it('мультиплеер: ИИ на средней сложности', () => {
    const room = makeRoom(false, 1, 2);
    room.addHuman('A', 1);
    room.start(1);
    expect(room.gameState!.players.find((p) => p.isAi)!.incomeMultiplier).toBe(0.75);
  });
});
```

В начало файла добавить импорт: `import type { Difficulty } from '../src/config.js';`

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run test/rooms.test.ts -t "сложность"`
Expected: FAIL — `createSolo` не принимает 4-й аргумент / множитель не выставляется.

- [ ] **Step 3: Реализовать**

В `server/src/rooms.ts`:

1. Импорт: `import { config, type Difficulty } from './config.js';` (заменить существующий `import { config } from './config.js';`).

2. Конструктор Room — добавить 8-й параметр:

```ts
  constructor(
    readonly id: number,
    readonly name: string,
    readonly mapType: MapType,
    readonly maxPlayers: number,
    readonly aiMode: boolean,
    private readonly aiCount: number,
    private readonly rng: () => number = Math.random,
    readonly difficulty: Difficulty = 'medium',
  ) {}
```

3. Вынести построение игроков в приватный метод (используется в `start()` и `restart()`):

```ts
  private buildPlayers(): PlayerState[] {
    return this.slots.map((s) => ({
      id: s.id,
      name: s.name,
      points: rules.BASE_POINTS,
      isAi: s.isAi,
      ...(s.isAi ? { incomeMultiplier: config.aiIncomeMultipliers[this.difficulty] } : {}),
    }));
  }
```

4. В `start()` заменить блок `const players: PlayerState[] = this.slots.map(...)` на:

```ts
    const players = this.buildPlayers();
```

5. В `restart()` заменить аналогичный блок на ту же строку.

6. `createSolo` — новая сигнатура и валидация:

```ts
  createSolo(connId: number, mapType: MapType, aiCount: number, difficulty: Difficulty = 'medium'): { ok: true } | { ok: false; error: string } {
    if (this.connToRoom.has(connId)) return { ok: false, error: 'Вы уже в комнате' };
    const preset = MAP_PRESETS[mapType];
    if (!preset) return { ok: false, error: 'Неизвестный тип карты' };
    if (!Number.isInteger(aiCount) || aiCount < 1 || aiCount > preset.maxPlayers - 1) {
      return { ok: false, error: `Компьютеров должно быть от 1 до ${preset.maxPlayers - 1}` };
    }
    if (!['easy', 'medium', 'hard'].includes(difficulty)) {
      return { ok: false, error: 'Неизвестная сложность' };
    }
    const room = new Room(this.nextRoomId++, randomCountryName(), mapType, preset.maxPlayers, true, aiCount, undefined, difficulty);
    const slot = room.addHuman(this.connName(connId), connId);
    if (slot === null) return { ok: false, error: 'Комната заполнена' };
    this.rooms.set(room.id, room);
    this.connToRoom.set(connId, room.id);
    return room.start(connId);
  }
```

В `server/src/ws.ts`:

1. Импорт: `import type { Difficulty } from './config.js';`

2. В `WsMessage` добавить `difficulty?: string;`

3. Заменить case `'start-solo'`:

```ts
          case 'start-solo': {
            const result = manager.createSolo(connId, String(message.mapType ?? '') as MapType, Number(message.aiCount), (message.difficulty ?? 'medium') as Difficulty);
            if (result.ok) broadcast();
            else sendError(ws, result.error);
            return;
          }
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run test/rooms.test.ts -t "сложность"`
Expected: PASS (3 теста). Затем `npx vitest run` — все зелёные.

- [ ] **Step 5: Коммит**

```bash
git add server/src/rooms.ts server/src/ws.ts server/test/rooms.test.ts
git commit -m "feat: сложность в соло-создании и комнатах"
```

---

### Task 4: Модуль статистики — GameStatsRecorder

**Files:**
- Create: `server/src/stats.ts`
- Test: `server/test/stats.test.ts`

**Interfaces:**
- Produces:
  - `export type StatsEvent = { type: 'start'; t: number; mapType: string; players: { id: number; name: string; isAi: boolean; incomeMultiplier: number }[] } | { type: 'action'; t: number; playerId: number; action: 'capture' | 'attack' | 'defend'; q: number; r: number } | { type: 'battle'; t: number; q: number; r: number; winnerId: number | null } | { type: 'reaction'; t: number; playerId: number; ms: number } | { type: 'snapshot'; t: number; players: { id: number; hexCount: number; points: number }[] } | { type: 'end'; t: number; winnerId: number | null; durationMs: number }`
  - `export interface StatsPlayerSummary { id: number; name: string; isAi: boolean; incomeMultiplier: number; actions: number; captures: number; attacks: number; defends: number; actionsPerMinute: number; reactions: { count: number; avgMs: number; maxMs: number } | null; hexesAtEnd: number; pointsAtEnd: number }`
  - `export interface StatsSummary { durationMs: number; battles: number; players: StatsPlayerSummary[] }`
  - `export class GameStatsRecorder { constructor(roomId: number); get events(): StatsEvent[]; record(event: StatsEvent): void; clear(): void; writeSummary(statsDir: string): string }`

- [ ] **Step 1: Написать падающие тесты**

Создать `server/test/stats.test.ts`:

```ts
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { GameStatsRecorder } from '../src/stats.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

describe('GameStatsRecorder', () => {
  it('writeSummary пишет файл со сводкой', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stats-'));
    dirs.push(dir);
    const rec = new GameStatsRecorder(42);
    rec.record({ type: 'start', t: 1000, mapType: 'normal', players: [
      { id: 1, name: 'A', isAi: false, incomeMultiplier: 1 },
      { id: 2, name: 'B', isAi: true, incomeMultiplier: 0.5 },
    ] });
    rec.record({ type: 'action', t: 2000, playerId: 2, action: 'capture', q: 5, r: 5 });
    rec.record({ type: 'battle', t: 3000, q: 5, r: 5, winnerId: 2 });
    rec.record({ type: 'reaction', t: 3500, playerId: 2, ms: 1200 });
    rec.record({ type: 'snapshot', t: 4000, players: [
      { id: 1, hexCount: 3, points: 1050 },
      { id: 2, hexCount: 5, points: 900 },
    ] });
    rec.record({ type: 'end', t: 5000, winnerId: 2, durationMs: 4000 });
    const path = rec.writeSummary(dir);
    expect(statSync(path).isFile()).toBe(true);
    const data = JSON.parse(readFileSync(path, 'utf8'));
    expect(data.meta.roomId).toBe(42);
    expect(data.summary.durationMs).toBe(4000);
    expect(data.summary.battles).toBe(1);
    const ai = data.summary.players.find((p: { id: number }) => p.id === 2);
    expect(ai.actions).toBe(1);
    expect(ai.captures).toBe(1);
    expect(ai.actionsPerMinute).toBe(15); // 1 действие за 4 сек
    expect(ai.reactions).toEqual({ count: 1, avgMs: 1200, maxMs: 1200 });
    expect(ai.hexesAtEnd).toBe(5);
    expect(ai.pointsAtEnd).toBe(900);
  });
  it('без end-события сводка не падает', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stats-'));
    dirs.push(dir);
    const rec = new GameStatsRecorder(7);
    rec.record({ type: 'start', t: 1000, mapType: 'normal', players: [] });
    rec.record({ type: 'action', t: 2000, playerId: 1, action: 'capture', q: 0, r: 0 });
    const path = rec.writeSummary(dir);
    const data = JSON.parse(readFileSync(path, 'utf8'));
    expect(data.summary.durationMs).toBe(0);
    expect(data.summary.players).toHaveLength(0);
    expect(data.events).toHaveLength(2);
  });
  it('clear очищает события', () => {
    const rec = new GameStatsRecorder(1);
    rec.record({ type: 'action', t: 1, playerId: 1, action: 'capture', q: 0, r: 0 });
    rec.clear();
    expect(rec.events).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run test/stats.test.ts`
Expected: FAIL — модуль `../src/stats.js` не найден.

- [ ] **Step 3: Реализовать**

Создать `server/src/stats.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type StatsEvent =
  | { type: 'start'; t: number; mapType: string; players: { id: number; name: string; isAi: boolean; incomeMultiplier: number }[] }
  | { type: 'action'; t: number; playerId: number; action: 'capture' | 'attack' | 'defend'; q: number; r: number }
  | { type: 'battle'; t: number; q: number; r: number; winnerId: number | null }
  | { type: 'reaction'; t: number; playerId: number; ms: number }
  | { type: 'snapshot'; t: number; players: { id: number; hexCount: number; points: number }[] }
  | { type: 'end'; t: number; winnerId: number | null; durationMs: number };

export interface StatsPlayerSummary {
  id: number;
  name: string;
  isAi: boolean;
  incomeMultiplier: number;
  actions: number;
  captures: number;
  attacks: number;
  defends: number;
  actionsPerMinute: number;
  reactions: { count: number; avgMs: number; maxMs: number } | null;
  hexesAtEnd: number;
  pointsAtEnd: number;
}

export interface StatsSummary {
  durationMs: number;
  battles: number;
  players: StatsPlayerSummary[];
}

export class GameStatsRecorder {
  private readonly recorded: StatsEvent[] = [];

  constructor(private readonly roomId: number) {}

  get events(): StatsEvent[] {
    return this.recorded;
  }

  record(event: StatsEvent): void {
    this.recorded.push(event);
  }

  clear(): void {
    this.recorded.length = 0;
  }

  writeSummary(statsDir: string): string {
    mkdirSync(statsDir, { recursive: true });
    const starts = this.recorded.filter((e) => e.type === 'start');
    const ends = this.recorded.filter((e) => e.type === 'end');
    const lastStart = starts[starts.length - 1];
    const lastEnd = ends[ends.length - 1];
    const startedAt = lastStart ? lastStart.t : Date.now();
    const path = join(statsDir, `${this.roomId}-${startedAt}.json`);
    const summary = this.buildSummary();
    const payload = { meta: { roomId: this.roomId, startedAt }, summary, events: this.recorded };
    writeFileSync(path, JSON.stringify(payload, null, 2));
    return path;
  }

  private buildSummary(): StatsSummary {
    const starts = this.recorded.filter((e) => e.type === 'start');
    const ends = this.recorded.filter((e) => e.type === 'end');
    const lastStart = starts[starts.length - 1];
    const lastEnd = ends[ends.length - 1];
    const durationMs = lastStart && lastEnd ? lastEnd.t - lastStart.t : 0;
    const players = (lastStart && lastStart.type === 'start' ? lastStart.players : []).map((p) => {
      const actions = this.recorded.filter((e) => e.type === 'action' && e.playerId === p.id);
      const reactions = this.recorded.filter((e) => e.type === 'reaction' && e.playerId === p.id);
      const reactionsSummary =
        reactions.length > 0
          ? {
              count: reactions.length,
              avgMs: Math.round(reactions.reduce((s, r) => s + r.ms, 0) / reactions.length),
              maxMs: Math.max(...reactions.map((r) => r.ms)),
            }
          : null;
      const snapshots = this.recorded.filter((e) => e.type === 'snapshot');
      const lastSnapshot = snapshots[snapshots.length - 1];
      const endHexCount = lastSnapshot && lastSnapshot.type === 'snapshot' ? lastSnapshot.players.find((s) => s.id === p.id)?.hexCount ?? 0 : 0;
      const endPoints = lastSnapshot && lastSnapshot.type === 'snapshot' ? lastSnapshot.players.find((s) => s.id === p.id)?.points ?? 0 : 0;
      const minutes = durationMs / 60000;
      return {
        id: p.id,
        name: p.name,
        isAi: p.isAi,
        incomeMultiplier: p.incomeMultiplier,
        actions: actions.length,
        captures: actions.filter((a) => a.action === 'capture').length,
        attacks: actions.filter((a) => a.action === 'attack').length,
        defends: actions.filter((a) => a.action === 'defend').length,
        actionsPerMinute: minutes > 0 ? Math.round(actions.length / minutes) : 0,
        reactions: reactionsSummary,
        hexesAtEnd: endHexCount,
        pointsAtEnd: endPoints,
      };
    });
    return { durationMs, battles: this.recorded.filter((e) => e.type === 'battle').length, players };
  }
}
```

Примечание: `hexesAtEnd`/`pointsAtEnd` берутся из последнего снапшота (каждые 10 тиков) — приемлемая точность для анализа.

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run test/stats.test.ts`
Expected: PASS (3 теста).

- [ ] **Step 5: Полный прогон и коммит**

Run: `npx vitest run` → все зелёные.

```bash
git add server/src/stats.ts server/test/stats.test.ts
git commit -m "feat: модуль статистики — сбор событий и JSON-сводка"
```

---

### Task 5: Хуки статистики в комнате

**Files:**
- Modify: `server/src/rooms.ts`
- Test: `server/test/rooms.test.ts`

**Interfaces:**
- Consumes: `GameStatsRecorder`, `config.statsDir` (Task 4/2).
- Produces: `Room.stats: GameStatsRecorder` (public readonly); события start/action/battle/reaction/snapshot/end; `Room.writeStatsIfNeeded(): void` (однократная запись файла); `RoomManager.removeRoom` вызывает `writeStatsIfNeeded`.

- [ ] **Step 1: Написать падающие тесты**

В `server/test/rooms.test.ts` добавить:

```ts
describe('Room: статистика', () => {
  it('start, действия человека и ИИ записываются', () => {
    const room = makeRoom(true, 1, 2);
    room.addHuman('A', 1);
    room.start(1);
    room.handleAction(1, 'capture', { q: 0, r: 0 });
    room.tick();
    const events = room.stats.events;
    expect(events.filter((e) => e.type === 'start')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'action' && e.playerId === 1)).toHaveLength(1);
    expect(events.some((e) => e.type === 'action' && e.playerId === 2)).toBe(true);
  });
  it('реакция на атаку фиксируется для ИИ', () => {
    const room = makeRoom(true, 1, 2);
    room.addHuman('A', 1);
    room.start(1);
    const g = room.gameState!;
    g.hexes[0].ownerId = 2;
    g.players[1].capital = { q: g.hexes[0].q, r: g.hexes[0].r };
    g.hexes[1].ownerId = 1;
    g.players[0].capital = { q: g.hexes[1].q, r: g.hexes[1].r };
    const result = room.handleAction(1, 'attack', { q: g.hexes[0].q, r: g.hexes[0].r, points: 200 });
    expect(result.type).toBe('state');
    room.tick();
    const reactions = room.stats.events.filter((e) => e.type === 'reaction');
    expect(reactions).toHaveLength(1);
    expect((reactions[0] as { playerId: number }).playerId).toBe(2);
  });
  it('снапшот пишется каждые 10 тиков', () => {
    const room = makeRoom(true, 1, 2);
    room.addHuman('A', 1);
    room.start(1);
    for (let i = 0; i < 10; i++) room.tick();
    const snapshots = room.stats.events.filter((e) => e.type === 'snapshot');
    expect(snapshots).toHaveLength(1);
  });
});
```

Примечание: гекс (0,0) и (1,0) смежны (сосед по смещению [1,0]); человек владеет (1,0), атакует гекс ИИ (0,0).

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run test/rooms.test.ts -t "статистика"`
Expected: FAIL — `room.stats` не существует.

- [ ] **Step 3: Реализовать**

В `server/src/rooms.ts`:

1. Импорт: `import { GameStatsRecorder } from './stats.js';`

2. Поля класса (после `lastCapturerId`):

```ts
  readonly stats: GameStatsRecorder;
  private statsWritten = false;
  private tickCounter = 0;
  private startedAt = 0;
  private attackStartedAt = new Map<string, number>();
```

3. В конструкторе (в конце тела):

```ts
    this.stats = new GameStatsRecorder(this.id);
```

4. В `start()` — после `this.addLog('Новая игра началась');`:

```ts
    this.startedAt = Date.now();
    this.statsWritten = false;
    this.tickCounter = 0;
    this.stats.record({
      type: 'start',
      t: this.startedAt,
      mapType: this.mapType,
      players: players.map((p) => ({
        id: p.id,
        name: p.name ?? `Игрок ${p.id}`,
        isAi: p.isAi ?? false,
        incomeMultiplier: p.incomeMultiplier ?? 1,
      })),
    });
```

5. В `restart()` — после `this.lastCapturerId = null;`:

```ts
    this.stats.clear();
    this.startedAt = Date.now();
    this.statsWritten = false;
    this.tickCounter = 0;
    this.stats.record({
      type: 'start',
      t: this.startedAt,
      mapType: this.mapType,
      players: players.map((p) => ({
        id: p.id,
        name: p.name ?? `Игрок ${p.id}`,
        isAi: p.isAi ?? false,
        incomeMultiplier: p.incomeMultiplier ?? 1,
      })),
    });
```

6. В `tick()`:

а) В блоке `if (state.winnerId !== null)` заменить:

```ts
    if (state.winnerId !== null) {
      if (this.finishedAt === null) this.finishedAt = Date.now();
      return;
    }
```

на:

```ts
    if (state.winnerId !== null) {
      if (this.finishedAt === null) {
        this.finishedAt = Date.now();
        this.stats.record({ type: 'end', t: this.finishedAt, winnerId: state.winnerId, durationMs: this.finishedAt - this.startedAt });
        this.writeStatsIfNeeded();
      }
      return;
    }
```

б) После `rules.applyIncome(state);` добавить снапшот:

```ts
    this.tickCounter++;
    if (this.tickCounter % 10 === 0) {
      this.stats.record({
        type: 'snapshot',
        t: Date.now(),
        players: state.players.map((p) => ({ id: p.id, hexCount: rules.hexCount(state, p.id), points: p.points })),
      });
    }
```

в) В цикле логов битв (внутри `for (const result of results)`), в начале цикла добавить:

```ts
      this.stats.record({ type: 'battle', t: Date.now(), q: result.q, r: result.r, winnerId: result.winnerId });
      this.attackStartedAt.delete(`${result.q},${result.r}`);
```

7. В `handleAction` — после успешного применения в case 'attack' (после `rules.applyAttack(...)`):

```ts
        this.stats.record({ type: 'action', t: Date.now(), playerId, action: 'attack', q: msg.q, r: msg.r });
        this.noteAttack(msg.q, msg.r, Date.now());
```

в case 'capture' (после `rules.applyCapture(...)`):

```ts
        this.stats.record({ type: 'action', t: Date.now(), playerId, action: 'capture', q: msg.q, r: msg.r });
```

в case 'defend' (после `rules.applyDefend(...)`):

```ts
        this.stats.record({ type: 'action', t: Date.now(), playerId, action: 'defend', q: msg.q, r: msg.r });
        this.recordReaction(playerId, msg.q, msg.r, Date.now());
```

8. Новые приватные методы (рядом с `applyAiAction`):

```ts
  private noteAttack(q: number, r: number, now: number): void {
    const hex = rules.findHex(this.state!, q, r);
    if (hex && hex.ownerId !== null) this.attackStartedAt.set(`${q},${r}`, now);
  }

  private recordReaction(playerId: number, q: number, r: number, now: number): void {
    const started = this.attackStartedAt.get(`${q},${r}`);
    if (started === undefined) return;
    this.attackStartedAt.delete(`${q},${r}`);
    const ms = now - started;
    if (ms >= 0 && ms < 30000) {
      this.stats.record({ type: 'reaction', t: now, playerId, ms });
    }
  }

  writeStatsIfNeeded(): void {
    if (this.statsWritten) return;
    this.statsWritten = true;
    try {
      this.stats.writeSummary(config.statsDir);
    } catch (err) {
      console.error('stats write failed:', err);
    }
  }
```

9. В `applyAiAction` — после успешного применения каждого действия:

- в case 'capture': `this.stats.record({ type: 'action', t: Date.now(), playerId, action: 'capture', q: action.q, r: action.r }); this.recordReaction(playerId, action.q, action.r, Date.now());`
- в case 'attack': `this.stats.record({ type: 'action', t: Date.now(), playerId, action: 'attack', q: action.q, r: action.r }); this.noteAttack(action.q, action.r, Date.now()); this.recordReaction(playerId, action.q, action.r, Date.now());`
- в case 'defend': `this.stats.record({ type: 'action', t: Date.now(), playerId, action: 'defend', q: action.q, r: action.r }); this.recordReaction(playerId, action.q, action.r, Date.now());`

10. В `RoomManager.removeRoom` (в начале метода):

```ts
    room.writeStatsIfNeeded();
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run test/rooms.test.ts -t "статистика"`
Expected: PASS (3 теста). Затем `npx vitest run` — все зелёные.

- [ ] **Step 5: Коммит**

```bash
git add server/src/rooms.ts server/test/rooms.test.ts
git commit -m "feat: запись статистики игры — события, реакция, снапшоты"
```

---

### Task 6: Web — выбор сложности

**Files:**
- Modify: `web/src/types.ts`, `web/src/api.ts`, `web/src/App.vue`

**Interfaces:**
- Consumes: серверный `start-solo` с `difficulty` (Task 3).
- Produces: `Difficulty` тип в web; `sendStartSolo(mapType, aiCount, difficulty)`; select сложности в соло-меню (по умолчанию средняя).

- [ ] **Step 1: Типы и API**

В `web/src/types.ts`:

1. После `MapType`:

```ts
export type Difficulty = 'easy' | 'medium' | 'hard';
```

2. В `ClientMessage`:

```ts
  | { type: 'start-solo'; mapType: MapType; aiCount: number; difficulty: Difficulty }
```

В `web/src/api.ts`:

```ts
  sendStartSolo(mapType: MapType, aiCount: number, difficulty: Difficulty): void {
    this.send({ type: 'start-solo', mapType, aiCount, difficulty });
  }
```

(импорт `Difficulty` в строке импорта типов; сигнатуру `sendStartSolo` заменить.)

- [ ] **Step 2: App.vue**

1. Импорт: добавить `Difficulty` в импорт типов.

2. После `const aiCount = ref(1);`:

```ts
const aiDifficulty = ref<Difficulty>('medium');
```

3. `startSolo()`:

```ts
function startSolo(): void {
  client.sendStartSolo(aiMapType.value, aiCount.value, aiDifficulty.value);
}
```

4. В шаблоне экрана «Игра с компьютером», после блока «Компьютеров»:

```html
        <div class="menu__row">
          <span class="menu__label">Сложность:</span>
          <select v-model="aiDifficulty" class="menu__select">
            <option value="easy">Лёгкая</option>
            <option value="medium">Средняя</option>
            <option value="hard">Сложная</option>
          </select>
        </div>
```

- [ ] **Step 3: Проверка сборки**

Run: `npm run build` (в `web/`)
Expected: сборка проходит.

- [ ] **Step 4: Коммит**

```bash
git add web/src/types.ts web/src/api.ts web/src/App.vue
git commit -m "feat: web — выбор сложности в соло-меню"
```

---

### Task 7: Финальная проверка

**Files:**
- нет изменений

- [ ] **Step 1: Все тесты сервера**

Run: `npx vitest run` (в `server/`)
Expected: все зелёные (145 + новые ≈ 158).

- [ ] **Step 2: Сборка web**

Run: `npm run build` (в `web/`)
Expected: сборка проходит.

- [ ] **Step 3: Ручная проверка**

Run: dev-серверы (`npm run dev` в server и web), затем:
1. Соло-меню: выбор сложности, дефолт «Средняя».
2. Старт соло на «Лёгкой» — ИИ медленнее растёт по очкам (0.5 дохода).
3. Сыграть партию (или её фрагмент) и проверить, что в `server/stats/` появился JSON-файл.
4. Дефолт армии 20% в ArmyBar.

- [ ] **Step 4: Коммит (если были правки)**

```bash
git add -A
git commit -m "fix: правки по итогам ручной проверки"
```
