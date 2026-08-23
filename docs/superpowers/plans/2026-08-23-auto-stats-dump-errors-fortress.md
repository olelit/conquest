# Авто-сохранение статов в БД, длительность ошибок, крепость раньше — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Автоматически сохранять дамп (стейт + статы) завершённых и брошенных игр в `game_dumps` с пометкой «авто»; показывать ошибки действий не менее 3.5 с; сделать крепость доступной с 10 гексов.

**Architecture:** Три независимых изменения. (1) `GameDumpEntity` получает колонку `auto`; `Room.dumpToDb()` (флаг `autoDumped`, fire-and-forget) вызывается из `tick()` при финише и из `RoomManager.removeRoom` для игр со статами; в админке — бейдж «авто». (2) В `App.vue` ошибка очищается таймером 3.5 с, а не каждым броадкастом. (3) Порог крепости `fortressLimit = floor(hexCount/15)` → `/10` в четырёх местах (rules.ts, ContextMenu.vue, training.ts, подсказка i18n).

**Tech Stack:** TypeScript, Express, TypeORM (PostgreSQL), Vue 3 (script setup), vitest. Тесты сервера: `cd server && npx vitest run test/<file>.test.ts`. Web: `cd web && npm run build`.

## Global Constraints

- Авто-дамп — не более одного на партию (флаг `autoDumped`, сброс в `start()`/`restart()`).
- Авто-дамп пишет `auto: true`, `note: null`; ручной экспорт — `auto: false` (по умолчанию) и не трогает флаг.
- Сбой БД при авто-дампе не влияет на игру (try/catch + console.error, fire-and-forget).
- События статов в дампе — новые сверху (уже реализовано в `dumpState()`).
- Строки UI — через i18n (en/ru); серверные строки — английские.
- Порог крепости: `Math.floor(hexCount / 10)`.

---

### Task 1: db.ts — колонка auto в game_dumps

**Files:**
- Modify: `server/src/db.ts`
- Test: создать `server/test/dumps-repo.test.ts`

**Interfaces:**
- Consumes: ничего нового.
- Produces: `GameDumpEntity.auto: boolean` (колонка `auto`, default false); `DumpsRepository.save(dump)` принимает `auto?: boolean` и сохраняет `auto: dump.auto ?? false`; `DumpsRepository.list()` возвращает `auto` в каждой строке.

- [ ] **Step 1: Написать падающий тест**

Создать `server/test/dumps-repo.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';
import { DumpsRepository } from '../src/db.js';

interface FakeDump {
  roomId: number;
  roomName: string;
  mapType: string;
  note: string | null;
  state: unknown;
  auto: boolean;
}

function makeRepo(): { repo: DumpsRepository; rows: FakeDump[] } {
  const rows: FakeDump[] = [];
  const fakeRepo = {
    save: async (e: FakeDump): Promise<FakeDump> => {
      rows.push({ ...e });
      return e;
    },
    find: async (): Promise<FakeDump[]> => [...rows],
  };
  const dataSource = { getRepository: () => fakeRepo } as unknown as DataSource;
  return { repo: new DumpsRepository(dataSource), rows };
}

describe('DumpsRepository', () => {
  it('save: auto по умолчанию false, пробрасывается явный auto', async () => {
    const { repo, rows } = makeRepo();
    await repo.save({ roomId: 1, roomName: 'R', mapType: 'normal', note: null, state: { x: 1 } });
    await repo.save({ roomId: 2, roomName: 'R2', mapType: 'normal', note: null, state: {}, auto: true });
    expect(rows[0].auto).toBe(false);
    expect(rows[1].auto).toBe(true);
  });
  it('list возвращает auto в строках', async () => {
    const { repo, rows } = makeRepo();
    rows.push({ roomId: 1, roomName: 'R', mapType: 'normal', note: null, state: {}, auto: true });
    const list = await repo.list();
    expect(list[0].auto).toBe(true);
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `npx vitest run test/dumps-repo.test.ts`
Expected: FAIL (DumpsRepository не экспортируется из db.js — см. ниже; если экспорт уже есть, упадёт на несовпадении сигнатуры).

Примечание: `DumpsRepository` существует в `db.ts` (класс `DumpsRepository`, строки ~116–144), но `save` не принимает `auto`, а `list` не возвращает `auto` — тест упадёт на ассертах.

- [ ] **Step 3: Реализовать колонку auto и проброс в save/list**

В `server/src/db.ts`:

1. В `GameDumpEntity`, после колонки `note`, добавить:

```ts
@Column({ name: 'auto', type: 'boolean', default: false })
auto!: boolean;
```

2. Сигнатуру `save` (строка ~123) заменить на:

```ts
async save(dump: { roomId: number; roomName: string; mapType: string; note: string | null; state: unknown; auto?: boolean }): Promise<number> {
  const entity = await this.repo().save({
    roomId: dump.roomId,
    roomName: dump.roomName,
    mapType: dump.mapType,
    note: dump.note ?? null,
    auto: dump.auto ?? false,
    state: dump.state,
  });
  return entity.id;
}
```

3. В `list()` (строка ~134) добавить `'auto'` в `select`:

```ts
select: ['id', 'roomId', 'roomName', 'mapType', 'note', 'auto', 'createdAt'],
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `npx vitest run test/dumps-repo.test.ts`
Expected: PASS (2 теста).

