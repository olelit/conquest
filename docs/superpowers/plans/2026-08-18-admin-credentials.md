# Смена логина/пароля админки — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать админу возможность менять логин и пароль прямо из админ-панели (отдельная вкладка «Аккаунт»), с хранением кредов в PostgreSQL и автоматическим сидом из env при первом запуске.

**Architecture:** Креды переезжают из env в таблицу `admin_credentials` (одна строка). При старте сидер создаёт запись из оригинальных env-кредов, если её нет. Сессионные токены подписываются `session_secret` из БД; при смене кредов секрет ротируется и все старые сессии умирают. Пароль хранится как scrypt-хэш с солью. В `admin.html` добавляются вкладки «Обзор»/«Аккаунт».

**Tech Stack:** Node.js 22, Express, TypeORM (PostgreSQL), scrypt (node:crypto), vanilla JS в `server/public/admin.html`, vitest.

## Global Constraints

- Никаких новых npm-зависимостей (scrypt есть в node:crypto).
- Пароли в БД — только scrypt-хэш с солью (не открытый текст, не HMAC).
- Единственная строка в `admin_credentials` имеет `id = 1`.
- Сидер не перезаписывает существующую запись в БД.
- После смены кредов `session_secret` всегда ротируется (инвалидация всех сессий).
- Env `CONQUEST_ADMIN_USER` / `CONQUEST_ADMIN_PASSWORD` остаются источником первичного сида.
- Env `CONQUEST_ADMIN_SECRET` удаляется (больше не используется для авторизации).
- Все тесты — unit (без реальной БД/HTTP), по существующему паттерну `test/admin.test.ts`.
- Технологии сервера: `tsx`, `vitest run`, сборка `npm run build` (tsc).

---

### Task 1: Хэширование паролей (scrypt)

**Files:**
- Create: `server/src/password.ts`
- Test: `server/test/password.test.ts`

**Interfaces:**
- Produces:
  - `export async function hashPassword(password: string): Promise<string>` — возвращает `"<salt-hex>:<hash-hex>"`.
  - `export async function verifyPassword(password: string, stored: string): Promise<boolean>` — принимает строку из `hashPassword`.

- [ ] **Step 1: Написать падающий тест**

`server/test/password.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/password.js';

describe('password: scrypt-хэш', () => {
  it('круговая проверка: верный пароль проходит, неверный нет', async () => {
    const hash = await hashPassword('secret');
    expect(hash).not.toBe('secret');
    expect(await verifyPassword('secret', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('разные соли дают разные хэши для одного пароля', async () => {
    expect(await hashPassword('a')).not.toBe(await hashPassword('a'));
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test -- test/password.test.ts`
Expected: FAIL — модуль `../src/password.js` не найден.

- [ ] **Step 3: Реализовать `server/src/password.ts`**

```ts
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (password: string, salt: string, keylen: number) => Promise<Buffer>;

const KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, KEYLEN);
  return `${salt}:${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = stored.split(':');
  if (!salt || !hashHex) return false;
  const hash = await scrypt(password, salt, KEYLEN);
  const expected = Buffer.from(hashHex, 'hex');
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}
```

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `npm test -- test/password.test.ts`
Expected: PASS (2 теста).

- [ ] **Step 5: Коммит**

```bash
git add server/src/password.ts server/test/password.test.ts
git commit -m "feat: scrypt-хэширование паролей для админки"
```

---

### Task 2: Сидер кредов админа в БД

**Files:**
- Modify: `server/src/db.ts`
- Test: `server/test/admin.test.ts` (не меняется в этой задаче)

**Interfaces:**
- Consumes: `hashPassword` из `server/src/password.ts`, `config.adminUser` / `config.adminPassword` из `server/src/config.ts`.
- Produces:
  - `export class AdminCredentialsRepository` с методами:
    - `async get(): Promise<AdminCredentialsEntity | null>`
    - `async ensureSeeded(username: string, password: string): Promise<void>`
    - `async updateCredentials(username: string, passwordHash: string): Promise<void>`
  - `export class AdminCredentialsEntity` (колонки: `id`, `username`, `passwordHash`, `sessionSecret`).
  - `export const adminCredentialsRepository = new AdminCredentialsRepository(dataSource)`.

- [ ] **Step 1: Добавить импорты в `server/src/db.ts`**

Строка 1 (после `import 'reflect-metadata';`), плюс в начало файла:

```ts
import { randomBytes } from 'node:crypto';
```

Импорт `config` и `hashPassword` (добавить к существующим импортам):

```ts
import { config } from './config.js';
import { hashPassword } from './password.js';
```

- [ ] **Step 2: Добавить сущность и репозиторий в `server/src/db.ts`**

Добавить после блока `GameDumpEntity` (после строки 66):

```ts
@Entity('admin_credentials')
export class AdminCredentialsEntity {
  @PrimaryColumn({ name: 'id', type: 'int' })
  id!: number;

