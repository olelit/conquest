# Форма фидбека с админ-просмотром и лимитом по IP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать игрокам форму фидбека на главном меню, просмотр отзывов во вкладке «Отзывы» админки и защиту от спама — лимит 3 отправки в минуту на IP (настраиваемый).

**Architecture:** `POST /api/feedback` (публичный) → таблица `feedback` в Postgres. Админ-роуты (`GET`/`read`/`delete`) добавляются в защищённый роутер `admin.ts`. Rate limit — in-memory `SlidingWindowLimiter` (скользящее окно 60с) с инъекцией часов для тестов. На клиенте — модалка на главном меню; в `admin.html` — вкладка «Отзывы».

**Tech Stack:** Node.js 22, Express, TypeORM (Postgres), Vue 3, vanilla JS в `admin.html`, vitest.

## Global Constraints

- Никаких новых npm-зависимостей.
- Rate limit по умолчанию 3/мин на IP, настраивается `CONQUEST_FEEDBACK_RATE_LIMIT`.
- Окно лимита — ровно 60 000 мс (60000).
- Максимальная длина текста отзыва — ровно 2000 символов (FEEDBACK_MAX_LENGTH = 2000).
- IP берётся так: `x-forwarded-for` (первое значение) → `x-real-ip` → `socket.remoteAddress` → 'unknown'.
- Ответы публичного эндпоинта: 400 `{ ok:false, error:'empty'|'too-long' }`, 429 `{ ok:false, error:'rate-limit' }`, 500 `{ ok:false, error:'server' }`, 200 `{ ok:true }`.
- Админ-роуты: список `{ ok:true, feedback:[...] }`; read/delete → `{ ok:true }` или 404 `{ ok:false, error:'Feedback not found' }`; невалидный id → 400 `{ ok:false, error:'Invalid id' }`.
- Тесты HTTP — по паттерну `server/test/admin-http.test.ts` (тестовый express-сервер + стаб-репозитории, без реальной БД).
- Репозиторий и сущность БД unit-тестами не покрываются (паттерн `DumpsRepository`); проверка — `npm run build` + интеграция в ручном/HTTP-тесте.

---

### Task 1: Rate limiter (скользящее окно)

**Files:**
- Create: `server/src/rate-limit.ts`
- Test: `server/test/rate-limit.test.ts`

**Interfaces:**
- Produces:
  - `export class SlidingWindowLimiter`
    - `constructor(windowMs: number, now?: () => number)` — `now` для инъекции часов в тестах (по умолчанию `Date.now`);
    - `try(ip: string, limit: number): boolean` — true если в окне ≤ limit попаданий (и запись учитывается), иначе false;
    - `sweep(): void` — удаляет пустые записи IP;
    - `size(): number` — число IP в карте.

- [ ] **Step 1: Написать падающий тест**

`server/test/rate-limit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SlidingWindowLimiter } from '../src/rate-limit.js';

describe('SlidingWindowLimiter', () => {
  it('пропускает до лимита попаданий в окне, дальше отклоняет', () => {
    let t = 1000;
    const limiter = new SlidingWindowLimiter(60000, () => t);
    expect(limiter.try('1.2.3.4', 3)).toBe(true);
    expect(limiter.try('1.2.3.4', 3)).toBe(true);
    expect(limiter.try('1.2.3.4', 3)).toBe(true);
    expect(limiter.try('1.2.3.4', 3)).toBe(false);
    expect(limiter.try('1.2.3.4', 3)).toBe(false);
  });

  it('после окончания окна лимит сбрасывается', () => {
    let t = 1000;
    const limiter = new SlidingWindowLimiter(60000, () => t);
    limiter.try('1.2.3.4', 3);
    limiter.try('1.2.3.4', 3);
    limiter.try('1.2.3.4', 3);
    expect(limiter.try('1.2.3.4', 3)).toBe(false);
    t = 1000 + 60001;
    expect(limiter.try('1.2.3.4', 3)).toBe(true);
  });

  it('разные IP не мешают друг другу', () => {
    const limiter = new SlidingWindowLimiter(60000);
    expect(limiter.try('a', 3)).toBe(true);
    expect(limiter.try('b', 3)).toBe(true);
    expect(limiter.try('a', 3)).toBe(true);
    expect(limiter.try('a', 3)).toBe(false);
    expect(limiter.try('b', 3)).toBe(true);
  });

  it('sweep удаляет пустые записи', () => {
    let t = 1000;
    const limiter = new SlidingWindowLimiter(60000, () => t);
    limiter.try('1.2.3.4', 3);
    expect(limiter.size()).toBe(1);
    t = 1000 + 60001;
    limiter.sweep();
    expect(limiter.size()).toBe(0);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test -- test/rate-limit.test.ts`