- [ ] **Step 5: Commit**

```bash
git add server/src/db.ts server/test/dumps-repo.test.ts
git commit -m "feat: game_dumps — колонка auto, проброс в save/list"
```

---

### Task 2: rooms.ts — авто-дамп при финише и удалении брошенной комнаты

**Files:**
- Modify: `server/src/rooms.ts`, `server/test/rooms.test.ts`
- Test: создать `server/test/rooms-auto-dump.test.ts`

**Interfaces:**
- Consumes: `DumpsRepository.save({ roomId, roomName, mapType, note, auto, state })` (Task 1); `Room.stats.events` (рекордер, `start`-событие пишется при старте).
- Produces: у `Room` — `private autoDumped = false` (сброс в `start()` и `restart()`), `async dumpToDb(): Promise<void>`; в `tick()` при установке `finishedAt` — `void this.dumpToDb();` после записи `end`-события; в `RoomManager.removeRoom` — `void room.dumpToDb();` только при `room.stats.events.length > 0`.

- [ ] **Step 1: Написать падающий тест (новый файл)**

Создать `server/test/rooms-auto-dump.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Room, RoomManager } from '../src/rooms.js';
import { dumpsRepository } from '../src/db.js';

vi.mock('../src/db.js', () => ({
  dumpsRepository: { save: vi.fn(async () => 1), list: vi.fn(async () => []) },
  usersRepository: { upsertBySub: vi.fn(async () => {}), list: vi.fn(async () => []) },
}));

const save = vi.mocked(dumpsRepository.save);

beforeEach(() => {
  save.mockClear();
});

describe('Room: авто-дамп', () => {
  it('завершённая игра сохраняется один раз с auto:true и end-событием сверху', async () => {
    const room = new Room(1, 'Тест', 'normal', 6, true, 1, () => 0.5);
    room.addHuman('A', 1);
    room.start(1);
    room.gameState!.winnerId = 1;
    room.tick();
    room.tick(); // второй тик не должен дублировать дамп
    await vi.waitFor(() => {
      expect(save).toHaveBeenCalledTimes(1);
    });
    const call = save.mock.calls[0][0] as { auto: boolean; note: string | null; state: { stats: { events: { type: string }[] } } };
    expect(call.auto).toBe(true);
    expect(call.note).toBeNull();
    expect(call.state.stats.events[0].type).toBe('end'); // события — новыми сверху
  });

  it('брошенная игра сохраняется при удалении комнаты', async () => {
    const m = new RoomManager();
    m.connectionOpened(1);
    m.createSolo(1, 'normal', 1);
    m.leaveRoom(1); // человек вышел — слот становится ИИ, humanCount 0
    m.tickAll();
    await vi.waitFor(() => {
      expect(save).toHaveBeenCalledTimes(1);
    });
    expect(save.mock.calls[0][0].auto).toBe(true);
  });

  it('рестарт позволяет сохранить следующую партию', async () => {
    const room = new Room(1, 'Тест', 'normal', 6, true, 1, () => 0.5);
    room.addHuman('A', 1);
    room.start(1);
    room.gameState!.winnerId = 1;
    room.tick();
    await vi.waitFor(() => {
      expect(save).toHaveBeenCalledTimes(1);
    });
    room.restart();
    room.gameState!.winnerId = 1;
    room.tick();
    await vi.waitFor(() => {
      expect(save).toHaveBeenCalledTimes(2);
    });
  });

  it('нестартовавшая комната удаляется без дампа', () => {
    const m = new RoomManager();
    m.connectionOpened(1);
    m.createRoom(1, 'normal', 4);
    m.leaveRoom(1);
    expect(m.roomCount).toBe(0);
    expect(save).not.toHaveBeenCalled();
  });
});
```