  @Column({ name: 'username', type: 'text' })
  username!: string;

  @Column({ name: 'password_hash', type: 'text' })
  passwordHash!: string;

  @Column({ name: 'session_secret', type: 'text' })
  sessionSecret!: string;
}

export class AdminCredentialsRepository {
  constructor(private readonly dataSource: DataSource) {}

  private repo(): Repository<AdminCredentialsEntity> {
    return this.dataSource.getRepository(AdminCredentialsEntity);
  }

  async get(): Promise<AdminCredentialsEntity | null> {
    return this.repo().findOneBy({ id: 1 });
  }

  async ensureSeeded(username: string, password: string): Promise<void> {
    const existing = await this.repo().findOneBy({ id: 1 });
    if (existing) return;
    await this.repo().save({
      id: 1,
      username,
      passwordHash: await hashPassword(password),
      sessionSecret: randomBytes(32).toString('base64url'),
    });
  }

  async updateCredentials(username: string, passwordHash: string): Promise<void> {
    await this.repo().update(
      { id: 1 },
      { username, passwordHash, sessionSecret: randomBytes(32).toString('base64url') },
    );
  }
}
```

- [ ] **Step 3: Зарегистрировать сущность в DataSource и сидер в `initDb`**

В `dataSource` (строка 105) список сущностей:

```ts
entities: [PlayerEntity, GameDumpEntity, AdminCredentialsEntity],
```

После `export const dumpsRepository = ...` (строка 110) добавить:

```ts
export const adminCredentialsRepository = new AdminCredentialsRepository(dataSource);
```

В `initDb()` (строки 112-115) — после `playersRepository.migrate()`:

```ts
export async function initDb(): Promise<void> {
  await dataSource.initialize();
  await playersRepository.migrate();
  await adminCredentialsRepository.ensureSeeded(config.adminUser, config.adminPassword);
}
```

- [ ] **Step 4: Проверить сборку**

Run: `npm run build`
Expected: tsc завершается без ошибок.

Замечание: репозиторий использует TypeORM и покрывается интеграционно (ручная проверка через запуск сервера в Task 6). Unit-тестов на БД нет — по паттерну существующего `dumpsRepository`.

- [ ] **Step 5: Коммит**

```bash
git add server/src/db.ts
git commit -m "feat: сидер кредов админа в БД (admin_credentials)"
```

---

### Task 3: `authAdmin` и сессии на БД, `setAdminCookie(username)`

**Files:**
- Rewrite: `server/src/admin.ts`
- Test: `server/test/admin.test.ts` (обновить секцию про `authAdmin`)

**Interfaces:**
- Consumes: `verifyPassword` из `server/src/password.ts`, `AdminCredentialsRepository` из `server/src/db.ts`.
- Produces:
  - `export async function authAdmin(username: string, password: string, stored: { username: string; passwordHash: string }): Promise<boolean>`
  - `export function setAdminCookie(res: Response, username: string, secret: string): void`
  - `export function clearAdminCookie(res: Response): void`
  - `export function signToken(payload: { u: string; exp: number }, secret: string): string` (без изменений)
  - `export function verifyToken(token: string, secret: string): { u: string } | null` (без изменений)
  - `export async function planCredentialChange(stored: { username: string; passwordHash: string }, input: CredentialChangeInput): Promise<CredentialChange>`
  - `export function registerAdminRoutes(app: express.Express, manager: RoomManager, dumps: DumpsRepository, adminCreds: AdminCredentialsRepository): void`

- [ ] **Step 1: Обновить падающий тест `authAdmin`**

Заменить блок `authAdmin` (строки 24-27) в `server/test/admin.test.ts`:

```ts
  it('authAdmin сверяет логин и scrypt-хэш пароля', async () => {
    const stored = { username: 'admin', passwordHash: await hashPassword('admin'), sessionSecret: 'x' };
    expect(await authAdmin('admin', 'admin', stored)).toBe(true);
    expect(await authAdmin('admin', 'wrong', stored)).toBe(false);
    expect(await authAdmin('root', 'admin', stored)).toBe(false);
  });