Expected: FAIL — модуль `../src/rate-limit.js` не найден.

- [ ] **Step 3: Реализовать `server/src/rate-limit.ts`**

```ts
export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  try(ip: string, limit: number): boolean {
    const cutoff = this.now() - this.windowMs;
    const arr = (this.hits.get(ip) ?? []).filter((t) => t > cutoff);
    if (arr.length >= limit) {
      this.hits.set(ip, arr);
      return false;
    }
    arr.push(this.now());
    this.hits.set(ip, arr);
    return true;
  }

  sweep(): void {
    const cutoff = this.now() - this.windowMs;
    for (const [ip, arr] of this.hits) {
      const kept = arr.filter((t) => t > cutoff);
      if (kept.length === 0) this.hits.delete(ip);
      else this.hits.set(ip, kept);
    }
  }

  size(): number {
    return this.hits.size;
  }
}
```

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `npm test -- test/rate-limit.test.ts`
Expected: PASS (4 теста).

- [ ] **Step 5: Коммит**

```bash
git add server/src/rate-limit.ts server/test/rate-limit.test.ts
git commit -m "feat: rate limiter со скользящим окном"
```

---

### Task 2: Feedback entity + repository + конфиг

**Files:**
- Modify: `server/src/db.ts`
- Modify: `server/src/config.ts`

**Interfaces:**
- Consumes: `config` из `server/src/config.ts` (уже импортирован в db.ts).
- Produces:
  - `export class FeedbackEntity` (таблица `feedback`: `id`, `text`, `ip`, `read`, `created_at`);
  - `export class FeedbackRepository` с методами:
    - `async create(text: string, ip: string): Promise<number>`
    - `async list(): Promise<FeedbackEntity[]>`
    - `async markRead(id: number): Promise<boolean>`
    - `async remove(id: number): Promise<boolean>`
  - `export const feedbackRepository = new FeedbackRepository(dataSource)`
  - `config.feedbackRateLimit: number` (env `CONQUEST_FEEDBACK_RATE_LIMIT`, default 3).

- [ ] **Step 1: Добавить сущность и репозиторий в `server/src/db.ts`**

После блока `DumpsRepository` (после строки 144) добавить:

```ts
@Entity('feedback')
export class FeedbackEntity {
  @PrimaryGeneratedColumn({ name: 'id', type: 'int' })
  id!: number;

  @Column({ name: 'text', type: 'text' })
  text!: string;

  @Column({ name: 'ip', type: 'text' })
  ip!: string;

  @Column({ name: 'read', type: 'boolean', default: false })
  read!: boolean;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;
}

export class FeedbackRepository {
  constructor(private readonly dataSource: DataSource) {}

  private repo(): Repository<FeedbackEntity> {
    return this.dataSource.getRepository(FeedbackEntity);
  }

  async create(text: string, ip: string): Promise<number> {
    const entity = await this.repo().save({ text, ip, read: false });
    return entity.id;
  }

  async list(): Promise<FeedbackEntity[]> {
    return this.repo().find({ order: { id: 'DESC' } });
  }

  async markRead(id: number): Promise<boolean> {
    const result = await this.repo().update({ id }, { read: true });
    return (result.affected ?? 0) > 0;
  }

  async remove(id: number): Promise<boolean> {
    const result = await this.repo().delete({ id });
    return (result.affected ?? 0) > 0;
  }
}
```

- [ ] **Step 2: Зарегистрировать сущность и синглтон**

В `dataSource` (строка 153) список сущностей:

```ts
entities: [PlayerEntity, GameDumpEntity, AdminCredentialsEntity, FeedbackEntity],
```

После строки 159 (`export const adminCredentialsRepository = ...`) добавить:

```ts
export const feedbackRepository = new FeedbackRepository(dataSource);
```

- [ ] **Step 3: Добавить конфиг в `server/src/config.ts`**

В конец объекта `config` (после строки 40) добавить:

```ts
  feedbackRateLimit: number('CONQUEST_FEEDBACK_RATE_LIMIT', 3),
```

- [ ] **Step 4: Проверить сборку**

Run: `npm run build`
Expected: tsc без ошибок.

- [ ] **Step 5: Коммит**

```bash
git add server/src/db.ts server/src/config.ts
git commit -m "feat: feedback-сущность, репозиторий и лимит в конфиге"
```

---

### Task 3: Публичный роут `POST /api/feedback`

**Files:**
- Create: `server/src/feedback.ts`
- Test: `server/test/feedback-http.test.ts` (создать; в Task 4 будут добавлены админ-тесты в этот же файл)

**Interfaces:**
- Consumes: `FeedbackRepository` (тип) из `server/src/db.js` (Task 2), `SlidingWindowLimiter` из `server/src/rate-limit.js` (Task 1).
- Produces:
  - `export const FEEDBACK_MAX_LENGTH = 2000`
  - `export function extractIp(req: Request): string`
  - `export function registerFeedbackRoutes(app: express.Express, repo: FeedbackRepository, limiter: SlidingWindowLimiter, rateLimit: number): void`

- [ ] **Step 1: Написать падающий HTTP-тест (публичная часть)**

`server/test/feedback-http.test.ts`:

```ts
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerFeedbackRoutes } from '../src/feedback.js';
import { SlidingWindowLimiter } from '../src/rate-limit.js';
import type { FeedbackEntity } from '../src/db.js';

interface FeedbackRow {
  id: number;
  text: string;
  ip: string;
  read: boolean;
  createdAt: Date;
}

function makeFeedbackStub() {
  const rows: FeedbackRow[] = [];
  let nextId = 1;
  return {
    rows,
    async create(text: string, ip: string): Promise<number> {
      rows.push({ id: nextId, text, ip, read: false, createdAt: new Date() });
      return nextId++;
    },
    async list(): Promise<FeedbackRow[]> {
      return [...rows].reverse();
    },
    async markRead(id: number): Promise<boolean> {
      const row = rows.find((r) => r.id === id);
      if (!row) return false;
      row.read = true;
      return true;
    },
    async remove(id: number): Promise<boolean> {
      const idx = rows.findIndex((r) => r.id === id);
      if (idx === -1) return false;
      rows.splice(idx, 1);
      return true;
    },
  };
}

let server: ReturnType<typeof createServer>;
let base = '';
const stub = makeFeedbackStub();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerFeedbackRoutes(app, stub as never, new SlidingWindowLimiter(60000), 3);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve)));

async function post(text: unknown, ip = '127.0.0.1'): Promise<Response> {
  return fetch(`${base}/api/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ text }),
  });
}

describe('feedback: POST /api/feedback', () => {
  it('сохраняет отзыв и возвращает ok', async () => {
    stub.rows.length = 0;
    const res = await post('Отличная игра!');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(stub.rows).toHaveLength(1);
    expect(stub.rows[0].text).toBe('Отличная игра!');
    expect(stub.rows[0].ip).toBe('127.0.0.1');
  });

  it('пустой текст → 400 empty', async () => {
    const res = await post('   ');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'empty' });
  });

  it('не-строка → 400 empty', async () => {
    const res = await post(42);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'empty' });
  });

  it('длинный текст → 400 too-long', async () => {
    const res = await post('x'.repeat(2001));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'too-long' });
  });

  it('лимит 3/мин → 429 rate-limit', async () => {
    stub.rows.length = 0;
    const ip = '9.9.9.9';
    expect((await post('1', ip)).status).toBe(200);
    expect((await post('2', ip)).status).toBe(200);
    expect((await post('3', ip)).status).toBe(200);
    const fourth = await post('4', ip);
    expect(fourth.status).toBe(429);
    expect(await fourth.json()).toEqual({ ok: false, error: 'rate-limit' });
    expect(stub.rows).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test -- test/feedback-http.test.ts`
Expected: FAIL — модуль `../src/feedback.js` не найден.

- [ ] **Step 3: Реализовать `server/src/feedback.ts`**

```ts
import express from 'express';
import type { Request } from 'express';
import type { FeedbackRepository } from './db.js';
import type { SlidingWindowLimiter } from './rate-limit.js';

export const FEEDBACK_MAX_LENGTH = 2000;

export function extractIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim() !== '') return fwd.split(',')[0].trim();
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real.trim() !== '') return real.trim();
  return req.socket.remoteAddress ?? 'unknown';
}

