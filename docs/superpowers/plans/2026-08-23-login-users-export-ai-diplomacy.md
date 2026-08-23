# Google-вход, таблица users, экспорт игры админом, дипломатия ИИ — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сделать кнопку Google-входа всегда видимой, хранить вошедших в таблице `users`, убрать файловую запись статов, дать админу кнопку «Экспорт» на экране завершения игры (сырые события в админке), увеличить шрифт лога и переработать дипломатию ИИ (война только при плане атаки; ИИ сам предлагает мир/союз).

**Architecture:** Шесть независимых изменений: (1) кнопка Google в `App.vue` рендерится всегда, без client ID — заглушка с сообщением; (2) новая сущность `UserEntity` (таблица `users`) + `UsersRepository` с `upsertBySub` при успешном входе, список в админке; (3) `GameStatsRecorder` теряет файловую запись (`writeSummary`/`statsDir`/`writeStatsIfNeeded` удаляются), `buildSummary()` становится публичным; (4) `RoomDump` расширяется полем `stats: { events, summary }` (события — новые сверху), кнопка «Экспорт» для админа на экране завершения; (5) шрифт лога 12px→14px; (6) чистая функция `chooseDiplomacyAction` в `ai.ts`, в `rooms.ts` — `handleAiDiplomacy` с кулдаунами предложений.

**Tech Stack:** TypeScript, Express, TypeORM (PostgreSQL), Vue 3 (script setup), vitest. Тесты сервера: `cd server && npx vitest run test/<file>.test.ts`. Web-проверка типов: `cd web && npm run build`.

## Global Constraints

- Порядок лога в игре: новые записи в начале массива (`unshift`) — не менять.
- События статов в дампе: поле `stats.events` — **новые сверху** (`[...events].reverse()`).
- `admin_credentials` не переименовывается и не меняется.
- Серверные строки — английские; строки UI — через i18n (en/ru), без хардкода.
- Имена колонок в БД — snake_case (как у существующих сущностей).
- Война ИИ объявляется только при общей границе с целью и достаточных очках.

---

### Task 1: stats.ts — убрать файловую запись, публичный buildSummary

**Files:**
- Modify: `server/src/stats.ts`
- Test: `server/test/stats.test.ts` (переписать)

**Interfaces:**
- Consumes: ничего нового.
- Produces: `GameStatsRecorder` без аргументов конструктора; методы `record(event)`, `clear()`, `get events()`, `buildSummary(): StatsSummary` (публичный). `StatsEvent`, `StatsSummary`, `StatsPlayerSummary` — типы без изменений.

- [ ] **Step 1: Переписать тест под новый API**

Заменить содержимое `server/test/stats.test.ts` на:

```ts
import { describe, expect, it } from 'vitest';
import { GameStatsRecorder } from '../src/stats.js';

describe('GameStatsRecorder', () => {
  it('buildSummary собирает сводку по событиям', () => {
    const rec = new GameStatsRecorder();
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
    const summary = rec.buildSummary();
    expect(summary.durationMs).toBe(4000);
    expect(summary.battles).toBe(1);
    const ai = summary.players.find((p) => p.id === 2)!;
    expect(ai.actions).toBe(1);
    expect(ai.captures).toBe(1);
    expect(ai.actionsPerMinute).toBe(15); // 1 действие за 4 сек
    expect(ai.reactions).toEqual({ count: 1, avgMs: 1200, maxMs: 1200 });
    expect(ai.hexesAtEnd).toBe(5);
    expect(ai.pointsAtEnd).toBe(900);
  });
  it('без end-события сводка не падает', () => {
    const rec = new GameStatsRecorder();
    rec.record({ type: 'start', t: 1000, mapType: 'normal', players: [] });
    rec.record({ type: 'action', t: 2000, playerId: 1, action: 'capture', q: 0, r: 0 });
    const summary = rec.buildSummary();
    expect(summary.durationMs).toBe(0);
    expect(summary.players).toHaveLength(0);
  });
  it('clear очищает события', () => {
    const rec = new GameStatsRecorder();
    rec.record({ type: 'action', t: 1, playerId: 1, action: 'capture', q: 0, r: 0 });
    rec.clear();
    expect(rec.events).toHaveLength(0);
  });
  it('summary включает ИИ из последнего снапшота', () => {
    const rec = new GameStatsRecorder();
    rec.record({ type: 'start', t: 1000, mapType: 'normal', players: [{ id: 1, name: 'A', isAi: false, incomeMultiplier: 1 }] });
    rec.record({ type: 'snapshot', t: 3000, players: [
      { id: 1, hexCount: 3, points: 100 },
      { id: 5, hexCount: 2, points: 50 },
    ] });
    const summary = rec.buildSummary();
    expect(summary.players.map((p) => p.id).sort()).toEqual([1, 5]);
    expect(summary.players.find((p) => p.id === 5)!.isAi).toBe(true);
  });
  it('events возвращает копию', () => {
    const rec = new GameStatsRecorder();
    rec.record({ type: 'action', t: 1, playerId: 1, action: 'capture', q: 0, r: 0 });
    rec.events.length = 0;
    expect(rec.events).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `npx vitest run test/stats.test.ts`
Expected: FAIL — `new GameStatsRecorder()` не работает / нет `buildSummary`.

- [ ] **Step 3: Переписать stats.ts**

В `server/src/stats.ts`:
1. Удалить первую строку импорта: `import { mkdirSync, writeFileSync } from 'node:fs';` и `import { join } from 'node:path';`.
2. Конструктор `constructor(private readonly roomId: number) {}` удалить полностью (поле `roomId` больше не нужно).
3. Метод `writeSummary(statsDir: string): string { ... }` (строки 50–63) удалить.
4. `private buildSummary(): StatsSummary {` → `buildSummary(): StatsSummary {`.

Остальной код класса не меняется. Итог — класс без `roomId`, без `writeSummary`, с публичным `buildSummary`:

```ts
export class GameStatsRecorder {
  private readonly recorded: StatsEvent[] = [];

  get events(): StatsEvent[] {
    return [...this.recorded];
  }

  record(event: StatsEvent): void {
    this.recorded.push(event);
  }

  clear(): void {
    this.recorded.length = 0;
  }

  buildSummary(): StatsSummary {
    const starts = this.recorded.filter((e) => e.type === 'start');
    const ends = this.recorded.filter((e) => e.type === 'end');
    const lastStart = starts[starts.length - 1];
    const lastEnd = ends[ends.length - 1];
    const durationMs = lastStart && lastEnd ? lastEnd.t - lastStart.t : 0;
    const startPlayers = lastStart && lastStart.type === 'start' ? lastStart.players : [];
    const known = new Map(startPlayers.map((p) => [p.id, p]));
    const snapshotsForMerge = this.recorded.filter((e) => e.type === 'snapshot');
    const lastSnapshotForMerge = snapshotsForMerge[snapshotsForMerge.length - 1];
    if (lastSnapshotForMerge && lastSnapshotForMerge.type === 'snapshot') {
      for (const sp of lastSnapshotForMerge.players) {
        if (!known.has(sp.id)) {
          known.set(sp.id, { id: sp.id, name: `Player ${sp.id}`, isAi: true, incomeMultiplier: 1 });
        }
      }
    }
    const players = [...known.values()].map((p) => {
      const actions = this.recorded.filter((e): e is Extract<StatsEvent, { type: 'action' }> => e.type === 'action' && e.playerId === p.id);
      const reactions = this.recorded.filter((e): e is Extract<StatsEvent, { type: 'reaction' }> => e.type === 'reaction' && e.playerId === p.id);
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

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `npx vitest run test/stats.test.ts`
Expected: PASS (5 тестов).

- [ ] **Step 5: Commit**

```bash
git add server/src/stats.ts server/test/stats.test.ts
git commit -m "feat: рекордер статов без файловой записи, публичный buildSummary"
```

---

### Task 2: таблица users — UserEntity и UsersRepository

**Files:**
- Modify: `server/src/db.ts`
- Test: создать `server/test/users-repo.test.ts`

**Interfaces:**
- Consumes: `DataSource` из `typeorm` (как в `db.ts`).
- Produces: `export class UserEntity` (таблица `users`), `export class UsersRepository { upsertBySub(sub, email, name): Promise<void>; list(): Promise<UserEntity[]> }`, `export const usersRepository = new UsersRepository(dataSource)`. Сущность зарегистрирована в `dataSource.entities`.

- [ ] **Step 1: Написать падающий тест**

Создать `server/test/users-repo.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';
import { UserEntity, UsersRepository } from '../src/db.js';

interface FakeUser {
  sub: string;
  email: string;
  name: string;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
}

function makeRepo(): { repo: UsersRepository; rows: FakeUser[]; calls: string[] } {
  const rows: FakeUser[] = [];
  const calls: string[] = [];
  const fakeRepo = {
    findOneBy: async ({ sub }: { sub: string }): Promise<FakeUser | null> => rows.find((r) => r.sub === sub) ?? null,
    save: async (e: FakeUser): Promise<FakeUser> => {
      calls.push(rows.some((r) => r.sub === e.sub) ? 'update' : 'insert');
      const existing = rows.find((r) => r.sub === e.sub);
      if (existing) Object.assign(existing, e);
      else rows.push({ ...e });
      return e;
    },
    find: async (): Promise<FakeUser[]> => [...rows],
  };
  const dataSource = { getRepository: () => fakeRepo } as unknown as DataSource;
  return { repo: new UsersRepository(dataSource), rows, calls };
}

describe('UsersRepository', () => {
  it('upsertBySub: первый вход — insert с first_seen_at', async () => {
    const { repo, rows, calls } = makeRepo();
    await repo.upsertBySub('s1', 'a@x.com', 'A');
    expect(calls).toEqual(['insert']);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sub: 's1', email: 'a@x.com', name: 'A' });
    expect(rows[0].firstSeenAt).toBeInstanceOf(Date);
    expect(rows[0].lastSeenAt).toBeInstanceOf(Date);
  });
  it('upsertBySub: повторный вход — update, first_seen_at сохраняется', async () => {
    const { repo, rows, calls } = makeRepo();
    await repo.upsertBySub('s1', 'a@x.com', 'A');
    const firstSeen = rows[0].firstSeenAt;
    await repo.upsertBySub('s1', 'b@x.com', 'B');
    expect(calls).toEqual(['insert', 'update']);
    expect(rows[0]).toMatchObject({ sub: 's1', email: 'b@x.com', name: 'B' });
    expect(rows[0].firstSeenAt).toBe(firstSeen);
    expect(rows[0].lastSeenAt).toBeInstanceOf(Date);
  });
  it('list возвращает все записи', async () => {
    const { repo } = makeRepo();
    await repo.upsertBySub('s1', 'a@x.com', 'A');
    await repo.upsertBySub('s2', 'b@x.com', 'B');
    expect((await repo.list()).map((u) => u.sub)).toEqual(['s1', 's2']);
  });
});
```

Примечание: `UserEntity` и `UsersRepository` пока не существуют — импорт из `../src/db.js` упадёт.

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `npx vitest run test/users-repo.test.ts`
Expected: FAIL (модуль не экспортирует `UserEntity`/`UsersRepository`).

- [ ] **Step 3: Реализовать сущность и репозиторий в db.ts**

В `server/src/db.ts`, после `FeedbackRepository` (перед `dataSource`), добавить:

```ts
@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn({ name: 'id', type: 'int' })
  id!: number;

  @Column({ name: 'sub', type: 'text', unique: true })
  sub!: string;

  @Column({ name: 'email', type: 'text' })
  email!: string;

  @Column({ name: 'name', type: 'text' })
  name!: string;

  @Column({ name: 'first_seen_at', type: 'timestamptz', default: () => 'now()' })
  firstSeenAt!: Date;

  @Column({ name: 'last_seen_at', type: 'timestamptz', default: () => 'now()' })
  lastSeenAt!: Date;
}

export class UsersRepository {
  constructor(private readonly dataSource: DataSource) {}

  private repo(): Repository<UserEntity> {
    return this.dataSource.getRepository(UserEntity);
  }

  async upsertBySub(sub: string, email: string, name: string): Promise<void> {
    const existing = await this.repo().findOneBy({ sub });
    if (existing) {
      existing.email = email;
      existing.name = name;
      existing.lastSeenAt = new Date();
      await this.repo().save(existing);
    } else {
      await this.repo().save({ sub, email, name });
    }
  }

  async list(): Promise<UserEntity[]> {
    return this.repo().find({ order: { lastSeenAt: 'DESC' } });
  }
}
```

Зарегистрировать: в `entities` dataSource (строка 198) добавить `UserEntity`:

```ts
entities: [PlayerEntity, GameDumpEntity, AdminCredentialsEntity, FeedbackEntity, UserEntity],
```

и добавить экспорт рядом с `feedbackRepository` (строка 205):

```ts
export const usersRepository = new UsersRepository(dataSource);
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `npx vitest run test/users-repo.test.ts`
Expected: PASS (3 теста).

- [ ] **Step 5: Commit**

```bash
git add server/src/db.ts server/test/users-repo.test.ts
git commit -m "feat: таблица users — сущность и репозиторий с upsertBySub"
```

---### Task 3: upsert при Google-входе, админ-эндпоинт /users, блок в админке

**Files:**
- Modify: `server/src/rooms.ts` (handleAuth), `server/src/admin.ts`, `server/src/index.ts`, `server/test/admin-http.test.ts`, `server/public/admin.html`

**Interfaces:**
- Consumes: `usersRepository` (Task 2): `upsertBySub(sub, email, name)`.
- Produces: `registerAdminRoutes(app, manager, dumps, adminCreds, users)` — пятый параметр `users: UsersRepository`; защищённый роут `GET /api/admin/users` → `{ ok: true, users }`.

- [ ] **Step 1: Написать падающий HTTP-тест**

В `server/test/admin-http.test.ts` заменить строку регистрации (строка 23):

```ts
registerAdminRoutes(app, {} as never, {} as never, adminCreds as never);
```

на:

```ts
const usersStub = {
  list: async () => [
    { id: 1, sub: 's1', email: 'a@x.com', name: 'A', firstSeenAt: new Date('2026-08-01'), lastSeenAt: new Date('2026-08-02') },
    { id: 2, sub: 's2', email: 'b@x.com', name: 'B', firstSeenAt: new Date('2026-08-03'), lastSeenAt: new Date('2026-08-04') },
  ],
};
registerAdminRoutes(app, {} as never, {} as never, adminCreds as never, usersStub as never);
```

Добавить тест в `describe('admin HTTP: /api/admin')`:

```ts
it('users отдаёт список вошедших админу', async () => {
  const res = await fetch(`${base}/api/admin/users`, { headers: { cookie } });
  expect(res.status).toBe(200);
  const data = (await res.json()) as { ok: boolean; users: { sub: string; name: string }[] };
  expect(data.ok).toBe(true);
  expect(data.users).toHaveLength(2);
  expect(data.users[0]).toMatchObject({ sub: 's1', name: 'A' });
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `npx vitest run test/admin-http.test.ts`
Expected: FAIL (404 на `/api/admin/users`).

- [ ] **Step 3: Добавить upsert в handleAuth (rooms.ts)**

В `server/src/rooms.ts` заменить импорт:

```ts
import { dumpsRepository } from './db.js';
```

на:

```ts
import { dumpsRepository, usersRepository } from './db.js';
```

В `handleAuth`, после строки `this.roomForConn(connId)?.updateName(connId, profile.name);` и перед `return { ok: true };`, добавить:

```ts
try {
  await usersRepository.upsertBySub(profile.sub, profile.email, profile.name);
} catch (err) {
  console.error('user upsert failed:', err);
}
```

- [ ] **Step 4: Добавить роут /users (admin.ts) и провести параметр**

В `server/src/admin.ts`:
1. Импорт: `import type { AdminCredentialsRepository, DumpsRepository, UsersRepository } from './db.js';`
2. Сигнатура: `registerAdminRoutes(app, manager, dumps, adminCreds, users: UsersRepository)`.
3. В `protectedRouter`, сразу после роута `GET /dumps` (строки 182–189), добавить:

```ts
protectedRouter.get('/users', async (_req, res) => {
  try {
    res.json({ ok: true, users: await users.list() });
  } catch (err) {
    console.error('users list failed:', err);
    res.status(500).json({ ok: false, error: 'Failed to list users' });
  }
});
```

- [ ] **Step 5: Провести usersRepository в index.ts**

В `server/src/index.ts`:
1. Импорт: `import { closeDb, initDb, dumpsRepository, adminCredentialsRepository, usersRepository } from './db.js';`
2. Вызов: `registerAdminRoutes(app, manager, dumpsRepository, adminCredentialsRepository, usersRepository);`

- [ ] **Step 6: Запустить тесты — убедиться, что проходят**

Run: `npx vitest run test/admin-http.test.ts`
Expected: PASS (3 теста, включая новый users).

- [ ] **Step 7: Блок «Пользователи» в админке (admin.html)**

В `server/public/admin.html`:
1. В `renderDashboard()` (внутри `$('#view').innerHTML = ...`) после блока «Дампы» добавить:

```html
<h2>Пользователи</h2>
<div class="card"><table><thead><tr><th>Имя</th><th>Email</th><th>Первый вход</th><th>Последний вход</th></tr></thead><tbody id="users"></tbody></table></div>
```

2. В `renderDashboard()` после `loadDumps();` добавить `loadUsers();`.
3. Добавить функцию (рядом с `loadDumps`):

```js
async function loadUsers() {
  try {
    const r = await api('/api/admin/users');
    const list = r.users || [];
    $('#users').innerHTML = list.map((u) => `
      <tr>
        <td>${esc(u.name)}</td>
        <td>${esc(u.email)}</td>
        <td>${new Date(u.firstSeenAt).toLocaleString()}</td>
        <td>${new Date(u.lastSeenAt).toLocaleString()}</td>
      </tr>`).join('') || '<tr><td colspan="4" class="note">Нет входов</td></tr>';
  } catch (e) { /* 401 обрабатывается в poll */ }
}
```

- [ ] **Step 8: Commit**

```bash
git add server/src/rooms.ts server/src/admin.ts server/src/index.ts server/test/admin-http.test.ts server/public/admin.html
git commit -m "feat: users — upsert при Google-входе и список в админке"
```

---

### Task 4: дамп со статами (новые сверху), удаление файловой записи статов

**Files:**
- Modify: `server/src/config.ts`, `server/src/rooms.ts`, `server/test/rooms.test.ts`

**Interfaces:**
- Consumes: `GameStatsRecorder` без аргументов (Task 1): `events`, `buildSummary()`.
- Produces: `RoomDump.stats: { events: StatsEvent[]; summary: StatsSummary }` (события — новые сверху). `config` без `statsDir`. У `Room` нет методов `writeStatsIfNeeded` и поля `statsWritten`.

- [ ] **Step 1: Написать падающие тесты (rooms.test.ts)**

Дополнить существующий тест `dumpState возвращает полный сырой стейт` (после `expect(dump.log.length).toBeGreaterThan(0);`) строками:

```ts
expect(dump.stats).toBeDefined();
expect(dump.stats.events.map((e) => e.type)).toContain('start');
expect(dump.stats.summary.players).toHaveLength(3);
expect(dump.stats.summary.durationMs).toBe(0);
```

Добавить новый блок в конец файла `server/test/rooms.test.ts`:

```ts
describe('Room: дамп статов и порядок лога', () => {
  it('dumpState: события статов идут новыми сверху', () => {
    const room = makeRoom(true, 1, 2);
    room.addHuman('A', 1);
    room.start(1);
    room.handleAction(1, 'capture', { q: 0, r: 0 });
    room.tick();
    const events = room.dumpState().stats.events;
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0].type).toBe('action'); // самое новое — первое
    expect(events[events.length - 1].type).toBe('start'); // самое старое — последнее
  });
  it('лог: новые записи в начале списка', () => {
    const room = makeRoom();
    room.addHuman('A', 1);
    expect(room.view().log[0].text).toContain('joined the room');
    room.start(1);
    const log = room.view().log;
    expect(log[0].text).toBe('New game started');
    expect(log[1].text).toContain('joined the room');
  });
});
```

Примечание: `makeRoom(true, 1, 2)` — соло с 1 ИИ; после `start` у ИИ 0 клеток, на первом тике ИИ делает первый захват → в событиях будут `start`, `action` (человек), `action` (ИИ). `makeRoom()` — `aiMode=false, aiCount=1, maxPlayers=4`; `start(1)` добавит ИИ-слоты.

- [ ] **Step 2: Запустить тесты — убедиться, что падают**

Run: `npx vitest run test/rooms.test.ts`
Expected: FAIL — `dump.stats` undefined.

- [ ] **Step 3: Убрать statsDir из config.ts**

В `server/src/config.ts` удалить строку:
`statsDir: process.env.CONQUEST_STATS_DIR ?? 'stats',`

- [ ] **Step 4: Убрать файловую запись из rooms.ts**

В `server/src/rooms.ts`:
1. Удалить поле `private statsWritten = false;` (строка 148).
2. В конструкторе заменить `this.stats = new GameStatsRecorder(this.id);` на `this.stats = new GameStatsRecorder();`.
3. В `start()` удалить строку `this.statsWritten = false;` (строка 241).
4. В `restart()` удалить строку `this.statsWritten = false;` (строка 302).
5. В `tick()`, в блоке финиша, удалить вызов `this.writeStatsIfNeeded();` (строка 327).
6. Удалить метод `writeStatsIfNeeded()` целиком (строки 776–785).
7. В `RoomManager.removeRoom` удалить строку `room.writeStatsIfNeeded();` (строка 1095).

- [ ] **Step 5: Добавить stats в RoomDump и dumpState**

В `server/src/rooms.ts`:
1. Импорт: `import { GameStatsRecorder } from './stats.js';` → `import { GameStatsRecorder, type StatsEvent, type StatsSummary } from './stats.js';`
2. В интерфейс `RoomDump` (после `log: LogEntry[];`) добавить:

```ts
stats: { events: StatsEvent[]; summary: StatsSummary };
```

3. В `dumpState()`, после `log: this.log.map((l) => ({ ...l })),`, добавить:

```ts
stats: { events: [...this.stats.events].reverse(), summary: this.stats.buildSummary() },
```

- [ ] **Step 6: Запустить тесты — убедиться, что проходят**

Run: `npx vitest run test/rooms.test.ts`
Expected: PASS (включая новые «дамп статов» и «порядок лога»).

- [ ] **Step 7: Commit**

```bash
git add server/src/config.ts server/src/rooms.ts server/test/rooms.test.ts
git commit -m "feat: дамп со статами (новые сверху), файловая запись статов удалена"
```

---

### Task 5: web — кнопка Google всегда, экспорт на экране завершения, шрифт лога

**Files:**
- Modify: `web/src/App.vue`, `web/src/i18n.ts`

**Interfaces:**
- Consumes: `adminDumpRoom(roomId, note?)` из `web/src/admin.ts` (уже есть), `isAdmin` из `adminMe()` (уже есть), `t()` из i18n.
- Produces: новые i18n-ключи `menu.signInGoogle`, `menu.googleNotConfigured`, `dump.export`. В `App.vue` — блок Google рендерится всегда; кнопка «Экспорт» при `winner && isAdmin`; кнопка дампа из бургер-меню удалена; `.log-panel` font-size 14px.

- [ ] **Step 1: i18n — новые ключи**

В `web/src/i18n.ts` в en-блок (рядом с `'menu.loggedInAs'`) добавить:

```ts
'menu.signInGoogle': 'Sign in with Google',
'menu.googleNotConfigured': 'Google sign-in is not configured',
```

и в en-блоке рядом с `'dump.failed'`:

```ts
'dump.export': 'Export game data',
```

В ru-блок (рядом с `'menu.loggedInAs'`):

```ts
'menu.signInGoogle': 'Войти через Google',
'menu.googleNotConfigured': 'Google-вход не настроен',
```

и рядом с `'dump.failed'`:

```ts
'dump.export': 'Экспорт данных игры',
```

Также удалить ключи `'burger.dumpGame'` и `'burger.dumpNote'` (en и ru) — кнопка из бургер-меню удаляется в Step 3.

- [ ] **Step 2: Кнопка Google всегда видна (App.vue)**

Заменить блок в `<template>` (сейчас строки ~479–482):

```vue
<div v-if="GOOGLE_CLIENT_ID" class="menu__google">
  <div v-if="auth" class="menu__auth">{{ t('menu.loggedInAs', { name: auth.name }) }}</div>
  <div v-else id="google-btn"></div>
</div>
```

на:

```vue
<div class="menu__google">
  <div v-if="auth" class="menu__auth">{{ t('menu.loggedInAs', { name: auth.name }) }}</div>
  <div v-else-if="GOOGLE_CLIENT_ID" id="google-btn"></div>
  <button v-else class="menu__btn menu__btn--ghost" @click="onGoogleNotConfigured">{{ t('menu.signInGoogle') }}</button>
  <div v-if="googleMsg" class="menu__google-err">{{ googleMsg }}</div>
</div>
```

В `<script setup>` добавить состояние и функцию (рядом с `initGoogleButton`):

```ts
const googleMsg = ref<string | null>(null);

function onGoogleNotConfigured(): void {
  googleMsg.value = t('menu.googleNotConfigured');
  window.setTimeout(() => {
    googleMsg.value = null;
  }, 4000);
}
```

В `<style scoped>` добавить (рядом с `.menu__auth`):

```css
.menu__google-err {
  color: #ff6b6b;
  font-size: 13px;
  margin-top: 6px;
}
```

- [ ] **Step 3: Кнопка «Экспорт» на экране завершения (App.vue)**

В `<template>`, сразу после `dumpMsg`-баннера (строка ~601) и до `victory-modal`, добавить:

```vue
<div v-if="winner && isAdmin" class="export-overlay">
  <button class="export-overlay__btn" @click="onExportGame">{{ t('dump.export') }}</button>
</div>
```

В `<script setup>` заменить функцию `onDumpGame` на:

```ts
async function onExportGame(): Promise<void> {
  if (!room.value) return;
  const result = await adminDumpRoom(room.value.id);
  if (result.ok) {
    dumpMsg.value = { kind: 'ok', text: t('dump.saved', { id: result.id }) };
  } else {
    dumpMsg.value = { kind: 'err', text: t('dump.failed', { error: result.error }) };
  }
  window.setTimeout(() => {
    dumpMsg.value = null;
  }, 6000);
}
```

Из бургер-меню удалить строку:

```vue
<button v-if="isAdmin && room" class="burger-menu__item" @click="onDumpGame">{{ t('burger.dumpGame') }}</button>
```

В `<style scoped>` добавить (рядом с `.victory-modal`):

```css
.export-overlay {
  position: fixed;
  top: calc(50% + 64px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 60;
}

.export-overlay__btn {
  padding: 10px 22px;
  border: none;
  border-radius: 8px;
  background: #2196f3;
  color: #fff;
  font-size: 15px;
  cursor: pointer;
}

.export-overlay__btn:hover {
  background: #1976d2;
}
```

- [ ] **Step 4: Шрифт лога 14px (App.vue)**

В `<style scoped>` у `.log-panel` заменить `font-size: 12px;` на `font-size: 14px;`.

- [ ] **Step 5: Проверить сборку web**

Run: `npm run build` (из `web/`)
Expected: сборка без ошибок типов.

- [ ] **Step 6: Commit**

```bash
git add web/src/App.vue web/src/i18n.ts
git commit -m "feat: web — кнопка Google всегда видна, экспорт на экране завершения, шрифт лога 14px"
```

---### Task 6: ai.ts — чистая функция chooseDiplomacyAction

**Files:**
- Modify: `server/src/ai.ts`
- Test: `server/test/ai.test.ts`

**Interfaces:**
- Consumes: `GameState`, `HexState`, `relation`, `hexCount`, `hasAdjacentOwner`, `terrainCost` из `rules.js` (уже импортированы в `ai.ts`).
- Produces: `export type AiDiplomacyAction = { type: 'declare-war'; targetId: number } | { type: 'propose-peace'; targetId: number } | { type: 'propose-alliance'; targetId: number }`; `export interface DiplomacyContext { scout: { hexCount: number; points: number } | null }`; `export function chooseDiplomacyAction(state: GameState, aiId: number, ctx: DiplomacyContext): AiDiplomacyAction | null`.

Логика (по приоритету): (1) война — есть общая граница с целью (соседний гекс цели), цель не сильнее ИИ (hexes; при равенстве — points), `ai.points >= terrainCost` дешёвейшей приграничной клетки цели; (2) мир — при войне с целью и `aiHexes < hexCount(цель)`; (3) союз — не воюет/не в союзе и выгодно: у цели война с третьим, либо цель сильнее ИИ, либо есть третий игрок сильнее обоих.

- [ ] **Step 1: Написать падающие тесты (ai.test.ts)**

Добавить рядом с `makeState` вспомогательную функцию (в `server/test/ai.test.ts`):

```ts
function makeDiploState(hexes: Partial<HexState>[], aiPoints = 1000, playerPoints = 1000, thirdPoints = 1000): GameState {
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
  return {
    players: [{ id: 2, points: aiPoints }, { id: 1, points: playerPoints }, { id: 3, points: thirdPoints }],
    hexes: h,
    columns: MAP_COLUMNS,
    rows: MAP_ROWS,
    winnerId: null,
    diplomacy: new Map(),
  };
}
```

Добавить импорт `chooseDiplomacyAction` (дополнить строку 5): `import { chooseAiAction, chooseDiplomacyAction } from '../src/ai.js';`

Добавить блок тестов в конец файла:

```ts
describe('chooseDiplomacyAction', () => {
  it('объявляет войну соседу, когда планирует атаку (граница + очки + перевес)', () => {
    const s = makeDiploState([
      { q: 7, r: 5, ownerId: AI },
      { q: 6, r: 5, ownerId: P },
    ]);
    expect(chooseDiplomacyAction(s, AI, { scout: { hexCount: 1, points: 100 } })).toEqual({ type: 'declare-war', targetId: P });
  });
  it('не объявляет войну без общей границы', () => {
    const s = makeDiploState([
      { q: 7, r: 5, ownerId: AI },
      { q: 10, r: 10, ownerId: P },
    ], 2000, 100);
    expect(chooseDiplomacyAction(s, AI, { scout: { hexCount: 1, points: 100 } })).toBeNull();
  });
  it('не объявляет войну, если очков не хватает на атаку', () => {
    const s = makeDiploState([
      { q: 7, r: 5, ownerId: AI },
      { q: 6, r: 5, ownerId: P, terrain: 'mountain' },
    ], 100, 100);
    expect(chooseDiplomacyAction(s, AI, { scout: { hexCount: 1, points: 100 } })).toBeNull();
  });
  it('не объявляет войну, если цель сильнее — вместо этого предлагает союз', () => {
    const s = makeDiploState([
      { q: 7, r: 5, ownerId: AI },
      { q: 6, r: 5, ownerId: P },
      { q: 5, r: 5, ownerId: P },
      { q: 5, r: 6, ownerId: P },
    ]);
    const action = chooseDiplomacyAction(s, AI, { scout: { hexCount: 3, points: 1000 } });
    expect(action).not.toEqual({ type: 'declare-war', targetId: P });
    expect(action).toEqual({ type: 'propose-alliance', targetId: P });
  });
  it('предлагает мир, когда проигрывает в войне', () => {
    const s = makeDiploState([
      { q: 7, r: 5, ownerId: AI },
      { q: 6, r: 5, ownerId: P },
      { q: 5, r: 5, ownerId: P },
      { q: 5, r: 6, ownerId: P },
    ]);
    declareWar(s, AI, P);
    expect(chooseDiplomacyAction(s, AI, { scout: { hexCount: 3, points: 1000 } })).toEqual({ type: 'propose-peace', targetId: P });
  });
  it('предлагает союз, когда у цели война с третьим игроком', () => {
    const s = makeDiploState([
      { q: 7, r: 5, ownerId: AI },
      { q: 6, r: 5, ownerId: P },
      { q: 5, r: 5, ownerId: P },
      { q: 5, r: 6, ownerId: P },
      { q: 10, r: 10, ownerId: 3 },
      { q: 11, r: 10, ownerId: 3 },
    ], 1000, 1000, 1000);
    declareWar(s, 3, P);
    expect(chooseDiplomacyAction(s, AI, { scout: { hexCount: 3, points: 1000 } })).toEqual({ type: 'propose-alliance', targetId: P });
  });
  it('не предлагает союз без выгоды', () => {
    const s = makeDiploState([
      { q: 7, r: 5, ownerId: AI },
      { q: 6, r: 5, ownerId: P },
      { q: 10, r: 10, ownerId: 3 },
    ], 500, 1000, 1000);
    expect(chooseDiplomacyAction(s, AI, { scout: { hexCount: 1, points: 1000 } })).toBeNull();
  });
});
```

Примечание: `declareWar` уже импортируется в `ai.test.ts` (строка 4); `AI = 2` и `P = 1` определены в файле (строки 21–22).

- [ ] **Step 2: Запустить тесты — убедиться, что падают**

Run: `npx vitest run test/ai.test.ts`
Expected: FAIL — `chooseDiplomacyAction` не экспортируется.

- [ ] **Step 3: Реализовать chooseDiplomacyAction (ai.ts)**

В `server/src/ai.ts`, после `export type AiAction = ...` (перед `NEIGHBOR_OFFSETS`), добавить:

```ts
export type AiDiplomacyAction =
  | { type: 'declare-war'; targetId: number }
  | { type: 'propose-peace'; targetId: number }
  | { type: 'propose-alliance'; targetId: number };

export interface DiplomacyContext {
  scout: { hexCount: number; points: number } | null;
}
```

В конец файла добавить:

```ts
export function chooseDiplomacyAction(
  state: GameState,
  aiId: number,
  ctx: DiplomacyContext,
): AiDiplomacyAction | null {
  const ai = state.players.find((p) => p.id === aiId);
  if (!ai || ai.eliminated) return null;
  const aiHexes = hexCount(state, aiId);
  const strength = (id: number): { hexes: number; points: number } => {
    const p = state.players.find((x) => x.id === id);
    return { hexes: hexCount(state, id), points: p?.points ?? 0 };
  };

  for (const target of state.players) {
    if (target.id === aiId || target.eliminated) continue;
    if (relation(state, aiId, target.id) !== 'peace') continue;
    let border: HexState | null = null;
    for (const hex of state.hexes) {
      if (hex.ownerId !== target.id) continue;
      if (!hasAdjacentOwner(state, hex.q, hex.r, aiId)) continue;
      if (border === null || terrainCost(hex.terrain) < terrainCost(border.terrain)) border = hex;
    }
    if (!border) continue;
    const targetStr = target.isAi ? strength(target.id) : ctx.scout ?? { hexes: 0, points: 0 };
    const aiStr = strength(aiId);
    const stronger =
      aiStr.hexes > targetStr.hexes || (aiStr.hexes === targetStr.hexes && aiStr.points >= targetStr.points);
    if (stronger && ai.points >= terrainCost(border.terrain)) {
      return { type: 'declare-war', targetId: target.id };
    }
  }

  for (const target of state.players) {
    if (target.id === aiId || target.eliminated) continue;
    if (relation(state, aiId, target.id) !== 'war') continue;
    if (aiHexes < hexCount(state, target.id)) {
      return { type: 'propose-peace', targetId: target.id };
    }
  }

  const thirdStrongest = Math.max(
    0,
    ...state.players.filter((p) => p.id !== aiId && !p.eliminated).map((p) => hexCount(state, p.id)),
  );
  for (const target of state.players) {
    if (target.id === aiId || target.eliminated) continue;
    const rel = relation(state, aiId, target.id);
    if (rel === 'war' || rel === 'alliance') continue;
    const targetStr = target.isAi ? strength(target.id) : ctx.scout ?? { hexes: 0, points: 0 };
    const aiStr = strength(aiId);
    const targetAtWar = state.players.some(
      (p) => p.id !== target.id && p.id !== aiId && relation(state, target.id, p.id) === 'war',
    );
    const beneficial =
      targetAtWar || targetStr.hexes > aiStr.hexes || thirdStrongest > Math.max(aiStr.hexes, targetStr.hexes);
    if (beneficial) {
      return { type: 'propose-alliance', targetId: target.id };
    }
  }

  return null;
}
```

- [ ] **Step 4: Запустить тесты — убедиться, что проходят**

Run: `npx vitest run test/ai.test.ts`
Expected: PASS (старые тесты `chooseAiAction` + новые 7 тестов дипломатии).

- [ ] **Step 5: Commit**

```bash
git add server/src/ai.ts server/test/ai.test.ts
git commit -m "feat: ИИ-дипломатия — чистая функция chooseDiplomacyAction"
```

---

### Task 7: rooms.ts — handleAiDiplomacy, кулдауны предложений, тесты

**Files:**
- Modify: `server/src/rooms.ts`, `server/test/rooms.test.ts`

**Interfaces:**
- Consumes: `chooseDiplomacyAction` из `ai.js` (Task 6).
- Produces: у `Room` нет `maybeDeclareWar`; есть `private handleAiDiplomacy(state: GameState, aiId: number)` и поле `private proposalCooldowns = new Map<string, number>()` (кулдаун 30 с). `restart()` очищает `proposalCooldowns`; `handlePlayerLoss` чистит ключи выбывшего. Дедупликация предложений — по `pendingProposals` (from/to/kind) и кулдауну.

- [ ] **Step 1: Обновить существующие тесты агрессии (rooms.test.ts)**

Заменить тест `'агрессия ИИ: объявляет войну при перевесе сил'` (строки ~591–604) на:

```ts
it('агрессия ИИ: объявляет войну соседу при перевесе сил', () => {
  const room = new Room(1, 'Тест', 'normal', 6, true, 1, () => 0.5);
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
  expect(rules.relation(g, 1, ai.id)).toBe('war');
});
```

Заменить тест `'агрессия ИИ: не объявляет войну, если цель сильнее'` (строки ~605–617) на:

```ts
it('агрессия ИИ: не объявляет войну, если цель сильнее', () => {
  const room = new Room(1, 'Тест', 'normal', 6, true, 1, () => 0.5);
  room.addHuman('A', 1);
  room.start(1);
  const g = room.gameState!;
  const ai = g.players.find((p) => p.isAi)!;
  const find = (q: number, r: number) => g.hexes.find((h) => h.q === q && h.r === r)!;
  find(6, 5).ownerId = 1;
  find(5, 5).ownerId = 1;
  find(5, 6).ownerId = 1;
  g.players[0].capital = { q: 6, r: 5 };
  find(7, 5).ownerId = ai.id;
  g.players[1].capital = { q: 7, r: 5 };
  room.tick();
  expect(rules.relation(g, 1, ai.id)).toBe('peace');
});
```

Заменить тест `'агрессия ИИ: объявляет войну без общей границы при перевесе'` (строки ~618–632) на:

```ts
it('агрессия ИИ: не объявляет войну без общей границы', () => {
  const room = new Room(1, 'Тест', 'normal', 6, true, 1, () => 0.5);
  room.addHuman('A', 1);
  room.start(1);
  const g = room.gameState!;
  const ai = g.players.find((p) => p.isAi)!;
  const find = (q: number, r: number) => g.hexes.find((h) => h.q === q && h.r === r)!;
  find(6, 5).ownerId = 1;
  g.players[0].capital = { q: 6, r: 5 };
  find(10, 10).ownerId = ai.id;
  find(11, 10).ownerId = ai.id;
  find(11, 9).ownerId = ai.id;
  g.players[1].capital = { q: 10, r: 10 };
  room.tick();
  expect(rules.relation(g, 1, ai.id)).toBe('peace');
});
```

Заменить тест `'после принятия мира ИИ не переобъявляет войну в течение кулдауна'` (строки ~633–656) на:

```ts
it('после принятия мира ИИ не переобъявляет войну в течение кулдауна', () => {
  const room = new Room(1, 'Тест', 'normal', 6, true, 1, () => 0.5);
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
  room['scoutCache'] = { hexCount: 1, points: 100, updatedAt: Date.now() };
  room.tick(); // ИИ сильнее (3>1) и прилегает — объявляет войну
  expect(rules.relation(g, 1, ai.id)).toBe('war');
  const aiHex = g.hexes.find((h) => h.ownerId === ai.id)!;
  const result = room.handleAction(1, 'propose', { q: aiHex.q, r: aiHex.r, kind: 'peace' });
  expect(result.type).toBe('state');
  room.tick(); // ИИ принимает мир (atWar) и ставит кулдаун
  expect(rules.relation(g, 1, ai.id)).toBe('peace');
  room.tick(); // в кулдауне — войны нет
  expect(rules.relation(g, 1, ai.id)).toBe('peace');
  room['peaceCooldowns'].set(`${ai.id}-1`, Date.now() - 1000);
  room.tick(); // кулдаун истёк — снова война
  expect(rules.relation(g, 1, ai.id)).toBe('war');
});
```

- [ ] **Step 2: Запустить тесты — убедиться, что падают**

Run: `npx vitest run test/rooms.test.ts`
Expected: FAIL — старая логика объявляет войну без границы/иначе, чем ожидают тесты.

- [ ] **Step 3: Добавить новые тесты дипломатии ИИ (rooms.test.ts)**

В конец `describe('Room: дипломатия', ...)` (перед его закрывающей `});`, после теста про разведку или в конце блока) добавить три теста:

```ts
it('ИИ предлагает мир, когда проигрывает в войне', () => {
  const room = new Room(1, 'Тест', 'normal', 6, true, 1, () => 0.5);
  room.addHuman('A', 1);
  room.start(1);
  const g = room.gameState!;
  const ai = g.players.find((p) => p.isAi)!;
  const find = (q: number, r: number) => g.hexes.find((h) => h.q === q && h.r === r)!;
  find(6, 5).ownerId = 1;
  find(5, 5).ownerId = 1;
  find(5, 6).ownerId = 1;
  g.players[0].capital = { q: 6, r: 5 };
  find(7, 5).ownerId = ai.id;
  g.players[1].capital = { q: 7, r: 5 };
  rules.declareWar(g, 1, ai.id);
  room.tick();
  const proposals = room.view(1).game!.pendingProposals;
  expect(proposals.some((p) => p.from === ai.id && p.to === 1 && p.kind === 'peace')).toBe(true);
});

it('ИИ предлагает союз, когда у цели война с третьим', () => {
  const room = new Room(1, 'Тест', 'normal', 6, true, 2, () => 0.5);
  room.addHuman('A', 1);
  room.start(1);
  const g = room.gameState!;
  const ai = g.players.find((p) => p.isAi)!; // id 2
  const third = g.players.find((p) => p.isAi && p.id !== ai.id)!; // id 3
  const find = (q: number, r: number) => g.hexes.find((h) => h.q === q && h.r === r)!;
  find(6, 5).ownerId = 1;
  find(5, 5).ownerId = 1;
  find(5, 6).ownerId = 1;
  g.players[0].capital = { q: 6, r: 5 };
  find(7, 5).ownerId = ai.id;
  find(8, 5).ownerId = ai.id;
  g.players.find((p) => p.id === ai.id)!.capital = { q: 7, r: 5 };
  find(10, 10).ownerId = third.id;
  find(11, 10).ownerId = third.id;
  g.players.find((p) => p.id === third.id)!.capital = { q: 10, r: 10 };
  rules.declareWar(g, third.id, 1);
  room.tick();
  const proposals = room.view(1).game!.pendingProposals;
  expect(proposals.some((p) => p.from === ai.id && p.to === 1 && p.kind === 'alliance')).toBe(true);
});

it('ИИ не спамит предложения (кулдаун)', () => {
  const room = new Room(1, 'Тест', 'normal', 6, true, 1, () => 0.5);
  room.addHuman('A', 1);
  room.start(1);
  const g = room.gameState!;
  const ai = g.players.find((p) => p.isAi)!;
  const find = (q: number, r: number) => g.hexes.find((h) => h.q === q && h.r === r)!;
  find(6, 5).ownerId = 1;
  find(5, 5).ownerId = 1;
  find(5, 6).ownerId = 1;
  g.players[0].capital = { q: 6, r: 5 };
  find(7, 5).ownerId = ai.id;
  g.players[1].capital = { q: 7, r: 5 };
  rules.declareWar(g, 1, ai.id);
  room.tick();
  room.tick();
  const proposals = room.view(1).game!.pendingProposals.filter((p) => p.from === ai.id && p.to === 1);
  expect(proposals).toHaveLength(1);
});
```

- [ ] **Step 4: Реализовать handleAiDiplomacy (rooms.ts)**

В `server/src/rooms.ts`:
1. Импорт: `import { chooseAiAction, type AiAction } from './ai.js';` → `import { chooseAiAction, chooseDiplomacyAction, type AiAction } from './ai.js';`
2. Добавить поле рядом с `private peaceCooldowns = new Map<string, number>();`:

```ts
private proposalCooldowns = new Map<string, number>();
```

3. В `restart()`, после `this.peaceCooldowns.clear();`, добавить `this.proposalCooldowns.clear();`
4. В `handlePlayerLoss`, после цикла очистки `peaceCooldowns`, добавить:

```ts
for (const [key] of this.proposalCooldowns) {
  if (key.startsWith(`${elim.eliminatedId}-`) || key.includes(`-${elim.eliminatedId}-`)) {
    this.proposalCooldowns.delete(key);
  }
}
```

5. В `tick()` заменить `this.maybeDeclareWar(state, player.id);` на `this.handleAiDiplomacy(state, player.id);`
6. Удалить метод `maybeDeclareWar` целиком и добавить вместо него:

```ts
private handleAiDiplomacy(state: GameState, aiId: number): void {
  const action = chooseDiplomacyAction(state, aiId, { scout: this.scoutCache });
  if (!action) return;
  const aiName = this.playerName(aiId);
  const targetName = this.playerName(action.targetId);
  switch (action.type) {
    case 'declare-war': {
      if (rules.relation(state, aiId, action.targetId) === 'war') return;
      rules.declareWar(state, aiId, action.targetId);
      this.addLog(`${aiName} declared war on ${targetName}`, 'war');
      return;
    }
    case 'propose-peace':
    case 'propose-alliance': {
      const kind = action.type === 'propose-peace' ? 'peace' : 'alliance';
      if (this.pendingProposals.some((p) => p.from === aiId && p.to === action.targetId && p.kind === kind)) return;
      const key = `${aiId}-${action.targetId}-${kind}`;
      const cooldownUntil = this.proposalCooldowns.get(key);
      if (cooldownUntil !== undefined && Date.now() < cooldownUntil) return;
      this.pendingProposals.push({ from: aiId, to: action.targetId, kind });
      this.proposalCooldowns.set(key, Date.now() + 30000);
      this.addLog(`${aiName} proposes ${kind} to ${targetName}`, 'diplomacy');
      return;
    }
  }
}
```

- [ ] **Step 5: Запустить тесты — убедиться, что проходят**

Run: `npx vitest run test/rooms.test.ts`
Expected: PASS (обновлённые + 3 новых теста дипломатии ИИ).

- [ ] **Step 6: Прогнать весь серверный набор**

Run: `npx vitest run` (из `server/`)
Expected: PASS (все файлы тестов).

- [ ] **Step 7: Commit**

```bash
git add server/src/rooms.ts server/test/rooms.test.ts
git commit -m "feat: ИИ объявляет войну только при плане атаки, сам предлагает мир/союз"
```

---

## Self-Review

- **Спека → план:** кнопка Google всегда (Task 5), таблица `users` (Task 2–3), удаление файлов статов (Task 1, 4), экспорт в `game_dumps` с событиями новыми сверху (Task 4), шрифт лога 14px (Task 5), дипломатия ИИ (Task 6–7), порядок лога покрыт тестом (Task 4). Все разделы спеки покрыты.
- **Типы:** `GameStatsRecorder()` без аргументов (Task 1) используется в Task 4; `chooseDiplomacyAction(state, aiId, { scout })` (Task 6) используется в Task 7; `registerAdminRoutes(..., users)` (Task 3) согласован с `index.ts` и `admin-http.test.ts`. `UsersRepository.upsertBySub(sub, email, name)` используется в `handleAuth`.
- **Порядок задач:** Task 1 → 2 → 3 → 4 → 5 (независимы между собой, кроме зависимостей внутри пар) → 6 → 7. Каждая задача самодостаточна и заканчивается зелёными тестами и коммитом.