```

Добавить импорт в `server/test/admin.test.ts` (строка 2):

```ts
import { hashPassword } from '../src/password.js';
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test -- test/admin.test.ts`
Expected: FAIL — `authAdmin` не принимает 3 аргумента / не возвращает Promise.

- [ ] **Step 3: Переписать `server/src/admin.ts` целиком**

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { hashPassword, verifyPassword } from './password.js';
import type { RoomManager } from './rooms.js';
import type { AdminCredentialsRepository, DumpsRepository } from './db.js';

export const ADMIN_COOKIE = 'conquest_admin';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function b64url(data: Buffer | string): string {
  return Buffer.from(data).toString('base64url');
}

export function signToken(payload: { u: string; exp: number }, secret: string): string {
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(token: string, secret: string): { u: string } | null {
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload: { u?: string; exp?: number };
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload.u !== 'string' || typeof payload.exp !== 'number') return null;
  if (payload.exp < Date.now()) return null;
  return { u: payload.u };
}

export async function authAdmin(
  username: string,
  password: string,
  stored: { username: string; passwordHash: string },
): Promise<boolean> {
  if (username !== stored.username) return false;
  return verifyPassword(password, stored.passwordHash);
}

export function setAdminCookie(res: Response, username: string, secret: string): void {
  const token = signToken({ u: username, exp: Date.now() + SESSION_TTL_MS }, secret);
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`);
}