export function registerFeedbackRoutes(
  app: express.Express,
  repo: FeedbackRepository,
  limiter: SlidingWindowLimiter,
  rateLimit: number,
): void {
  app.post('/api/feedback', async (req, res) => {
    const raw = (req.body ?? {}) as { text?: unknown };
    if (typeof raw.text !== 'string') {
      res.status(400).json({ ok: false, error: 'empty' });
      return;
    }
    const text = raw.text.trim();
    if (text === '') {
      res.status(400).json({ ok: false, error: 'empty' });
      return;
    }
    if (text.length > FEEDBACK_MAX_LENGTH) {
      res.status(400).json({ ok: false, error: 'too-long' });
      return;
    }
    const ip = extractIp(req);
    if (!limiter.try(ip, rateLimit)) {
      res.status(429).json({ ok: false, error: 'rate-limit' });
      return;
    }
    try {
      await repo.create(text, ip);
      res.json({ ok: true });
    } catch (err) {
      console.error('feedback save failed:', err);
      res.status(500).json({ ok: false, error: 'server' });
    }
  });
}
```

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `npm test -- test/feedback-http.test.ts`
Expected: PASS (5 тестов).

- [ ] **Step 5: Коммит**

```bash
git add server/src/feedback.ts server/test/feedback-http.test.ts
git commit -m "feat: публичный POST /api/feedback с валидацией и лимитом по IP"
```

---

### Task 4: Админ-роуты фидбека + проводка в index.ts

**Files:**
- Modify: `server/src/admin.ts` (сигнатура `registerAdminRoutes` + 3 защищённых роута)
- Modify: `server/src/index.ts` (регистрация feedback-роутов + лимитер + sweep + новый аргумент)
- Modify: `server/test/feedback-http.test.ts` (добавить админ-тесты)
- Modify: `server/test/admin-http.test.ts` (обновить вызов `registerAdminRoutes` — теперь 5 аргументов)

**Interfaces:**
- Consumes: `FeedbackRepository` (тип) из `server/src/db.js` (Task 2), `registerFeedbackRoutes`/`extractIp` из `server/src/feedback.js` (Task 3), `SlidingWindowLimiter` из `server/src/rate-limit.js` (Task 1), `config.feedbackRateLimit` (Task 2).
- Produces:
  - `registerAdminRoutes(app, manager, dumps, adminCreds, feedback: FeedbackRepository)` — 5 аргументов;
  - админ-роуты: `GET /api/admin/feedback`, `POST /api/admin/feedback/:id/read`, `DELETE /api/admin/feedback/:id`;
  - `feedbackLimiter: SlidingWindowLimiter` (экземпляр, окно 60000) в `index.ts` + `setInterval(() => feedbackLimiter.sweep(), 60000)`.

- [ ] **Step 1: Добавить тип в импорт `admin.ts`**

Строка импорта `./db.js` в `server/src/admin.ts` (сейчас `import type { AdminCredentialsRepository, DumpsRepository } from './db.js';`) — добавить `FeedbackRepository`:

```ts
import type { AdminCredentialsRepository, DumpsRepository, FeedbackRepository } from './db.js';
```

- [ ] **Step 2: Расширить сигнатуру `registerAdminRoutes`**

Заменить сигнатуру (5-й параметр):

```ts
export function registerAdminRoutes(
  app: express.Express,
  manager: RoomManager,
  dumps: DumpsRepository,
  adminCreds: AdminCredentialsRepository,
  feedback: FeedbackRepository,
): void {
```

- [ ] **Step 3: Добавить защищённые роуты фидбека**

Внутри `registerAdminRoutes`, перед строкой `app.use('/api/admin', publicRouter);` (после роута `/credentials`) добавить:

```ts
  protectedRouter.get('/feedback', async (_req, res) => {
    try {
      res.json({ ok: true, feedback: await feedback.list() });
    } catch (err) {
      console.error('feedback list failed:', err);
      res.status(500).json({ ok: false, error: 'Failed to list feedback' });
    }
  });

  protectedRouter.post('/feedback/:id/read', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ ok: false, error: 'Invalid id' });
      return;
    }
    try {
      if (!(await feedback.markRead(id))) {
        res.status(404).json({ ok: false, error: 'Feedback not found' });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      console.error('feedback markRead failed:', err);
      res.status(500).json({ ok: false, error: 'Failed to update feedback' });
    }
  });

  protectedRouter.delete('/feedback/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ ok: false, error: 'Invalid id' });
      return;
    }
    try {
      if (!(await feedback.remove(id))) {
        res.status(404).json({ ok: false, error: 'Feedback not found' });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      console.error('feedback delete failed:', err);
      res.status(500).json({ ok: false, error: 'Failed to delete feedback' });
    }
  });
