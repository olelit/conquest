# Дизайн: мечи на битвах, дамп игры в БД, admin-страница

Дата: 2026-08-18

## Обзор

Три независимые части (части 2 и 3 объединяет одна admin-сессия):

1. **Иконка скрещенных мечей** на гексах, где идёт бой (`attackerId !== null`).
2. **Дамп игры в БД** — полный сырой стейт комнаты сохраняется в PostgreSQL по нажатию кнопки; доступ только у авторизованного админа. Нужно для дебага (например: «захватил всю карту, но не могу построить крепость»).
3. **Admin-страница `/admin`** — логин (по умолчанию `admin:admin`), список игроков онлайн, список комнат с кнопкой «Дамп», список дампов с просмотром JSON.

## 1. Иконка скрещенных мечей

### 1.1 Клиент (`web/src/components/HexMap.vue`)

- На гексах с `attackerId !== null` рисуем **SVG-группу из двух скрещенных мечей** (вектор, не юникод-глиф — чёткий на любом зуме/экране).
- Показывается только пока бой идёт (выбор пользователя).
- Размещение: центр гекса со сдвигом вверх (`hexCenter(q,r).y - SWORD_DY`, `SWORD_DY ≈ 5`), чтобы не перекрываться с ⚑ крепости и ★ столицы (оба по центру).
- Отрисовка: `<g>` на гекс → внутри две подгруппы `rotate(45)` и `rotate(-45)`, в каждой — путь одного меча (лезвие, гарда, рукоять, навершие). Заливка золотая `#ffd54f`, обводка `#1a1a1a` (в стиле ★ столицы), `pointer-events: none`.
- Существующие полоска заполнения (`battleOverlay`) и кольцо прогресса (`captureState`) остаются без изменений.
- CSS-класс `.hex-swords` в scoped-стилях.

## 2. Дамп игры в БД

### 2.1 База (`server/src/db.ts`)

Новая сущность `GameDumpEntity`, таблица `game_dumps` (`synchronize: true` создаст её автоматически):

| поле | тип | описание |
|---|---|---|
| `id` | `int` PK auto | id дампа |
| `room_id` | `int` | id комнаты |
| `room_name` | `text` | имя комнаты |
| `map_type` | `text` | тип карты |
| `note` | `text` nullable | комментарий админа (почему дамп) |
| `created_at` | `timestamptz` default now | время |
| `state` | `jsonb` | полный сырой стейт |

Добавить `GameDumpEntity` в `entities` DataSource. Репозиторий `DumpsRepository`: `save(dump)`, `list()` (без `state`), `findById(id)`.

### 2.2 Полный стейт (`server/src/rooms.ts`)

`Room.dumpState(): RoomDump` — сериализация полного сырого состояния:

```ts
interface RoomDump {
  room: {
    id, name, mapType, maxPlayers, aiMode, aiCount, difficulty,
    loadTest, training, status, hostPlayerId, paused, startedAt, tickCounter,
  };
  players: PlayerState[];            // сырые: points, capital, eliminated, incomeMultiplier
  hexes: HexState[];                 // сырые: все гексы со всеми полями
  diplomacy: Record<string, DiplomacyRelation>;  // из Map — обычный объект
  pendingProposals: { from; to; kind }[];
  majorityHolderId: number | null;
  winnerId: number | null;
  slots: RoomSlot[];                 // id, name, isAi, connId, disconnected
  log: LogEntry[];
  attackStartedAt: Record<string, number>;
}
```

`RoomManager.dumpRoom(roomId): { ok: true; id: number } | { ok: false; error: string }` — находит комнату, строит `dumpState`, сохраняет через `DumpsRepository`.

### 2.3 HTTP-эндпоинт

`POST /api/admin/rooms/:roomId/dump`, тело `{ note?: string }` — требует admin-сессию, иначе `401`. Ответ: `{ ok: true, id }` или `{ ok: false, error }`.

### 2.4 Клиент (`web/src/App.vue`, `web/src/admin.ts`)

- Новый модуль `web/src/admin.ts`: `adminMe(): Promise<{ authenticated: boolean; username?: string }>` (fetch `/api/admin/me` с credentials) и `adminDumpRoom(roomId: number, note?: string): Promise<{ ok: true; id: number } | { ok: false; error: string }>`.
- В бургер-меню пункт **«Сохранить состояние в БД»** — виден только если `adminMe().authenticated` (проверка при открытии меню/монтировании).
- Клик: `const note = window.prompt(t('burger.dumpNote'), '') ?? ''` → `adminDumpRoom(room.id, note)` → в случае успеха баннер «Состояние сохранено (id=N)», иначе баннер с ошибкой.
- i18n: ключи `burger.dumpGame` (en: «Save state to DB», ru: «Сохранить состояние в БД»), `burger.dumpNote` (en: «Note (optional)», ru: «Комментарий (необязательно)»), `dump.saved` (en: «State saved (id={id})», ru: «Состояние сохранено (id={id})»).