Примечание: `vi.mock('../src/db.js', ...)` перехватывает модуль и для `rooms.js`, и для теста — `dumpsRepository` в обоих — один и тот же мок. `save` — `vi.fn(async () => 1)`; вызов `dumpToDb` синхронно доходит до `save` (аргументы вычисляются до первого `await`), поэтому ассерты после `tickAll`/`tick` работают, а `vi.waitFor` страхует асинхронные продолжения.

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `npx vitest run test/rooms-auto-dump.test.ts`
Expected: FAIL — `save` не вызывается (нет dumpToDb).

- [ ] **Step 3: Реализовать dumpToDb в Room**

В `server/src/rooms.ts`:

1. Рядом с `readonly stats: GameStatsRecorder;` (строка ~149) добавить:

```ts
private autoDumped = false;
```

2. В `start()` после `this.tickCounter = 0;` (строка ~241) добавить:

```ts
this.autoDumped = false;
```

3. В `restart()` после `this.stats.clear();` (строка ~300) добавить:

```ts
this.autoDumped = false;
```

4. В `tick()`, в блоке `if (state.winnerId !== null)` после `this.stats.record({ type: 'end', ... })` (строка ~326) добавить:

```ts
void this.dumpToDb();
```

5. Новый метод — разместить сразу после `dumpState()` (конец метода, перед `nextSlotId`):

```ts
async dumpToDb(): Promise<void> {
  if (this.autoDumped) return;
  this.autoDumped = true;
  try {
    await dumpsRepository.save({
      roomId: this.id,
      roomName: this.name,
      mapType: this.mapType,
      note: null,
      auto: true,
      state: this.dumpState(),
    });
  } catch (err) {
    console.error('auto dump failed:', err);
  }
}
```

- [ ] **Step 4: Авто-дамп брошенных игр в RoomManager.removeRoom**

В `server/src/rooms.ts`, в `removeRoom` (строка ~1094), до `this.rooms.delete(room.id);` добавить:

```ts
if (room.stats.events.length > 0) {
  void room.dumpToDb();
}
```

- [ ] **Step 5: Обновить rooms.test.ts — мок db и ассерты авто-дампа**

В `server/test/rooms.test.ts`:

1. Импорт: `import { describe, expect, it } from 'vitest';` → `import { beforeEach, describe, expect, it, vi } from 'vitest';`
2. В начало файла (после импортов) добавить:

```ts
vi.mock('../src/db.js', () => ({
  dumpsRepository: { save: vi.fn(async () => 1), list: vi.fn(async () => []) },
  usersRepository: { upsertBySub: vi.fn(async () => {}), list: vi.fn(async () => []) },
}));

import { dumpsRepository } from '../src/db.js';

beforeEach(() => {
  vi.mocked(dumpsRepository.save).mockClear();
});
```