```

- [ ] **Step 4: Обновить `server/test/admin-http.test.ts`**

Вызов `registerAdminRoutes(app, {} as never, {} as never, adminCreds as never)` — добавить 5-й аргумент-стаб:

```ts
  registerAdminRoutes(app, {} as never, {} as never, adminCreds as never, {} as never);
```

- [ ] **Step 5: Добавить админ-тесты в `server/test/feedback-http.test.ts`**

В шапку добавить импорт `registerAdminRoutes`:

```ts
import { registerAdminRoutes } from '../src/admin.js';
```

В `beforeAll` дополнить регистрацию (добавить админ-роуты на тот же `app` и логин для cookie):

```ts
  const adminCreds = {
    get: async () => ({ id: 1, username: 'admin', passwordHash: await (await import('../src/password.js')).hashPassword('admin'), sessionSecret: 's' }),
    updateCredentials: async () => {},
  };
  registerAdminRoutes(app, {} as never, {} as never, adminCreds as never, stub as never);
```

В конец файла добавить describe:

```ts
describe('feedback: админ-роуты', () => {
  let cookie = '';

  beforeAll(async () => {
    const res = await fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin' }),
    });
    expect(res.status).toBe(200);
    cookie = res.headers.get('set-cookie')!.split(';')[0];
  });

  it('GET /api/admin/feedback возвращает список', async () => {
    stub.rows.length = 0;
    await post('Первый', '1.1.1.1');
    await post('Второй', '2.2.2.2');
    const res = await fetch(`${base}/api/admin/feedback`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; feedback: FeedbackRow[] };
    expect(body.ok).toBe(true);
    expect(body.feedback.map((f) => f.text)).toEqual(['Второй', 'Первый']);
  });

  it('POST /:id/read помечает прочитанным, 404 для неизвестного id', async () => {
    stub.rows.length = 0;
    const id = await stub.create('x', '1.1.1.1');
    const res = await fetch(`${base}/api/admin/feedback/${id}/read`, { method: 'POST', headers: { cookie } });
    expect(res.status).toBe(200);
    expect(stub.rows[0].read).toBe(true);
    const missing = await fetch(`${base}/api/admin/feedback/9999/read`, { method: 'POST', headers: { cookie } });
    expect(missing.status).toBe(404);
  });

  it('DELETE /:id удаляет, 404 для неизвестного id', async () => {
    stub.rows.length = 0;
    const id = await stub.create('y', '1.1.1.1');
    const res = await fetch(`${base}/api/admin/feedback/${id}`, { method: 'DELETE', headers: { cookie } });
    expect(res.status).toBe(200);
    expect(stub.rows).toHaveLength(0);
    const missing = await fetch(`${base}/api/admin/feedback/9999`, { method: 'DELETE', headers: { cookie } });
    expect(missing.status).toBe(404);
  });

  it('неавторизованный запрос → 401', async () => {
    const res = await fetch(`${base}/api/admin/feedback`);
    expect(res.status).toBe(401);
  });
});
```

Примечание: `post()` уже определён в файле — переиспользуйте его. Если порядок define/`describe` мешает, разместите новый describe после существующего.

- [ ] **Step 6: Проводка в `server/src/index.ts`**

Импорты (строка 3 и новые):

```ts
import { closeDb, initDb, dumpsRepository, adminCredentialsRepository, feedbackRepository } from './db.js';
import { registerFeedbackRoutes } from './feedback.js';
import { SlidingWindowLimiter } from './rate-limit.js';
```

В `main()`, после `const manager = new RoomManager();`:

```ts
  const feedbackLimiter = new SlidingWindowLimiter(60000);
  registerFeedbackRoutes(app, feedbackRepository, feedbackLimiter, config.feedbackRateLimit);
  registerAdminRoutes(app, manager, dumpsRepository, adminCredentialsRepository, feedbackRepository);
