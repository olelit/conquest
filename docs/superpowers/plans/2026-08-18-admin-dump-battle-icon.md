# Мечи на битвах, дамп игры в БД, admin-страница — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Иконка скрещенных мечей на гексах с боем, сохранение полного сырого стейта игры в PostgreSQL по кнопке (только админ), и admin-страница `/admin` с логином, онлайн-игроками и просмотром дампов.

**Architecture:** Три части. (1) Чистый UI в `HexMap.vue` — SVG-иконка на гексах `attackerId !== null`. (2) Сервер: `Room.dumpState()` сериализует полный стейт, `RoomManager.dumpRoom()` сохраняет его в новую таблицу `game_dumps` (TypeORM jsonb). (3) Admin: новый модуль `admin.ts` — подписанная HttpOnly-cookie (HMAC), эндпоинты `/api/admin/*`, статичная страница `/admin`; `RoomManager` отслеживает активные WS-подключения для списка онлайн-игроков.

**Tech Stack:** Node 22 (ESM), express, ws, typeorm/postgres; Vue 3 + Vite; vitest (server); nginx (prod).

## Global Constraints

- Сервер: ESM, импорты с расширением `.js` (напр. `from './admin.js'`), `strict: true`, дектораторы TypeORM.
- Никаких новых зависимостей: HMAC через `node:crypto`, body-парсинг через `express.json()`.
- Тесты сервера: `npm test` в `server/` (vitest). Веб: проверка `npm run build` в `web/` (vue-tsc + vite).
- Стиль коммитов в репозитории: `feat:`, `fix:`, `docs:`, `test:` — короткое описание (см. `git log --oneline`).
- Конфиг admin через env: `CONQUEST_ADMIN_USER` (default `admin`), `CONQUEST_ADMIN_PASSWORD` (default `admin`), `CONQUEST_ADMIN_SECRET` (default `conquest-admin-dev-secret`).
- Дефолтные креды `admin:admin` — только для разработки; в проде задаются env.

---

### Task 1: Иконка скрещенных мечей на гексах с боем

**Files:**
- Modify: `web/src/components/HexMap.vue`

**Interfaces:**
- Consumes: ничего (существующий `props.hexes`, `hexCenter(q, r)`, `attackerId` на гексе).
- Produces: `.hex-swords` — SVG-группа двух скрещенных мечей; константа `SWORD_DY`.

- [ ] **Step 1: Добавить константу сдвига и константу пути меча в script**

В `web/src/components/HexMap.vue`, рядом с `const HEX_SIZE = 30;` (примерно строка 13), добавить:

```ts
// Иконка боя: две скрещенные сабли по центру гекса, сдвиг вверх
const SWORD_DY = 5;
```

- [ ] **Step 2: Добавить `<defs>` с формой меча**

Внутри существующего `<defs>` (там уже есть `<clipPath v-for=...>`), добавить в самый конец блока, перед закрывающим `</defs>`:

```html
<g id="hex-sword">
  <path d="M 0 -13 L 1.4 -7 L 0.7 -1 L -0.7 -1 L -1.4 -7 Z" />
  <path d="M -3.5 -0.5 L 3.5 -0.5 L 3.5 0.5 L -3.5 0.5 Z" />
  <path d="M -0.6 0.5 L 0.6 0.5 L 0.6 3.2 L -0.6 3.2 Z" />
  <circle cx="0" cy="4.1" r="0.9" />
</g>
```

- [ ] **Step 3: Отрисовать мечи на гексах с боем**

Внутри `<g v-for="hex in props.hexes" ...>` (после `<polygon>` кольца захвата `captureState`, примерно после строки 399), добавить:

```html
<g
  v-if="hex.attackerId !== null"
  :transform="`translate(${hexCenter(hex.q, hex.r).x} ${hexCenter(hex.q, hex.r).y - SWORD_DY})`"
  class="hex-swords"
>
  <use href="#hex-sword" transform="rotate(45)" />
  <use href="#hex-sword" transform="rotate(-45)" />
</g>
```

- [ ] **Step 4: CSS для `.hex-swords`**

В scoped-стилях, после блока `.hex-capture-ring` (примерно строка 500), добавить:

```css
.hex-swords {
  fill: #ffd54f;
  stroke: #1a1a1a;
  stroke-width: 1.4;
  pointer-events: none;
}
```

- [ ] **Step 5: Проверить сборку**

Run: `cd web && npm run build`
Expected: сборка без ошибок (vue-tsc + vite).

- [ ] **Step 6: Commit**

```bash
git add web/src/components/HexMap.vue
git commit -m "feat: иконка скрещенных мечей на гексах с боем"
```

---

### Task 2: Дамп состояния — сущность в БД, `dumpState`, `dumpRoom`

**Files:**
- Modify: `server/src/db.ts`
- Modify: `server/src/rooms.ts`
- Test: `server/test/rooms.test.ts`

**Interfaces:**
- Consumes: `GameState`, `PlayerState`, `HexState`, `RoomSlot`, `LogEntry` (уже есть в `rooms.ts`), `rules.DiplomacyRelation` (`rules.ts`).
- Produces:
  - `db.ts`: класс `GameDumpEntity`, класс `DumpsRepository` с `save(dump)` → `Promise<number>` (id), `list()` (без state), `findById(id)`.
  - `rooms.ts`: `Room.dumpState(): RoomDump`; `RoomManager.dumpRoom(roomId, note?): Promise<{ ok: true; id: number } | { ok: false; error: string }>`.
  - Интерфейс `RoomDump` (экспортируемый).