3. В тест «все люди вышли из игры — комната удаляется» (строка ~322), после `expect(m.roomCount).toBe(0);`, добавить:

```ts
expect(vi.mocked(dumpsRepository.save)).toHaveBeenCalledTimes(1);
```

4. В тест «завершённая игра удаляется после grace-периода (grace 0)» (строка ~333), после `expect(m.roomForConn(2)).toBeNull();`, добавить:

```ts
expect(vi.mocked(dumpsRepository.save)).toHaveBeenCalledTimes(1);
```

5. В тест «завершённая игра живёт внутри grace-периода» (строка ~344), после `expect(m.roomCount).toBe(1);`, добавить:

```ts
expect(vi.mocked(dumpsRepository.save)).toHaveBeenCalledTimes(1);
```

Примечание: без мока эти три теста после Task 2 ловили бы реальный `dumpsRepository.save` → падение на отсутствии БД (поймано try/catch, но шум в выводе). Мок делает их тихими и добавляет покрытие авто-дампа. `beforeEach`-clear изолирует счётчики между тестами.

- [ ] **Step 6: Запустить тесты — убедиться, что проходят**

Run: `npx vitest run test/rooms-auto-dump.test.ts test/rooms.test.ts`
Expected: PASS (4 новых + 77 существующих; без шума в выводе).

- [ ] **Step 7: Полный набор + tsc**

Run: `npx vitest run` (из `server/`) и `npx tsc --noEmit`
Expected: все тесты зелёные (известный флейк `feedback-http.test.ts` afterAll-hook — игнорировать), tsc чистый.

- [ ] **Step 8: Commit**

```bash
git add server/src/rooms.ts server/test/rooms.test.ts server/test/rooms-auto-dump.test.ts
git commit -m "feat: авто-дамп завершённых и брошенных игр в game_dumps"
```

---

### Task 3: админка — бейдж «авто» в списке дампов

**Files:**
- Modify: `server/public/admin.html`

**Interfaces:**
- Consumes: `GET /api/admin/dumps` теперь возвращает `auto` в каждой строке (Task 1).
- Produces: в таблице дампов у авто-сохранённых — бейдж «авто».

- [ ] **Step 1: Добавить бейдж**

В `server/public/admin.html`, в `loadDumps()`, в строке таблицы (после `<td>${esc(d.mapType)}</td>`) заменить:

```js
<td>${d.note ? esc(d.note) : '—'}</td>
```

на:

```js
<td>${d.auto ? '<span class="badge">авто</span> ' : ''}${d.note ? esc(d.note) : '—'}</td>
```

- [ ] **Step 2: Проверить изменение**

Run: `grep -n "авто" server/public/admin.html`
Expected: бейдж присутствует в `loadDumps` (админка — статичный HTML, сборки нет).

- [ ] **Step 3: Commit**

```bash
git add server/public/admin.html
git commit -m "feat: админка — бейдж «авто» у авто-дампов"
```

---

### Task 4: web — ошибки действий видны 3.5 секунды

**Files:**
- Modify: `web/src/App.vue`

**Interfaces:**
- Consumes: `client.onError`, `client.onState` (уже есть).
- Produces: ошибки очищаются таймером 3.5 с (сброс при новой ошибке), а не каждым броадкастом.

- [ ] **Step 1: Убрать очистку ошибки из onState**

В `web/src/App.vue`, в `client.onState = (...) => { ... }` удалить строку `error.value = null;`.

- [ ] **Step 2: Добавить таймер в onError**

В `<script setup>`, рядом с `const error = ref<string | null>(null);` добавить:

```ts
let errorTimer: number | undefined;
```

Заменить `client.onError`:

```ts
client.onError = (message) => {
  error.value = message;
  window.clearTimeout(errorTimer);
  errorTimer = window.setTimeout(() => {
    error.value = null;
  }, 3500);
};
```