## 3. Admin-страница `/admin`

### 3.1 Сессия (`server/src/admin.ts` — новый модуль)

- Конфиг (`server/src/config.ts`): `adminUser` (env `CONQUEST_ADMIN_USER`, default `admin`), `adminPassword` (env `CONQUEST_ADMIN_PASSWORD`, default `admin`), `adminSecret` (env `CONQUEST_ADMIN_SECRET`, default dev-строка).
- Логин: `POST /api/admin/login` `{ username, password }` → сверка с конфигом → подписанная cookie.
- Токен сессии: `base64url({ u, exp })` + `.` + HMAC-SHA256(секрет). `exp` = now + 24ч. Cookie `conquest_admin`, `HttpOnly; SameSite=Lax; Path=/`.
- Верификация: `verifyAdmin(req)` — проверка сигнатуры и срока для `/api/admin/*` (кроме `login`, `logout`, `me`).
- `POST /api/admin/logout` — сброс cookie.

### 3.2 API-эндпоинты (все кроме login/logout требуют admin)

| метод | путь | описание |
|---|---|---|
| POST | `/api/admin/login` | вход, ставит cookie |
| POST | `/api/admin/logout` | выход |
| GET | `/api/admin/me` | `{ authenticated, username }` (без 401 — используется для показа кнопки) |
| GET | `/api/admin/status` | игроки онлайн + комнаты |
| GET | `/api/admin/dumps` | список дампов без `state` |
| GET | `/api/admin/dumps/:id` | полный дамп |
| POST | `/api/admin/rooms/:roomId/dump` | сохранить дамп комнаты (см. 2.3) |

### 3.3 Онлайн-игроки

- `RoomManager` отслеживает активные подключения: `private onlineConns = new Map<number, number>` (connId → время подключения).
- `connectionOpened(connId)` — вызывается в `ws.ts` при `wss.on('connection')`; `connectionClosed` дополнительно удаляет из `onlineConns`.
- `adminOverview()` → `{ online, players, rooms }`:
  - `players`: по каждой активной сессии — `connId`, имя (Google-профиль `authProfiles[connId].name` или имя слота комнаты или `'Player'`), email (если есть), комната (id/name/status), роль (host?), время подключения.
  - `rooms`: по каждой комнате — id, name, mapType, status, aiMode, loadTest, training, paused, humans, slots, winnerId.

### 3.4 Страница

- Статичный самодостаточный HTML `server/public/admin.html` (инлайн CSS/JS, без сборки Vue).
- Отдаётся `GET /admin` из `server/src/index.ts` (или в `admin.ts`).
- Логика на JS: `adminMe()` → если нет сессии, показать форму логина; после входа — дашборд с тремя разделами (Игроки онлайн с автообновлением раз в 2с, Комнаты с кнопкой «Дамп» + поле заметки, Дампы со списком и просмотром JSON). Тёмная стилистика как у игры.

### 3.5 Прокси

- `docker/web/nginx.conf`: `location = /admin { proxy_pass http://api:3000; proxy_set_header Host $host; }`.
- `web/vite.config.ts`: добавить `/admin` → `http://api:3000` в `server.proxy` (без ws).
- `/api/*` и `/ws` уже проксируются.

## 4. Тесты

- `server`: `npm test`
  - новый тест в `rooms.test.ts` (или `admin.test.ts`): `dumpState()` возвращает полный стейт (игроки, гексы, лог, дипломатия как объект, слоты); `adminOverview()` — структура (players/rooms/online) без БД.
  - тест подписи/проверки cookie (чистые функции из `admin.ts`): корректный токен проходит, подделанный/протухший — нет.
  - БД-интеграция (реальный postgres) в юнит-тесты не включается.
- `web`: `npm run build` (типы сходятся).

## 5. Файлы

- Изменить: `server/src/config.ts`, `server/src/db.ts`, `server/src/rooms.ts`, `server/src/index.ts`, `server/src/ws.ts`, `server/test/rooms.test.ts` (+ новый `server/test/admin.test.ts`), `docker/web/nginx.conf`, `web/vite.config.ts`, `web/src/App.vue`, `web/src/types.ts` (тип `AdminMe` при необходимости), `web/src/i18n.ts`.
- Создать: `server/src/admin.ts`, `server/public/admin.html`, `web/src/admin.ts`.
- Дизайн-спек нетронутых: `rules.ts` (механика крепости/битвы не меняется).

## 6. Безопасность

- Дефолт `admin:admin` — только для разработки; в проде задать `CONQUEST_ADMIN_USER/PASSWORD` и `CONQUEST_ADMIN_SECRET`.
- Все `/api/admin/*`, кроме `login/logout/me`, требуют валидной сессии → `401`.
- Дамп-эндпоинт недоступен без admin-сессии; кнопка в игре скрыта для не-админов (но защита серверная, не только UI).