```

Рядом с существующим `setInterval` (строка 57) добавить sweep:

```ts
  setInterval(() => feedbackLimiter.sweep(), 60000);
```

- [ ] **Step 7: Полный прогон тестов и сборка**

Run: `npm test`
Expected: PASS (все файлы).
Run: `npm run build`
Expected: tsc без ошибок.

- [ ] **Step 8: Коммит**

```bash
git add server/src/admin.ts server/src/index.ts server/test/feedback-http.test.ts server/test/admin-http.test.ts
git commit -m "feat: админ-роуты фидбека и проводка в index.ts"
```

---

### Task 5: Форма фидбека на клиенте (Vue)

**Files:**
- Modify: `web/src/App.vue`
- Modify: `web/src/i18n.ts`

**Interfaces:**
- Consumes: `POST /api/feedback` (Task 3), i18n-функция `t` (уже есть в App.vue).
- Produces: кнопка «Фидбек» на главном меню + модалка отправки.

- [ ] **Step 1: Добавить i18n-ключи**

В `web/src/i18n.ts` в блок `en` (после `'dump.failed': 'Dump failed: {error}',` на строке 108) добавить:

```ts
    'menu.feedback': 'Feedback',
    'feedback.title': 'Feedback',
    'feedback.placeholder': 'Write your feedback…',
    'feedback.send': 'Send',
    'feedback.cancel': 'Cancel',
    'feedback.sent': 'Thank you! Your feedback has been sent.',
    'feedback.error': 'Could not send. Please try again.',
    'feedback.rateLimited': 'Too many attempts. Please wait a minute.',
    'feedback.tooLong': 'Feedback is too long (max 2000 characters).',
```

В блок `ru` (после `'dump.failed': 'Не удалось сохранить: {error}',`) добавить:

```ts
    'menu.feedback': 'Отзыв',
    'feedback.title': 'Обратная связь',
    'feedback.placeholder': 'Напишите отзыв…',
    'feedback.send': 'Отправить',
    'feedback.cancel': 'Отмена',
    'feedback.sent': 'Спасибо! Ваш отзыв отправлен.',
    'feedback.error': 'Не удалось отправить. Попробуйте ещё раз.',
    'feedback.rateLimited': 'Слишком много попыток. Подождите минуту.',
    'feedback.tooLong': 'Отзыв слишком длинный (макс. 2000 символов).',
```

(Найдите точную строку `'dump.failed'` в ru-блоке — она есть; добавьте ключи после неё.)

- [ ] **Step 2: Добавить состояние и функцию отправки в `web/src/App.vue`**

В `<script setup>` рядом с `const burgerOpen = ref(false);` (строка 36) добавить:

```ts
const feedbackOpen = ref(false);
const feedbackText = ref('');
const feedbackStatus = ref<'' | 'sent' | 'error' | 'rateLimited' | 'tooLong'>('');
```

Рядом с другими обработчиками (например, после `closeContextMenu`) добавить:

```ts
function openFeedback(): void {
  feedbackText.value = '';
  feedbackStatus.value = '';
  feedbackOpen.value = true;
}

function closeFeedback(): void {
  feedbackOpen.value = false;
  feedbackStatus.value = '';
}