- [ ] **Step 3: Проверить сборку**

Run: `npm run build` (из `web/`)
Expected: сборка чистая (vue-tsc + vite).

- [ ] **Step 4: Commit**

```bash
git add web/src/App.vue
git commit -m "feat: web — ошибки действий видны 3.5 с"
```

---

### Task 5: крепость доступна с 10 гексов

**Files:**
- Modify: `server/src/rules.ts`, `server/test/rules.test.ts`, `web/src/components/ContextMenu.vue`, `web/src/training.ts`, `web/src/i18n.ts`

**Interfaces:**
- Consumes: ничего нового.
- Produces: `fortressLimit = Math.floor(hexCount / 10)`; клиентские дубли (ContextMenu.vue:33, training.ts:72) и подсказка i18n обновлены; тест закрепляет новый порог.

- [ ] **Step 1: Обновить тест лимита (TDD red)**

В `server/test/rules.test.ts` (строка ~889) заменить:

```ts
expect(fortressLimit(15)).toBe(1);
```

на:

```ts
expect(fortressLimit(10)).toBe(1);
expect(fortressLimit(9)).toBe(0);
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `npx vitest run test/rules.test.ts`
Expected: FAIL — `fortressLimit(10)` возвращает 0 (сейчас `/15`).

- [ ] **Step 3: Изменить порог в rules.ts**

В `server/src/rules.ts` (строка ~96):

```ts
export function fortressLimit(hexCount: number): number {
  return Math.floor(hexCount / 15);
}
```

→

```ts
export function fortressLimit(hexCount: number): number {
  return Math.floor(hexCount / 10);
}
```

- [ ] **Step 4: Обновить клиентские дубли и подсказку**

1. `web/src/components/ContextMenu.vue` (строка ~33): `Math.floor(props.hexCount / 15)` → `Math.floor(props.hexCount / 10)`.
2. `web/src/training.ts` (строка ~72): `if (Math.floor(hexCount / 15) <= fortressCount) return false;` → `if (Math.floor(hexCount / 10) <= fortressCount) return false;`
3. `web/src/i18n.ts`: en `'cm.fortressHint'`: `'Need 15+ hexes and limit headroom'` → `'Need 10+ hexes and limit headroom'`; ru: `'нужно 15+ клеток и запас лимита'` → `'нужно 10+ клеток и запас лимита'`.

- [ ] **Step 5: Проверить серверные тесты и сборку web**

Run: `npx vitest run test/rules.test.ts test/rooms.test.ts test/ai.test.ts` (из `server/`) и `npm run build` (из `web/`)
Expected: все зелёные (существующие тесты крепости используют 15 гексов — лимит при `/10` всё ещё 1), сборка чистая.

- [ ] **Step 6: Commit**

```bash
git add server/src/rules.ts server/test/rules.test.ts web/src/components/ContextMenu.vue web/src/training.ts web/src/i18n.ts
git commit -m "feat: крепость доступна с 10 гексов"
```

---

## Self-Review

- **Спека → план:** авто-дамп (Task 1–3: колонка, dumpToDb, триггеры финиша/удаления, админка), длительность ошибок (Task 4), крепость (Task 5). Покрытие полное.
- **Типы:** `DumpsRepository.save({..., auto?: boolean})` (Task 1) используется в `dumpToDb` (Task 2) и `RoomManager.dumpRoom` (без auto — существующий код не меняется); `list()` с `auto` — в админке (Task 3). `autoDumped` сброс в `start()`/`restart()` согласован с тестом рестарта.
- **Существующие тесты:** три теста rooms.test.ts с `tickAll` требуют мока db (Task 2 Step 5), иначе — шум от `console.error` реального save.
- **Порядок:** Task 1 → 2 → 3 (зависимы), Task 4 и 5 независимы; каждая задача заканчивается зелёными тестами и коммитом.