- [ ] **Step 1: Написать падающий тест для `dumpState`**

В конец `server/test/rooms.test.ts` добавить:

```ts
describe('Room: дамп состояния', () => {
  it('dumpState возвращает полный сырой стейт', () => {
    const room = new Room(7, 'Дамп', 'normal', 6, true, 2, () => 0.5);
    room.addHuman('A', 1);
    room.start(1);
    const g = room.gameState!;
    g.hexes[0].ownerId = 1;
    g.players[0].capital = { q: g.hexes[0].q, r: g.hexes[0].r };
    g.players[0].points = 1234;
    g.hexes[1].attackerId = 2;
    g.hexes[1].attackInvestment = 300;
    g.hexes[2].fortress = true;
    rules.declareWar(g, 1, 2);
    const dump = room.dumpState();
    expect(dump.room.id).toBe(7);
    expect(dump.room.mapType).toBe('normal');
    expect(dump.room.status).toBe('playing');
    expect(dump.room.aiMode).toBe(true);
    expect(dump.players).toHaveLength(3);
    expect(dump.players.find((p) => p.id === 1)!.points).toBe(1234);
    expect(dump.hexes).toHaveLength(192);
    expect(dump.hexes.find((h) => h.attackerId === 2)).toBeDefined();
    expect(dump.hexes.some((h) => h.fortress)).toBe(true);
    expect(dump.diplomacy['1-2']).toBe('war');
    expect(dump.slots).toHaveLength(3);
    expect(dump.log.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

Run: `cd server && npx vitest run test/rooms.test.ts -t "дамп состояния"`
Expected: FAIL — `room.dumpState is not a function`.

- [ ] **Step 3: Добавить сущность и репозиторий в `db.ts`**

В `server/src/db.ts`:
- Расширить импорт typeorm: `import { Column, DataSource, Entity, PrimaryColumn, PrimaryGeneratedColumn, Repository } from 'typeorm';`
- После класса `PlayersRepository` добавить:

```ts
@Entity('game_dumps')
export class GameDumpEntity {
  @PrimaryGeneratedColumn({ name: 'id', type: 'int' })
  id!: number;

  @Column({ name: 'room_id', type: 'int' })
  roomId!: number;

  @Column({ name: 'room_name', type: 'text' })
  roomName!: string;

  @Column({ name: 'map_type', type: 'text' })
  mapType!: string;

  @Column({ name: 'note', type: 'text', nullable: true })
  note!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'state', type: 'jsonb' })
  state!: unknown;
}

export class DumpsRepository {
  constructor(private readonly dataSource: DataSource) {}

  private repo(): Repository<GameDumpEntity> {
    return this.dataSource.getRepository(GameDumpEntity);
  }

  async save(dump: { roomId: number; roomName: string; mapType: string; note: string | null; state: unknown }): Promise<number> {
    const entity = await this.repo().save({
      roomId: dump.roomId,
      roomName: dump.roomName,
      mapType: dump.mapType,
      note: dump.note ?? null,
      state: dump.state,
    });
    return entity.id;
  }

  async list(): Promise<{ id: number; roomId: number; roomName: string; mapType: string; note: string | null; createdAt: Date }[]> {
    return this.repo().find({
      order: { id: 'DESC' },
      select: ['id', 'roomId', 'roomName', 'mapType', 'note', 'createdAt'],
    });
  }

  async findById(id: number): Promise<GameDumpEntity | null> {
    return this.repo().findOneBy({ id });
  }
}

export const dumpsRepository = new DumpsRepository(dataSource);
```

- В конец массива `entities` в `new DataSource({...})` добавить `GameDumpEntity`:

```ts
  entities: [PlayerEntity, GameDumpEntity],