async function sendFeedback(): Promise<void> {
  const text = feedbackText.value.trim();
  if (text === '') {
    feedbackStatus.value = 'error';
    return;
  }
  feedbackStatus.value = '';
  try {
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (res.status === 429) {
      feedbackStatus.value = 'rateLimited';
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (res.ok && data.ok) {
      feedbackText.value = '';
      feedbackStatus.value = 'sent';
      return;
    }
    feedbackStatus.value = data.error === 'too-long' ? 'tooLong' : 'error';
  } catch {
    feedbackStatus.value = 'error';
  }
}
```

- [ ] **Step 3: Добавить кнопку и модалку в шаблон**

В главном меню после кнопки лоад-теста (строка 478, `@click="goToLoadTest"`) добавить:

```html
        <button class="menu__btn" @click="openFeedback">{{ t('menu.feedback') }}</button>
```

В конец `<template>` (после блока `burger-menu`, строка ~662) добавить модалку:

```html
    <div v-if="feedbackOpen" class="feedback-overlay" @click.self="closeFeedback">
      <div class="feedback-modal">
        <h2 class="feedback-modal__title">{{ t('feedback.title') }}</h2>
        <textarea
          v-model="feedbackText"
          class="feedback-modal__input"
          :placeholder="t('feedback.placeholder')"
          maxlength="2000"
          rows="4"
        ></textarea>
        <p v-if="feedbackStatus === 'sent'" class="feedback-modal__msg feedback-modal__msg--ok">{{ t('feedback.sent') }}</p>
        <p v-else-if="feedbackStatus === 'rateLimited'" class="feedback-modal__msg feedback-modal__msg--err">{{ t('feedback.rateLimited') }}</p>
        <p v-else-if="feedbackStatus === 'tooLong'" class="feedback-modal__msg feedback-modal__msg--err">{{ t('feedback.tooLong') }}</p>
        <p v-else-if="feedbackStatus === 'error'" class="feedback-modal__msg feedback-modal__msg--err">{{ t('feedback.error') }}</p>
        <div class="feedback-modal__row">
          <button class="feedback-modal__btn" :disabled="feedbackStatus === 'sent'" @click="sendFeedback">{{ t('feedback.send') }}</button>
          <button class="feedback-modal__btn feedback-modal__btn--ghost" @click="closeFeedback">{{ t('feedback.cancel') }}</button>
        </div>
      </div>
    </div>
```

- [ ] **Step 4: Добавить стили модалки в `web/src/App.vue`**

В блок `<style scoped>` добавить (например, после `.burger-overlay`):

```css
.feedback-overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
}
.feedback-modal {
  width: min(420px, 90vw);
  background: #1e1e24;
  border: 1px solid #444;
  border-radius: 10px;
  padding: 18px;
}
.feedback-modal__title {
  margin: 0 0 12px;
  font-size: 18px;
}
.feedback-modal__input {
  width: 100%;
  box-sizing: border-box;
  background: #14141a;
  color: #fff;
  border: 1px solid #555;
  border-radius: 6px;
  padding: 8px;
  font: inherit;
  resize: vertical;
}
.feedback-modal__msg {
  font-size: 13px;
  margin: 8px 0 0;
}
.feedback-modal__msg--ok {
  color: #69db7c;
}
.feedback-modal__msg--err {
  color: #ff6b6b;
}
.feedback-modal__row {
  display: flex;
  gap: 10px;
  margin-top: 12px;
}
.feedback-modal__btn {
  background: #2196f3;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 8px 14px;
  cursor: pointer;
  font-size: 13px;
}
.feedback-modal__btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.feedback-modal__btn--ghost {
  background: #2a2a31;
  border: 1px solid #555;
}
```

- [ ] **Step 5: Собрать клиент и проверить типы**

Run: `npm run build` (в `web/`) — vue-tsc + vite build без ошибок.

- [ ] **Step 6: Коммит**

```bash
git add web/src/App.vue web/src/i18n.ts
git commit -m "feat: форма фидбека на главном меню"
```

---

### Task 6: Вкладка «Отзывы» в админке

**Files:**
- Modify: `server/public/admin.html`

**Interfaces:**
- Consumes: `GET /api/admin/feedback`, `POST /api/admin/feedback/:id/read`, `DELETE /api/admin/feedback/:id` (Task 4).
- Produces: вкладка «Отзывы» с таблицей и действиями.

- [ ] **Step 1: Добавить кнопку вкладки**

В панель вкладок (после `data-tab="account"`, строка 42) добавить:

```html
    <button class="tab" data-tab="feedback">Отзывы</button>
```

- [ ] **Step 2: Обновить `switchTab`**

Найти `switchTab` и заменить ветку рендера:

```js
function switchTab(tab) {
  currentTab = tab;
  stopPoll();
  showTabs();
  if (tab === 'account') renderAccount();
  else if (tab === 'feedback') renderFeedback();
  else renderDashboard();
}
```

- [ ] **Step 3: Добавить `renderFeedback`, `loadFeedback` и действия**

После функции `renderAccount` добавить:

```js
async function renderFeedback() {
  $('#view').innerHTML = `
    <div class="row" style="justify-content:space-between">
      <h2>Отзывы</h2>
      <button class="ghost" id="fb-refresh">Обновить</button>
    </div>
    <div class="card"><table>
      <thead><tr><th>#</th><th>Когда</th><th>IP</th><th>Текст</th><th></th><th></th></tr></thead>
      <tbody id="fb-rows"></tbody>
    </table></div>
    <div id="fb-msg" class="note"></div>`;
  $('#fb-refresh').onclick = () => loadFeedback();
  await loadFeedback();
}