export function clearAdminCookie(res: Response): void {
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function sessionFrom(req: Request, secret: string): { u: string } | null {
  const cookie = req.headers.cookie ?? '';
  const match = cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${ADMIN_COOKIE}=`));
  if (!match) return null;
  const token = match.slice(ADMIN_COOKIE.length + 1);
  return verifyToken(token, secret);
}

export interface CredentialChangeInput {
  currentPassword?: string;
  newLogin?: string;
  newPassword?: string;
}

export type CredentialChange =
  | { ok: true; username: string; passwordHash: string }
  | { ok: false; status: 400 | 401 | 409; error: string };

export async function planCredentialChange(
  stored: { username: string; passwordHash: string },
  input: CredentialChangeInput,
): Promise<CredentialChange> {
  const current = input.currentPassword ?? '';
  if (!(await verifyPassword(current, stored.passwordHash))) {
    return { ok: false, status: 401, error: 'Current password is incorrect' };
  }
  const newLogin = typeof input.newLogin === 'string' ? input.newLogin.trim() : undefined;
  const newPassword = input.newPassword;
  if ((newLogin === undefined || newLogin === '') && (newPassword === undefined || newPassword === '')) {
    return { ok: false, status: 400, error: 'Nothing to change' };
  }
  if (newLogin !== undefined && newLogin === '') {
    return { ok: false, status: 400, error: 'New login cannot be empty' };
  }
  if (newPassword !== undefined && newPassword === '') {
    return { ok: false, status: 400, error: 'New password cannot be empty' };
  }
  if (newLogin !== undefined && newLogin === stored.username) {
    return { ok: false, status: 409, error: 'New login is the same as current' };
  }
  if (newPassword !== undefined && (await verifyPassword(newPassword, stored.passwordHash))) {
    return { ok: false, status: 400, error: 'New password is the same as current' };
  }
  return {
    ok: true,
    username: newLogin ?? stored.username,
    passwordHash: newPassword !== undefined ? await hashPassword(newPassword) : stored.passwordHash,
  };
}

export function registerAdminRoutes(
  app: express.Express,
  manager: RoomManager,
  dumps: DumpsRepository,
  adminCreds: AdminCredentialsRepository,
): void {
  app.get('/admin', (_req, res) => {
    res.sendFile(join(import.meta.dirname, '..', 'public', 'admin.html'));
  });

  const publicRouter = express.Router();

  publicRouter.post('/login', async (req, res) => {
    const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
    let stored;
    try {
      stored = await adminCreds.get();
    } catch (err) {
      console.error('admin login failed:', err);
      res.status(503).json({ ok: false, error: 'Admin service unavailable' });
      return;
    }
    if (!stored || !(await authAdmin(String(username ?? ''), String(password ?? ''), stored))) {
      res.status(401).json({ ok: false, error: 'Invalid credentials' });
      return;
    }
    setAdminCookie(res, stored.username, stored.sessionSecret);
    res.json({ ok: true, username: stored.username });
  });

  publicRouter.post('/logout', (_req, res) => {
    clearAdminCookie(res);
    res.json({ ok: true });
  });

  publicRouter.get('/me', async (req, res) => {
    let stored;
    try {
      stored = await adminCreds.get();
    } catch {
      res.json({ authenticated: false });
      return;
    }
    const session = stored ? sessionFrom(req, stored.sessionSecret) : null;
    if (!session) {
      res.json({ authenticated: false });
      return;
    }
    res.json({ authenticated: true, username: session.u });
  });

  const protectedRouter = express.Router();
  protectedRouter.use(async (req: Request, res: Response, next: NextFunction) => {
    try {
      const stored = await adminCreds.get();
      if (stored && sessionFrom(req, stored.sessionSecret)) {
        next();
      } else {
        res.status(401).json({ ok: false, error: 'Admin access required' });
      }
    } catch {
      res.status(503).json({ ok: false, error: 'Admin service unavailable' });
    }
  });

  protectedRouter.get('/status', (_req, res) => {
    res.json(manager.adminOverview());
  });

  protectedRouter.get('/dumps', async (_req, res) => {
    try {
      res.json({ ok: true, dumps: await dumps.list() });
    } catch (err) {
      console.error('dumps list failed:', err);
      res.status(500).json({ ok: false, error: 'Failed to list dumps' });
    }
  });

  protectedRouter.get('/dumps/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ ok: false, error: 'Invalid id' });
      return;
    }
    try {
      const dump = await dumps.findById(id);
      if (!dump) {
        res.status(404).json({ ok: false, error: 'Dump not found' });
        return;
      }
      res.json({ ok: true, dump });
    } catch (err) {
      console.error('dump fetch failed:', err);
      res.status(500).json({ ok: false, error: 'Failed to fetch dump' });
    }
  });

  protectedRouter.post('/rooms/:roomId/dump', async (req, res) => {
    const roomId = Number(req.params.roomId);
    if (!Number.isInteger(roomId)) {
      res.status(400).json({ ok: false, error: 'Invalid room id' });
      return;
    }
    const note = (req.body as { note?: string } | undefined)?.note;
    const result = await manager.dumpRoom(roomId, typeof note === 'string' && note.trim().length > 0 ? note.trim() : undefined);
    if (!result.ok) {
      res.status(404).json({ ok: false, error: result.error });
      return;
    }
    res.json({ ok: true, id: result.id });
  });

  protectedRouter.post('/credentials', async (req, res) => {
    let stored;
    try {
      stored = await adminCreds.get();
    } catch (err) {
      console.error('credentials update failed:', err);
      res.status(503).json({ ok: false, error: 'Admin service unavailable' });
      return;
    }
    if (!stored) {
      res.status(500).json({ ok: false, error: 'No admin credentials' });
      return;
    }
    const plan = await planCredentialChange(stored, (req.body ?? {}) as CredentialChangeInput);
    if (!plan.ok) {
      res.status(plan.status).json({ ok: false, error: plan.error });
      return;
    }
    try {
      await adminCreds.updateCredentials(plan.username, plan.passwordHash);
    } catch (err) {
      console.error('credentials update failed:', err);
      res.status(500).json({ ok: false, error: 'Failed to update credentials' });
      return;
    }
    clearAdminCookie(res);
    res.json({ ok: true });
  });

  app.use('/api/admin', publicRouter);
  app.use('/api/admin', protectedRouter);
}
```

- [ ] **Step 4: Убедиться, что тест `admin.test.ts` проходит (секция про токены без изменений)**

Run: `npm test -- test/admin.test.ts`
Expected: PASS.

Замечание: `config` больше не импортируется из `admin.ts`; удалённый импорт не нужен.

- [ ] **Step 5: Коммит**

```bash
git add server/src/admin.ts server/test/admin.test.ts
git commit -m "feat: авторизация админки на креды из БД, setAdminCookie(username)"
```

---

### Task 4: `planCredentialChange` + `/credentials` + подключение в index.ts

> Примечание: код `planCredentialChange` и роута `/credentials` уже включён в Task 3 (Step 3). Эта задача добавляет **тесты** на смену кредов и **проводку в `index.ts`/`config.ts`**.

**Files:**
- Modify: `server/test/admin.test.ts` (добавить блок тестов `planCredentialChange`)
- Modify: `server/src/index.ts`
- Modify: `server/src/config.ts`

**Interfaces:**
- Consumes: `planCredentialChange`, `signToken`, `verifyToken` из `server/src/admin.ts`; `hashPassword` из `server/src/password.js`; `adminCredentialsRepository` из `server/src/db.js`.
- Produces: изменение сигнатуры вызова `registerAdminRoutes(app, manager, dumpsRepository, adminCredentialsRepository)`.

- [ ] **Step 1: Добавить тесты смены кредов в `server/test/admin.test.ts`**

В конец файла добавить:

```ts
describe('admin: смена кредов (planCredentialChange)', () => {
  async function storedFor(password: string): Promise<{ username: string; passwordHash: string; sessionSecret: string }> {
    return { username: 'admin', passwordHash: await hashPassword(password), sessionSecret: 'secret-A' };
  }

  it('требует корректный текущий пароль', async () => {
    const stored = await storedFor('old');
    const r = await planCredentialChange(stored, { currentPassword: 'wrong', newPassword: 'new' });
    expect(r).toEqual({ ok: false, status: 401, error: 'Current password is incorrect' });
  });

  it('отклоняет пустую смену', async () => {
    const stored = await storedFor('old');
    const r = await planCredentialChange(stored, { currentPassword: 'old' });
    expect(r).toEqual({ ok: false, status: 400, error: 'Nothing to change' });
  });

  it('отклоняет пустой новый логин', async () => {
    const stored = await storedFor('old');
    const r = await planCredentialChange(stored, { currentPassword: 'old', newLogin: '   ' });
    expect(r).toEqual({ ok: false, status: 400, error: 'New login cannot be empty' });
  });

  it('отклоняет пустой новый пароль', async () => {
    const stored = await storedFor('old');
    const r = await planCredentialChange(stored, { currentPassword: 'old', newPassword: '' });
    expect(r).toEqual({ ok: false, status: 400, error: 'New password cannot be empty' });
  });

  it('отклоняет совпадение нового логина с текущим', async () => {
    const stored = await storedFor('old');
    const r = await planCredentialChange(stored, { currentPassword: 'old', newLogin: 'admin' });
    expect(r).toEqual({ ok: false, status: 409, error: 'New login is the same as current' });
  });

  it('отклоняет совпадение нового пароля с текущим', async () => {
    const stored = await storedFor('old');
    const r = await planCredentialChange(stored, { currentPassword: 'old', newPassword: 'old' });
    expect(r).toEqual({ ok: false, status: 400, error: 'New password is the same as current' });
  });

  it('меняет только пароль', async () => {
    const stored = await storedFor('old');
    const r = await planCredentialChange(stored, { currentPassword: 'old', newPassword: 'new' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.username).toBe('admin');
    expect(await verifyPassword('new', r.passwordHash)).toBe(true);
    expect(await verifyPassword('old', r.passwordHash)).toBe(false);
  });

  it('меняет логин и пароль', async () => {
    const stored = await storedFor('old');
    const r = await planCredentialChange(stored, { currentPassword: 'old', newLogin: 'root', newPassword: 'new' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.username).toBe('root');
    expect(await verifyPassword('new', r.passwordHash)).toBe(true);
  });
});
```

Добавить импорты в шапку `server/test/admin.test.ts` (строка 2):

```ts
import { signToken, verifyToken, authAdmin, planCredentialChange } from '../src/admin.js';
```

- [ ] **Step 2: Тест ротации `session_secret` (инвалидация сессий)**

В тот же describe добавить:

```ts
  it('ротация session_secret убивает старые токены', async () => {
    const secretA = 'secret-A';
    const token = signToken({ u: 'admin', exp: Date.now() + 60000 }, secretA);
    expect(verifyToken(token, secretA)).toEqual({ u: 'admin' });
    expect(verifyToken(token, 'secret-B')).toBeNull();
  });
```

- [ ] **Step 3: Убедиться, что все тесты проходят**

Run: `npm test -- test/admin.test.ts`
Expected: PASS (10 тестов про токены/authAdmin/смену кредов).

- [ ] **Step 4: Проводка в `server/src/index.ts`**

Импорт (строка 3):

```ts
import { closeDb, initDb, dumpsRepository, adminCredentialsRepository } from './db.js';
```

Вызов (строка 40):

```ts
  registerAdminRoutes(app, manager, dumpsRepository, adminCredentialsRepository);
```

Блок предупреждения об insecure-конфиге (строки 42-53) — убрать проверку `adminSecret`:

```ts
  if (process.env.NODE_ENV === 'production') {
    const cfg = await import('./config.js');
    const insecure = cfg.config.adminUser === 'admin' || cfg.config.adminPassword === 'admin';
    if (insecure) {
      console.warn(
        'WARNING: admin uses default credentials. Set CONQUEST_ADMIN_USER and CONQUEST_ADMIN_PASSWORD in production.',
      );
    }
  }
```

- [ ] **Step 5: Удалить `adminSecret` из `server/src/config.ts`**

Удалить строку 41:

```ts
  adminSecret: process.env.CONQUEST_ADMIN_SECRET ?? 'conquest-admin-dev-secret',
```

- [ ] **Step 6: Полный прогон тестов и сборка**

Run: `npm test`
Expected: PASS (все файлы тестов).
Run: `npm run build`
Expected: tsc без ошибок.

- [ ] **Step 7: Коммит**

```bash
git add server/test/admin.test.ts server/src/index.ts server/src/config.ts
git commit -m "feat: смена кредов админки, ротация сессий, проводка в index.ts"
```

---

### Task 5: Вкладки «Обзор»/«Аккаунт» в `admin.html`

**Files:**
- Modify: `server/public/admin.html`

**Interfaces:**
- Consumes: `POST /api/admin/credentials` (body: `{ currentPassword, newLogin?, newPassword? }`, ответы `{ ok: true }` или `{ ok: false, error }`; 401 — неверный текущий пароль или сессия истекла).
- Produces: работающая вкладка «Аккаунт» в админ-панели.

- [ ] **Step 1: Добавить CSS вкладок и полей**

В блок `<style>` после правила `.note { ... }` (строка 29) добавить:

```css
  .tabs { display: flex; gap: 8px; margin-bottom: 16px; }
  .tab { background: #2a2a31; border: 1px solid #555; }
  .tab.active { background: #2196f3; }
  .field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
  .field label { color: #999; font-size: 12px; }
```

- [ ] **Step 2: Добавить панель вкладок в HTML**

После `<h1>Conquest Admin</h1>` (строка 34) вставить:

```html
  <div id="tabs" class="tabs" style="display:none">
    <button class="tab active" data-tab="overview">Обзор</button>
    <button class="tab" data-tab="account">Аккаунт</button>
  </div>
```

- [ ] **Step 3: Добавить глобальную переменную и функции переключения вкладок**

В начале `<script>` (после строки 40 `let selectedDump = null;`) добавить:

```js
let currentTab = 'overview';
let meUsername = '';
```

После функции `esc` (строка 72) добавить:

```js
function showTabs() {
  $('#tabs').style.display = 'flex';
  document.querySelectorAll('#tabs .tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === currentTab);
  });
}

function bindTabs() {
  document.querySelectorAll('#tabs .tab').forEach((b) => {
    b.onclick = () => switchTab(b.dataset.tab);
  });
}

function switchTab(tab) {
  currentTab = tab;
  stopPoll();
  showTabs();
  if (tab === 'account') renderAccount();
  else renderDashboard();
}
```

- [ ] **Step 4: Добавить `renderAccount`**

После функции `renderLogin` (строка 70) добавить:

```js
function renderAccount() {
  $('#view').innerHTML = `
    <div class="card" style="max-width:420px">
      <h2>Аккаунт</h2>
      <div class="field"><label>Логин</label><input id="cur-login" value="${esc(meUsername)}" disabled></div>
      <div class="field"><label>Текущий пароль</label><input id="cur-pass" type="password" autocomplete="current-password"></div>
      <div class="field"><label>Новый логин (необязательно)</label><input id="new-login" autocomplete="off"></div>
      <div class="field"><label>Новый пароль (необязательно)</label><input id="new-pass" type="password" autocomplete="new-password"></div>
      <div class="row" style="margin-top:12px">
        <button id="save-creds">Сохранить</button>
        <span id="creds-msg" class="note"></span>
      </div>
    </div>`;
  $('#save-creds').onclick = async () => {
    const msg = $('#creds-msg');
    msg.className = 'note';
    msg.textContent = 'Сохранение…';
    let res;
    try {
      res = await fetch('/api/admin/credentials', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: $('#cur-pass').value,
          newLogin: $('#new-login').value.trim() || undefined,
          newPassword: $('#new-pass').value || undefined,
        }),
      });
    } catch (e) {
      msg.className = 'err';
      msg.textContent = 'Ошибка сети';
      return;
    }
    const r = await res.json().catch(() => ({}));
    if (res.ok && r.ok) { boot(); return; }
    msg.className = 'err';
    msg.textContent = r.error || (res.status === 401 ? 'Сессия истекла' : 'Ошибка');
  };
}
```

- [ ] **Step 5: Обновить `boot()` и `renderDashboard`**

Заменить функцию `boot()` (строки 192-197) на:

```js
async function boot() {
  let me;
  try { me = await refreshMe(); } catch { me = { authenticated: false }; }
  if (me.authenticated) {
    meUsername = me.username || '';
    bindTabs();
    showTabs();
    renderDashboard();
  } else {
    meUsername = '';
    currentTab = 'overview';
    $('#tabs').style.display = 'none';
    renderLogin();
  }
}
```

В `renderDashboard` строка `$('#view').innerHTML = \`...\`` не меняется. После `$('#logout').onclick = ...` (строка 132) добавить показ вкладок (на случай повторного рендера):

```js
  showTabs();
```

- [ ] **Step 6: Ручная проверка**

Сервер уже собран из предыдущих задач. Запустить окружение:

Run: `docker compose up --build -d`
Ожидание:
1. Открыть `http://localhost:5173/admin` → после входа (admin/admin) видно две вкладки.
2. Вкладка «Аккаунт»: ввести текущий пароль и новый логин/пароль, «Сохранить» → выход на форму логина.
3. Войти новыми кредыми → снова две вкладки.
4. Перезапустить сервер (`docker compose restart api`) → вход новыми кредыми продолжает работать (сидер не перезаписал).
5. Старая вкладка с сессией (если открыта) больше не пускает в дашборд.

- [ ] **Step 7: Коммит**

```bash
git add server/public/admin.html
git commit -m "feat: админка — вкладка «Аккаунт» со сменой логина/пароля"
```

---

## Self-Review

**Spec coverage:**
- Хранение `admin_credentials` + сидер из env при отсутствии — Task 2.
- Оригинал из env сохраняется как источник сида — Task 2 (`ensureSeeded` из `config.adminUser/adminPassword`).
- `authAdmin` на scrypt-хэше из БД — Task 3.
- Токены на `session_secret` из БД — Task 3.
- Инвалидация всех сессий при смене — Task 2 (`updateCredentials` ротирует `session_secret`) + тест в Task 4.
- `POST /api/admin/credentials` с `currentPassword`/`newLogin`/`newPassword`, коды 400/401/409 — Task 3, 4.
- Вкладки «Обзор»/«Аккаунт», выход на форму логина после смены — Task 5.
- Тесты: сидер (вручную), `authAdmin`, scrypt, смена кредов, инвалидация — Task 1, 3, 4, 5.

**Placeholder scan:** кода нет, только конкретные правки; всех типов/сигнатур в рамках плана нет ссылок на неопределённые сущности.

**Type consistency:**
- `authAdmin(username, password, stored)` — одно и то же имя/сигнатура в Task 3 и 4.
- `planCredentialChange(stored, input)` → `CredentialChange` — совпадает в Task 3 и 4.
- `setAdminCookie(res, username, secret)` — только в Task 3.
- `adminCredentialsRepository` — определён в Task 2, используется в Task 4 (index.ts) и Task 3 (admin.ts).
- `hashPassword`/`verifyPassword` — определены в Task 1, используются в Task 2/3/4.