```

- [ ] **Step 4: Добавить `RoomDump` и `Room.dumpState()` в `rooms.ts`**

В `server/src/rooms.ts`, после интерфейса `RoomView` (примерно строка 63), добавить:

```ts
export interface RoomDump {
  room: {
    id: number;
    name: string;
    mapType: MapType;
    maxPlayers: number;
    aiMode: boolean;
    aiCount: number;
    difficulty: Difficulty;
    loadTest: boolean;
    training: boolean;
    status: RoomStatus;
    hostPlayerId: number | null;
    paused: boolean;
    startedAt: number;
    tickCounter: number;
  };
  winnerId: number | null;
  players: PlayerState[];
  hexes: HexState[];
  diplomacy: Record<string, rules.DiplomacyRelation>;
  pendingProposals: { from: number; to: number; kind: 'peace' | 'alliance' }[];
  majorityHolderId: number | null;
  slots: RoomSlot[];
  log: LogEntry[];
  attackStartedAt: Record<string, number>;
}
```

Внутри класса `Room`, сразу после метода `view(...)` (после строки ~664, перед `private nextSlotId`), добавить:

```ts
dumpState(): RoomDump {
  const state = this.state;
  const diplomacy: Record<string, rules.DiplomacyRelation> = {};
  if (state?.diplomacy) {
    for (const [key, rel] of state.diplomacy) diplomacy[key] = rel;
  }
  const attackStartedAt: Record<string, number> = {};
  for (const [key, t] of this.attackStartedAt) attackStartedAt[key] = t;
  return {
    room: {
      id: this.id,
      name: this.name,
      mapType: this.mapType,
      maxPlayers: this.maxPlayers,
      aiMode: this.aiMode,
      aiCount: this.aiCount,
      difficulty: this.difficulty,
      loadTest: this.loadTest,
      training: this.training,
      status: this.status,
      hostPlayerId: this.hostPlayerId,
      paused: this.paused,
      startedAt: this.startedAt,
      tickCounter: this.tickCounter,
    },
    winnerId: state?.winnerId ?? null,
    players: state?.players ?? [],
    hexes: state?.hexes ?? [],
    diplomacy,
    pendingProposals: this.pendingProposals.map((p) => ({ ...p })),
    majorityHolderId: this.majorityHolderId,
    slots: this.slots.map((s) => ({ ...s })),
    log: this.log.map((l) => ({ ...l })),
    attackStartedAt,
  };
}
```

- [ ] **Step 5: Добавить `RoomManager.dumpRoom()` в `rooms.ts`**

В класс `RoomManager`, перед методом `lobby()` (примерно строка 898), добавить:

```ts
async dumpRoom(roomId: number, note?: string): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const room = this.rooms.get(roomId);
  if (!room) return { ok: false, error: 'Room not found' };
  try {
    const id = await dumpsRepository.save({
      roomId: room.id,
      roomName: room.name,
      mapType: room.mapType,
      note: note ?? null,
      state: room.dumpState(),
    });
    return { ok: true, id };
  } catch (err) {
    console.error('dump save failed:', err);
    return { ok: false, error: 'Failed to save dump' };
  }
}
```

- В импортах `rooms.ts` добавить `dumpsRepository`:

```ts
import { dumpsRepository } from './db.js';
```

- [ ] **Step 6: Запустить тесты**

Run: `cd server && npm test`
Expected: PASS — все тесты, включая новый «дамп состояния». (Новый тест не касается БД: `dumpState` работает без подключения; импорт `db.js` в тесте безопасен — `dataSource` не инициализируется.)

- [ ] **Step 7: Commit**

```bash
git add server/src/db.ts server/src/rooms.ts server/test/rooms.test.ts
git commit -m "feat: дамп состояния игры — GameDumpEntity, Room.dumpState, RoomManager.dumpRoom"
```

---

### Task 3: Admin-сессия — конфиг, HMAC-токен, login/logout/me, страница `/admin` (заглушка)

**Files:**
- Modify: `server/src/config.ts`
- Create: `server/src/admin.ts`
- Create: `server/public/admin.html` (заглушка)
- Modify: `server/src/index.ts`
- Test: `server/test/admin.test.ts` (новый)

**Interfaces:**
- Consumes: `config` из `config.js`, `express`, `node:crypto`, тип `RoomManager` (type-only), тип `DumpsRepository` (type-only).
- Produces:
  - `config.ts`: `adminUser`, `adminPassword`, `adminSecret`.
  - `admin.ts`: `ADMIN_COOKIE`, `signToken(payload: { u: string; exp: number }, secret: string): string`, `verifyToken(token, secret): { u: string } | null`, `authAdmin(username, password): boolean`, `adminSession(req): { u: string } | null`, `requireAdmin` (middleware), `setAdminCookie(res)`, `clearAdminCookie(res)`, `registerAdminRoutes(app, manager, dumps)`.

- [ ] **Step 1: Написать падающий тест для токена**

Создать `server/test/admin.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { signToken, verifyToken, authAdmin } from '../src/admin.js';

const SECRET = 'test-secret';

describe('admin: токен сессии', () => {
  it('корректный токен проходит проверку', () => {
    const token = signToken({ u: 'admin', exp: Date.now() + 60000 }, SECRET);
    expect(verifyToken(token, SECRET)).toEqual({ u: 'admin' });
  });
  it('подделанный токен отклоняется', () => {
    const token = signToken({ u: 'admin', exp: Date.now() + 60000 }, SECRET);
    const forged = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    expect(verifyToken(forged, SECRET)).toBeNull();
  });
  it('протухший токен отклоняется', () => {
    const token = signToken({ u: 'admin', exp: Date.now() - 1000 }, SECRET);
    expect(verifyToken(token, SECRET)).toBeNull();
  });
  it('токен с другим секретом отклоняется', () => {
    const token = signToken({ u: 'admin', exp: Date.now() + 60000 }, SECRET);
    expect(verifyToken(token, 'other-secret')).toBeNull();
  });
  it('authAdmin сверяет логин и пароль', () => {
    expect(authAdmin('admin', 'admin')).toBe(true);
    expect(authAdmin('admin', 'wrong')).toBe(false);
  });
});
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

Run: `cd server && npx vitest run test/admin.test.ts`
Expected: FAIL — cannot find module `../src/admin.js`.

- [ ] **Step 3: Добавить admin-конфиг в `config.ts`**

В `server/src/config.ts`, в конец объекта `config` (после `googleClientId`), добавить:

```ts
  adminUser: process.env.CONQUEST_ADMIN_USER ?? 'admin',
  adminPassword: process.env.CONQUEST_ADMIN_PASSWORD ?? 'admin',
  adminSecret: process.env.CONQUEST_ADMIN_SECRET ?? 'conquest-admin-dev-secret',
```

- [ ] **Step 4: Создать `server/src/admin.ts`**

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';
import type { RoomManager } from './rooms.js';
import type { DumpsRepository } from './db.js';

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

export function authAdmin(username: string, password: string): boolean {
  return username === config.adminUser && password === config.adminPassword;
}

export function adminSession(req: Request): { u: string } | null {
  const cookie = req.headers.cookie ?? '';
  const match = cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${ADMIN_COOKIE}=`));
  if (!match) return null;
  const token = match.slice(ADMIN_COOKIE.length + 1);
  return verifyToken(token, config.adminSecret);
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (adminSession(req)) {
    next();
  } else {
    res.status(401).json({ ok: false, error: 'Admin access required' });
  }
}

export function setAdminCookie(res: Response): void {
  const token = signToken({ u: config.adminUser, exp: Date.now() + SESSION_TTL_MS }, config.adminSecret);
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`);
}