async function loadFeedback() {
  const tbody = $('#fb-rows');
  const msg = $('#fb-msg');
  if (!tbody) return;
  msg.className = 'note';
  msg.textContent = 'Загрузка…';
  try {
    const r = await api('/api/admin/feedback');
    const list = (r && Array.isArray(r.feedback) ? r.feedback : []);
    msg.textContent = '';
    tbody.innerHTML = list.map((f) => `
      <tr class="${f.read ? '' : 'fb-unread'}">
        <td>#${f.id}</td>
        <td>${new Date(f.createdAt).toLocaleString()}</td>
        <td>${esc(f.ip)}</td>
        <td>${esc(f.text)}</td>
        <td>${f.read ? '<span class="note">прочитано</span>' : ''}</td>
        <td style="white-space:nowrap">
          ${f.read ? '' : `<button class="ghost" data-read="${f.id}">Прочитано</button>`}
          <button class="ghost" data-del="${f.id}">Удалить</button>
        </td>
      </tr>`).join('') || '<tr><td colspan="6" class="note">Отзывов нет</td></tr>';
    tbody.querySelectorAll('[data-read]').forEach((btn) => {
      btn.onclick = async () => {
        await api('/api/admin/feedback/' + btn.dataset.read + '/read', { method: 'POST' });
        await loadFeedback();
      };
    });
    tbody.querySelectorAll('[data-del]').forEach((btn) => {
      btn.onclick = async () => {
        await api('/api/admin/feedback/' + btn.dataset.del, { method: 'DELETE' });
        await loadFeedback();
      };
    });
  } catch (e) {
    if (e.message === 'UNAUTHORIZED') { boot(); return; }
    msg.className = 'err';
    msg.textContent = 'Ошибка загрузки';
  }
}
```

- [ ] **Step 4: Добавить CSS для непрочитанных**

В блок `<style>` добавить:

```css
  .fb-unread { font-weight: 600; }
```

- [ ] **Step 5: Проверка и коммит**

Статическая проверка: убедиться, что `renderFeedback` определена один раз и вызывается из `switchTab`; `api()` и `esc()` уже определены в файле. Серверная часть уже покрыта HTTP-тестами (Task 4).

Run (в корне репо): `git add server/public/admin.html && git commit -m "feat: админка — вкладка «Отзывы»"`

---

## Self-Review

**Spec coverage:**
- Форма на главном меню → Task 5.
- `POST /api/feedback` + валидация (empty/too-long) + 429 → Task 3.
- Rate limit 3/мин по IP (настраиваемый), окно 60000 → Task 1 + Task 2 (config) + Task 3.
- Таблица `feedback` + репозиторий → Task 2.
- Админ: список + прочитано + удаление → Task 4 + Task 6.
- Определение IP (x-forwarded-for → x-real-ip → remoteAddress) → Task 3 (`extractIp`).
- i18n en/ru → Task 5.
- Тесты: rate-limit (Task 1), HTTP публичный (Task 3), HTTP админ (Task 4).

**Placeholder scan:** везде конкретный код; нет TBD/TODO; точные пути и команды.

**Type consistency:**
- `SlidingWindowLimiter(windowMs, now?)` — Task 1 определяет, Task 3/4 используют `new SlidingWindowLimiter(60000)`.
- `registerFeedbackRoutes(app, repo, limiter, rateLimit)` — Task 3 определяет, Task 4 вызывает.
- `FeedbackRepository.create/list/markRead/remove` — Task 2 определяет, Task 3/4 используют.
- `registerAdminRoutes(app, manager, dumps, adminCreds, feedback)` — Task 4 меняет сигнатуру, `admin-http.test.ts` обновляется там же.
- `config.feedbackRateLimit` — Task 2 определяет, Task 4 использует.
- HTTP-стаб `makeFeedbackStub()` используется и в Task 3 (публичный), и в Task 4 (админ) — сигнатуры совпадают.