export function clearAdminCookie(res: Response): void {
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

export function registerAdminRoutes(app: express.Express, manager: RoomManager, dumps: DumpsRepository): void {
  app.get('/admin', (_req, res) => {
    res.sendFile(join(import.meta.dirname, '..', 'public', 'admin.html'));
  });

  const publicRouter = express.Router();

  publicRouter.post('/login', (req, res) => {
    const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
    if (!authAdmin(String(username ?? ''), String(password ?? ''))) {
      res.status(401).json({ ok: false, error: 'Invalid credentials' });
      return;
    }
    setAdminCookie(res);
    res.json({ ok: true, username: config.adminUser });
  });

  publicRouter.post('/logout', (_req, res) => {
    clearAdminCookie(res);
    res.json({ ok: true });
  });

  publicRouter.get('/me', (req, res) => {
    const session = adminSession(req);
    if (!session) {
      res.json({ authenticated: false });
      return;
    }
    res.json({ authenticated: true, username: session.u });
  });

  const protectedRouter = express.Router();
  protectedRouter.use(requireAdmin);

  // /status, /dumps, /dumps/:id, /rooms/:roomId/dump добавляются в Task 4 и Task 5

  app.use('/api/admin', publicRouter);
  app.use('/api/admin', protectedRouter);
}
```

- [ ] **Step 5: Создать заглушку `server/public/admin.html`**

```html
<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>Conquest Admin</title>
  <style>body { background: #14141a; color: #eee; font-family: sans-serif; padding: 24px; }</style>
</head>
<body>
  <h1>Conquest Admin</h1>
  <p>Заглушка. Полная панель появится в Task 6.</p>
</body>
</html>
```

- [ ] **Step 6: Подключить admin-роуты в `server/src/index.ts`**

В `server/src/index.ts`:
- Добавить импорт: `import { registerAdminRoutes } from './admin.js';`
- После `const app = express();` добавить: `app.use(express.json());`
- После `const manager = new RoomManager();` (строка ~37) добавить: `registerAdminRoutes(app, manager, dumpsRepository);`
- Добавить импорт: `import { dumpsRepository } from './db.js';`

Итоговый фрагмент основного блока:

```ts
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  await connectWithRetry();

  const manager = new RoomManager();
  registerAdminRoutes(app, manager, dumpsRepository);
  console.log('Conquest server ready: rooms in memory');
```

- [ ] **Step 7: Запустить тесты**

Run: `cd server && npm test`
Expected: PASS — все тесты, включая новый `admin.test.ts`.

- [ ] **Step 8: Commit**

```bash
git add server/src/config.ts server/src/admin.ts server/public/admin.html server/src/index.ts server/test/admin.test.ts
git commit -m "feat: admin-сессия — HMAC-токен, login/logout/me, заглушка страницы /admin"
```

---

### Task 4: Онлайн-игроки — `adminOverview`, отслеживание подключений, `/status`

**Files:**
- Modify: `server/src/rooms.ts`
- Modify: `server/src/ws.ts`
- Modify: `server/src/admin.ts`
- Test: `server/test/rooms.test.ts`

**Interfaces:**
- Consumes: `connectionOpened` (новый вызов из `ws.ts`), `roomForConn`, `slotForConn`, `view()`, `authProfiles`, `humanCount`, `slotsCount`, `gameState`.
- Produces:
  - `rooms.ts`: `RoomManager.connectionOpened(connId: number)`, `RoomManager.adminOverview(): { online: number; players: AdminPlayerInfo[]; rooms: AdminRoomInfo[] }`; интерфейсы `AdminPlayerInfo`, `AdminRoomInfo`.
  - `admin.ts`: эндпоинт `GET /api/admin/status` внутри `registerAdminRoutes`.

- [ ] **Step 1: Написать падающий тест**

В конец `server/test/rooms.test.ts` добавить:

```ts
describe('RoomManager: онлайн-игроки', () => {
  it('connectionOpened/Closed меняют online, adminOverview описывает игроков', () => {
    const m = new RoomManager();
    expect(m.adminOverview().online).toBe(0);
    m.connectionOpened(1);
    m.connectionOpened(2);
    m.createRoom(1, 'normal', 4);
    const overview = m.adminOverview();
    expect(overview.online).toBe(2);
    const p1 = overview.players.find((p) => p.connId === 1)!;
    expect(p1).toMatchObject({ name: 'Player', roomId: 1, isHost: true });
    m.connectionClosed(1);
    expect(m.adminOverview().online).toBe(1);
    expect(m.adminOverview().players.find((p) => p.connId === 2)!.roomId).toBe(1);
  });
  it('rooms в adminOverview заполняются', () => {
    const m = new RoomManager();
    m.connectionOpened(1);
    m.createRoom(1, 'normal', 4);
    m.startRoom(1);
    const rooms = m.adminOverview().rooms;
    expect(rooms).toHaveLength(1);
    expect(rooms[0]).toMatchObject({ mapType: 'normal', status: 'playing', humans: 1, aiMode: false });
  });
});
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

Run: `cd server && npx vitest run test/rooms.test.ts -t "онлайн-игроки"`
Expected: FAIL — `m.adminOverview is not a function`.

- [ ] **Step 3: Добавить интерфейсы и `adminOverview`/`connectionOpened` в `rooms.ts`**

В `server/src/rooms.ts`, после интерфейса `RoomDump` (из Task 2), добавить:

```ts
export interface AdminPlayerInfo {
  connId: number;
  name: string;
  email: string | null;
  roomId: number | null;
  roomName: string | null;
  roomStatus: RoomStatus | null;
  isHost: boolean;
  connectedAt: number;
}

export interface AdminRoomInfo {
  id: number;
  name: string;
  mapType: MapType;
  status: RoomStatus;
  aiMode: boolean;
  loadTest: boolean;
  training: boolean;
  paused: boolean;
  humans: number;
  slots: number;
  winnerId: number | null;
}
```

В класс `RoomManager`, рядом с полем `private connToRoom = new Map<number, number>();` (строка ~776), добавить поле:

```ts
  private onlineConns = new Map<number, number>();
```

В класс `RoomManager`, перед `connectionClosed` (строка ~931), добавить:

```ts
  connectionOpened(connId: number): void {
    this.onlineConns.set(connId, Date.now());
  }

  adminOverview(): { online: number; players: AdminPlayerInfo[]; rooms: AdminRoomInfo[] } {
    const players: AdminPlayerInfo[] = [];
    for (const [connId, connectedAt] of this.onlineConns) {
      const room = this.roomForConn(connId);
      const profile = this.authProfiles.get(connId);
      const slotId = room?.slotForConn(connId) ?? null;
      const slot = room && slotId !== null ? room.view().slots.find((s) => s.id === slotId) ?? null : null;
      players.push({
        connId,
        name: profile?.name ?? slot?.name ?? 'Player',
        email: profile?.email ?? null,
        roomId: room?.id ?? null,
        roomName: room?.name ?? null,
        roomStatus: room?.status ?? null,
        isHost: slotId !== null && room?.hostPlayerId === slotId,
        connectedAt,
      });
    }
    const rooms: AdminRoomInfo[] = [];
    for (const room of this.rooms.values()) {
      rooms.push({
        id: room.id,
        name: room.name,
        mapType: room.mapType,
        status: room.status,
        aiMode: room.aiMode,
        loadTest: room.loadTest,
        training: room.training,
        paused: room.paused,
        humans: room.humanCount,
        slots: room.slotsCount,
        winnerId: room.gameState?.winnerId ?? null,
      });
    }
    return { online: players.length, players, rooms };
  }
```

В `connectionClosed` (строка ~931), перед закрытием метода, добавить удаление из `onlineConns`:

```ts
  connectionClosed(connId: number): void {
    this.onlineConns.delete(connId);
    this.leaveRoom(connId);
    this.authProfiles.delete(connId);
  }
```

- [ ] **Step 4: Вызывать `connectionOpened` в `ws.ts`**

В `server/src/ws.ts`, в обработчике `wss.on('connection', (ws) => { ... })` (строка ~52), сразу после `connIds.set(ws, connId);` добавить:

```ts
    manager.connectionOpened(connId);
```

- [ ] **Step 5: Добавить эндпоинт `/status` в `admin.ts`**

В `server/src/admin.ts`, в `registerAdminRoutes`, внутри `protectedRouter` заменить комментарий «/status, /dumps...» на:

```ts
  protectedRouter.get('/status', (_req, res) => {
    res.json(manager.adminOverview());
  });

  // /dumps, /dumps/:id, /rooms/:roomId/dump добавляются в Task 5
```

- [ ] **Step 6: Запустить тесты**

Run: `cd server && npm test`
Expected: PASS — включая новые тесты «онлайн-игроки».

- [ ] **Step 7: Commit**

```bash
git add server/src/rooms.ts server/src/ws.ts server/src/admin.ts server/test/rooms.test.ts
git commit -m "feat: админ — онлайн-игроки (RoomManager.adminOverview) и эндпоинт /api/admin/status"
```

---

### Task 5: Дамп через HTTP — `GET /dumps`, `GET /dumps/:id`, `POST /rooms/:roomId/dump`

**Files:**
- Modify: `server/src/admin.ts`

**Interfaces:**
- Consumes: `manager.dumpRoom(roomId, note?)` (Task 2), `dumps` (`DumpsRepository`) из аргумента `registerAdminRoutes`, `requireAdmin`.
- Produces: эндпоинты `GET /api/admin/dumps`, `GET /api/admin/dumps/:id`, `POST /api/admin/rooms/:roomId/dump`.

- [ ] **Step 1: Добавить эндпоинты в `registerAdminRoutes`**

В `server/src/admin.ts`, в `protectedRouter`, заменить комментарий «/dumps, /dumps/:id, /rooms/:roomId/dump добавляются в Task 5» на:

```ts
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
```

- [ ] **Step 2: Проверить типизацию**

Run: `cd server && npm run build`
Expected: сборка без ошибок (tsc).

- [ ] **Step 3: Запустить тесты**

Run: `cd server && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/src/admin.ts
git commit -m "feat: admin API — список дампов, просмотр дампа, сохранение дампа комнаты"
```

---

### Task 6: Admin-страница — дашборд

**Files:**
- Modify: `server/public/admin.html`
- Modify: `docker/app/Dockerfile`

**Interfaces:**
- Consumes: `GET /api/admin/me`, `POST /api/admin/login`, `POST /api/admin/logout`, `GET /api/admin/status`, `GET /api/admin/dumps`, `GET /api/admin/dumps/:id`, `POST /api/admin/rooms/:roomId/dump`.
- Produces: полная HTML-страница `/admin` (форма логина + дашборд: игроки онлайн, комнаты, дампы).

- [ ] **Step 1: Заменить `server/public/admin.html` на полный дашборд**

Полностью перезаписать файл (форма логина, игроки онлайн с обновлением раз в 2с, комнаты с кнопкой «Дамп» и полем заметки, дампы со списком и просмотром):

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Conquest Admin</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #14141a; color: #eee; font-family: system-ui, sans-serif; }
  .wrap { max-width: 960px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 22px; }
  h2 { font-size: 16px; margin: 24px 0 8px; color: #bbb; }
  .card { background: #1e1e24; border: 1px solid #333; border-radius: 10px; padding: 14px; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #2a2a31; }
  th { color: #999; font-weight: 600; }
  button { background: #2196f3; color: #fff; border: none; border-radius: 6px; padding: 8px 14px; cursor: pointer; font-size: 13px; }
  button.ghost { background: #2a2a31; border: 1px solid #555; }
  button:hover { filter: brightness(1.15); }
  input { background: #14141a; border: 1px solid #555; color: #fff; border-radius: 6px; padding: 8px; font-size: 13px; }
  .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; background: #2a2a31; }
  .badge.playing { background: #2e7d32; }
  .badge.waiting { background: #555; }
  .err { color: #ff6b6b; }
  .ok { color: #69db7c; }
  pre { background: #0d0d12; border: 1px solid #333; border-radius: 8px; padding: 10px; overflow: auto; max-height: 70vh; font-size: 12px; }
  .note { color: #999; font-size: 12px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Conquest Admin</h1>
  <div id="view"></div>
</div>
<script>
const $ = (s) => document.querySelector(s);
let statusTimer = null;
let selectedDump = null;

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...opts });
  if (res.status === 401) throw new Error('UNAUTHORIZED');
  return res.json();
}

async function refreshMe() {
  return api('/api/admin/me');
}

function renderLogin() {
  $('#view').innerHTML = `
    <div class="card" style="max-width:340px">
      <h2>Вход</h2>
      <div class="row" style="flex-direction:column;align-items:stretch">
        <input id="u" placeholder="Логин" autocomplete="username">
        <input id="p" type="password" placeholder="Пароль" autocomplete="current-password">
        <button id="login">Войти</button>
      </div>
      <div id="err" class="err"></div>
    </div>`;
  $('#login').onclick = async () => {
    const u = $('#u').value.trim();
    const p = $('#p').value;
    const r = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: u, password: p }) });
    if (!r.ok) { $('#err').textContent = 'Неверный логин или пароль'; return; }
    boot();
  };
}

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function renderStatus(data) {
  $('#online').textContent = String(data.online);
  const rows = data.players.map((p) => `
    <tr>
      <td>${esc(p.name)}</td>
      <td>${p.email ? esc(p.email) : '—'}</td>
      <td>${p.roomName ? esc(p.roomName) + ' <span class="badge ' + p.roomStatus + '">' + p.roomStatus + '</span>' : 'лобби'}</td>
      <td>${p.isHost ? 'хост' : ''}</td>
      <td>${new Date(p.connectedAt).toLocaleTimeString()}</td>
    </tr>`).join('');
  $('#players').innerHTML = rows || '<tr><td colspan="5" class="note">Нет подключений</td></tr>';

  const rooms = data.rooms.map((r) => `
    <div class="card">
      <div class="row">
        <strong>${esc(r.name)}</strong>
        <span class="badge ${r.status}">${r.status}</span>
        <span class="badge">${esc(r.mapType)}</span>
        <span class="note">люди: ${r.humans} / слотов: ${r.slots}${r.aiMode ? ' · ИИ' : ''}${r.paused ? ' · пауза' : ''}</span>
      </div>
      <div class="row" style="margin-top:8px">
        <input id="note-${r.id}" placeholder="Заметка (необязательно)" style="flex:1;min-width:200px">
        <button class="ghost" data-dump="${r.id}">Дамп</button>
      </div>
      <div id="msg-${r.id}" class="note"></div>
    </div>`).join('');
  $('#rooms').innerHTML = rooms || '<p class="note">Нет комнат</p>';
  document.querySelectorAll('[data-dump]').forEach((btn) => {
    btn.onclick = async () => {
      const id = Number(btn.dataset.dump);
      const note = $('#note-' + id).value.trim();
      const msg = $('#msg-' + id);
      msg.className = 'note';
      msg.textContent = 'Сохранение…';
      try {
        const r = await api('/api/admin/rooms/' + id + '/dump', { method: 'POST', body: JSON.stringify({ note }) });
        if (r.ok) { msg.className = 'ok'; msg.textContent = 'Сохранено (id=' + r.id + ')'; loadDumps(); }
        else { msg.className = 'err'; msg.textContent = r.error; }
      } catch (e) { msg.className = 'err'; msg.textContent = 'Ошибка'; }
    };
  });
}

function renderRoomsHeader() {
  $('#rooms').innerHTML = '<p class="note">…</p>';
}

async function loadDumps() {
  try {
    const r = await api('/api/admin/dumps');
    const list = r.dumps || [];
    $('#dumps').innerHTML = list.map((d) => `
      <tr>
        <td>#${d.id}</td>
        <td>${esc(d.roomName)}</td>
        <td>${esc(d.mapType)}</td>
        <td>${d.note ? esc(d.note) : '—'}</td>
        <td>${new Date(d.createdAt).toLocaleString()}</td>
        <td><button class="ghost" data-view="${d.id}">Открыть</button></td>
      </tr>`).join('') || '<tr><td colspan="6" class="note">Дампов нет</td></tr>';
    document.querySelectorAll('[data-view]').forEach((btn) => {
      btn.onclick = async () => {
        const r = await api('/api/admin/dumps/' + btn.dataset.view);
        selectedDump = r.dump;
        $('#dump-view').innerHTML = '<pre>' + esc(JSON.stringify(r.dump, null, 2)) + '</pre>';
        $('#dump-view').scrollIntoView();
      };
    });
  } catch (e) { /* 401 обрабатывается в poll */ }
}

function renderDashboard() {
  $('#view').innerHTML = `
    <div class="row" style="justify-content:space-between">
      <h2 id="welcome">Панель администратора</h2>
      <button class="ghost" id="logout">Выйти</button>
    </div>
    <h2>Игроки онлайн: <span id="online">0</span></h2>
    <div class="card"><table><thead><tr><th>Имя</th><th>Email</th><th>Комната</th><th>Роль</th><th>Соединён</th></tr></thead><tbody id="players"></tbody></table></div>
    <h2>Комнаты</h2>
    <div id="rooms"></div>
    <h2>Дампы</h2>
    <div class="card"><table><thead><tr><th>#</th><th>Комната</th><th>Карта</th><th>Заметка</th><th>Когда</th><th></th></tr></thead><tbody id="dumps"></tbody></table></div>
    <div id="dump-view"></div>`;
  $('#logout').onclick = async () => { await api('/api/admin/logout', { method: 'POST' }); stopPoll(); boot(); };
  renderStatus({ online: 0, players: [], rooms: [] });
  renderRoomsHeader();
  loadDumps();
  poll();
}

function poll() {
  if (statusTimer) clearInterval(statusTimer);
  const tick = async () => {
    try {
      const r = await api('/api/admin/status');
      if (r && Array.isArray(r.players)) renderStatus(r);
    } catch (e) {
      if (e.message === 'UNAUTHORIZED') { stopPoll(); boot(); }
    }
  };
  tick();
  statusTimer = setInterval(tick, 2000);
}

function stopPoll() {
  if (statusTimer) { clearInterval(statusTimer); statusTimer = null; }
}

async function boot() {
  let me;
  try { me = await refreshMe(); } catch { me = { authenticated: false }; }
  if (me.authenticated) renderDashboard();
  else renderLogin();
}

boot();
</script>
</body>
</html>
```

- [ ] **Step 2: Включить `public` в продакшн-образ**

В `docker/app/Dockerfile`, в стадию `prod` после `COPY --from=build /app/dist ./dist` добавить:

```dockerfile
COPY --from=build /app/public ./public
```

- [ ] **Step 3: Ручная проверка (dev)**

1. `docker compose up --build` (или `npm run dev` в `server/` + `web/`).
2. Открыть `http://localhost:5173/admin` — форма входа.
3. Войти `admin`/`admin` → дашборд.
4. В дашборде проверить: «Игроки онлайн» обновляется, «Комнаты» показывает активную игру, кнопка «Дамп» сохраняет и показывает id, «Дампы» открывает JSON.

- [ ] **Step 4: Commit**

```bash
git add server/public/admin.html docker/app/Dockerfile
git commit -m "feat: admin-дашборд — онлайн-игроки, комнаты, дампы"
```

---

### Task 7: Клиент — кнопка «Сохранить состояние в БД» в игре

**Files:**
- Create: `web/src/admin.ts`
- Modify: `web/src/App.vue`
- Modify: `web/src/i18n.ts`

**Interfaces:**
- Consumes: `GET /api/admin/me`, `POST /api/admin/rooms/:roomId/dump` (Task 5).
- Produces:
  - `web/src/admin.ts`: `adminMe(): Promise<AdminMe>` (`{ authenticated: boolean; username?: string }`), `adminDumpRoom(roomId: number, note?: string): Promise<AdminDumpResult>` (`{ ok: true; id: number } | { ok: false; error: string }`).
  - `App.vue`: `isAdmin` (ref), `onDumpGame()`.

- [ ] **Step 1: Создать `web/src/admin.ts`**

```ts
export interface AdminMe {
  authenticated: boolean;
  username?: string;
}

export async function adminMe(): Promise<AdminMe> {
  try {
    const res = await fetch('/api/admin/me', { credentials: 'same-origin' });
    if (!res.ok) return { authenticated: false };
    return (await res.json()) as AdminMe;
  } catch {
    return { authenticated: false };
  }
}

export type AdminDumpResult = { ok: true; id: number } | { ok: false; error: string };

export async function adminDumpRoom(roomId: number, note?: string): Promise<AdminDumpResult> {
  try {
    const res = await fetch(`/api/admin/rooms/${roomId}/dump`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: note ?? '' }),
    });
    const data = (await res.json()) as { ok?: boolean; id?: number; error?: string };
    if (data.ok === true && typeof data.id === 'number') return { ok: true, id: data.id };
    return { ok: false, error: data.error ?? 'Dump failed' };
  } catch {
    return { ok: false, error: 'Dump failed' };
  }
}
```

- [ ] **Step 2: Добавить i18n-ключи**

В `web/src/i18n.ts`, в блок `en` (перед закрывающей `},` после `'training.ok': 'OK'`) добавить:

```ts
    'burger.dumpGame': 'Save state to DB',
    'burger.dumpNote': 'Note (optional)',
    'dump.saved': 'State saved (id={id})',
    'dump.failed': 'Dump failed: {error}',
```

В блок `ru` (перед закрывающей `},` после `'training.ok': 'Ок'`) добавить:

```ts
    'burger.dumpGame': 'Сохранить состояние в БД',
    'burger.dumpNote': 'Комментарий (необязательно)',
    'dump.saved': 'Состояние сохранено (id={id})',
    'dump.failed': 'Ошибка дампа: {error}',
```

- [ ] **Step 3: Добавить состояние и обработчик в `App.vue`**

В `web/src/App.vue`:
- Импорт: `import { adminDumpRoom, adminMe } from './admin';` (в блоке импортов рядом с `import { GameClient } from './api';`).
- Рядом с `const victoryDismissed = ref(false);` (строка ~52) добавить:

```ts
const isAdmin = ref(false);
const dumpMsg = ref<{ kind: 'ok' | 'err'; text: string } | null>(null);
```

- Рядом с существующими `watch(...)` (после watch `room.value?.status`, ~строка 127) добавить:

```ts
watch(
  () => burgerOpen.value,
  (open) => {
    if (open) {
      adminMe().then((m) => {
        isAdmin.value = m.authenticated;
      });
    }
  },
);

onMounted(() => {
  adminMe().then((m) => {
    isAdmin.value = m.authenticated;
  });
});
```

Примечание: в файле уже есть один `onMounted` (строка ~409) — добавить второй допустимо во Vue 3, либо вставить вызов `adminMe()` внутрь существующего `onMounted` в конце. Выбрать один вариант (второй `onMounted` — проще и не конфликтует).

- Рядом с `function onRestart()` (строка ~333) добавить:

```ts
async function onDumpGame(): Promise<void> {
  if (!room.value) return;
  const note = window.prompt(t('burger.dumpNote'), '') ?? '';
  const result = await adminDumpRoom(room.value.id, note.trim());
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

- [ ] **Step 4: Кнопка в бургер-меню + баннер**

В шаблоне, в блоке `<div v-if="burgerOpen" class="burger-overlay">` внутри `<div class="burger-menu">`, перед `<button ... @click="onRestart">` добавить:

```html
        <button v-if="isAdmin && room" class="burger-menu__item" @click="onDumpGame">{{ t('burger.dumpGame') }}</button>
```

В игровом экране, рядом с существующими баннерами (после `<div v-if="error" class="banner banner--error">{{ error }}</div>`, строка ~566) добавить:

```html
        <div v-if="dumpMsg" class="banner" :class="dumpMsg.kind === 'ok' ? 'banner--warn' : 'banner--error'">{{ dumpMsg.text }}</div>
```

- [ ] **Step 5: Проверить сборку**

Run: `cd web && npm run build`
Expected: сборка без ошибок.

- [ ] **Step 6: Ручная проверка**

1. Войти в admin на `http://localhost:5173/admin`.
2. В той же вкладке (или после перезагрузки игры в той же вкладке браузера) открыть игру, нажать ☰ — пункт «Сохранить состояние в БД».
3. Нажать пункт, ввести заметку → баннер «Состояние сохранено (id=N)».
4. В admin-дашборде раздел «Дампы» показывает новый дамп, JSON открывается.

- [ ] **Step 7: Commit**

```bash
git add web/src/admin.ts web/src/App.vue web/src/i18n.ts
git commit -m "feat: клиент — кнопка «Сохранить состояние в БД» для админа"
```

---

### Task 8: Прокси для `/admin` (dev и prod)

**Files:**
- Modify: `docker/web/nginx.conf`
- Modify: `web/vite.config.ts`

**Interfaces:**
- Consumes: эндпоинт `GET /admin` (Task 3) и `/api/admin/*` (Tasks 3–5).
- Produces: доступность `/admin` через nginx (prod) и vite dev-server (dev).

- [ ] **Step 1: nginx — проксировать `/admin` на api**

В `docker/web/nginx.conf`, перед блоком `location / {` добавить:

```
    location = /admin {
        proxy_pass http://api:3000;
        proxy_set_header Host $host;
    }
```

- [ ] **Step 2: vite — проксировать `/admin` на api**

В `web/vite.config.ts`, в объект `server.proxy` (рядом с `'/api'`) добавить:

```ts
      '/admin': {
        target: 'http://api:3000',
        changeOrigin: true,
      },
```

- [ ] **Step 3: Проверить**

Run: `cd web && npm run build` — сборка проходит.
Prod: `docker compose -f docker-compose.prod.yml build web` — конфиг nginx валиден (образ соберётся; nginx -t внутри контейнера).
Dev: при `docker compose up` страница `http://localhost:5173/admin` открывается через прокси.

- [ ] **Step 4: Commit**

```bash
git add docker/web/nginx.conf web/vite.config.ts
git commit -m "feat: прокси для /admin (nginx prod + vite dev)"
```

---

## Саморецензия (заполнено до сдачи)

- **Спека → задачи:** мечи (T1), дамп в БД + полный сырой стейт + доступ только админу (T2+T5+T7), admin-логин + сессия (T3), онлайн-игроки (T4), дампы на странице (T6), прокси (T8). Всё покрыто.
- **Типы/имена согласованы:** `RoomDump`, `dumpState()`, `dumpRoom(roomId, note?)`, `adminOverview()`, `connectionOpened()`, `signToken/verifyToken/authAdmin/adminSession/requireAdmin/setAdminCookie/clearAdminCookie`, `registerAdminRoutes(app, manager, dumps)`, `adminMe()`, `adminDumpRoom(roomId, note?)` — используются одинаково во всех задачах.
- **Местонахождение файлов:** `server/public/admin.html` создаётся в T3 (заглушка) и перезаписывается в T6; `docker/app/Dockerfile` копирует `public` в prod (T6).
- **Риск (осознанно):** на гексе-крепости/столице под атакой мечи рисуются поверх ⚑/★ — приемлемо, иконка мечей поверх означает «идёт бой».
