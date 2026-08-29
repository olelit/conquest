# Дизайн: логин по паролю, фидбек, войны ИИ, карта обучения, панель дипломатии, доход по террейну, карты в БД

Дата: 2026-08-30. Проект: Conquest.

## Контекст и цель

Восемь связанных изменений:

1. **Вход по логину и паролю.** Google-вход убирается полностью. Пользователь
   регистрируется и входит по логину/паролю; сессия — HMAC-токен (по образцу
   админки), хранится в localStorage.
2. **Фидбек** — доделать по готовому плану `2026-08-19-feedback-form.md`:
   серверная часть написана, но не подключена (index.ts, админ-роуты,
   клиентская форма, вкладка админки, фикс зависающего теста).
3. **Войны ИИ в нагрузочном тесте.** ИИ никогда не объявляет войну из-за
   «правила зазора»: мирные соседи не могут захватить гекс, примыкающий к
   территории другого, поэтому между территориями всегда остаётся 1 нейтральный
   гекс, а для войны требуется прямая граница. Тупик: все ИИ застревают на
   ~12 гексах и спамят предложения союза.
4. **Карта обучения меньше.** Обучение стартует на обычной карте 16×12 —
   враг далеко, этап «атакуй вражеский гекс» требует десятков захватов.
5. **Принять/отклонить союз и мир из панели.** Сейчас предложения видны только
   в логе; ответить можно лишь через контекстное меню вражеского гекса.
6. **Доход по типу гекса.** Сейчас любой гекс даёт +2, шахта +3 бонус —
   горы и пустыни дают столько же, сколько равнины.
7. **Карты в базе данных.** Сейчас пресеты карт захардкожены в `map.ts`.
   Таблица `maps` + кэш определений в памяти — фундамент для будущего
   создания карт из админки (сами CRUD-роуты — вне объёма).
8. **Три новые сухопутные карты** в духе реальной географии (без воды):
   «Материки» (два материка с перешейком), «Полуостров», «Хребет»
   (горная гряда по центру).

## 1. Вход по логину и паролю

### Таблица users (server/src/db.ts)

К существующим колонкам (`id`, `sub`, `email`, `name`, `first_seen_at`,
`last_seen_at`) добавляются:

| колонка | тип | описание |
|---|---|---|
| `login` | text, unique, nullable | логин локального пользователя |
| `password_hash` | text, nullable | scrypt-хэш (для Google-юзеров null) |
| `session_secret` | text, nullable | секрет подписи токена (для локальных) |

Для локальных пользователей `sub = 'local:' + login` (остаётся unique).
Существующие Google-строки не трогаются.

`UsersRepository`:
- `findByLogin(login: string): Promise<UserEntity | null>` — по login
  (lowercase);
- `createLocal(login, passwordHash, sessionSecret): Promise<UserEntity>`;
- `upsertBySub` — остаётся, используется при каждом входе (обновляет
  `name`, `last_seen_at`);
- `list()` — возвращает все колонки (админка покажет логин).

### Токены сессии (server/src/auth.ts — переписывается)

Google-верификация (`verifyGoogleIdToken`, JWKS) удаляется. Вместо неё —
HMAC-токен по образцу `admin.ts` (`signToken`/`verifyToken`):

```ts
export interface SessionPayload { u: string; exp: number }
export function parseSessionToken(token: string): { u: string } | null; // без проверки подписи
export function signSessionToken(login: string, secret: string): string;
export function verifySessionToken(token: string, secret: string): { u: string } | null;
```

Формат: `base64url(JSON {u, exp}) + '.' + base64url(HMAC-SHA256(secret, body))`,
TTL 24 часа. `parseSessionToken` разбирает тело без проверки подписи — чтобы
узнать логин и найти секрет пользователя в БД.

### Эндпоинты (новый server/src/auth-routes.ts)

`registerAuthRoutes(app, users: UsersRepository): void`:

`POST /api/auth/register` (публичный):
- `login`: string, trim, lowercase, 3–32 символа, только `[a-z0-9_-]`;
  иначе 400 `{ ok: false, error: 'invalid-login' }`;
- `password`: string, 6–128 символов; иначе 400 `{ ok: false, error:
  'invalid-password' }`;
- логин занят → 409 `{ ok: false, error: 'login-taken' }`;
- успех: `hashPassword` + `sessionSecret = randomBytes(32).base64url`,
  `createLocal` → `{ ok: true, token, name: login }` (авто-вход, отдельного
  логина после регистрации не нужно).

`POST /api/auth/login` (публичный):
- пользователь не найден или `password_hash` null → 401
  `{ ok: false, error: 'invalid-credentials' }`;
- `verifyPassword` не прошёл → 401;
- успех: `upsertBySub(sub, email, name)` (обновить `last_seen_at`) →
  `{ ok: true, token, name: login }`.

### WS-авторизация (server/src/rooms.ts, server/src/ws.ts)

`RoomManager.handleAuth(connId, token)`:
- `parseSessionToken` → `users.findByLogin(u)` → `verifySessionToken(token,
  user.sessionSecret)`; любая неудача → `{ ok: false, error: 'Invalid session
  token' }`; сбой БД → `{ ok: false, error: 'Login failed' }` (логируется);
- успех: `authProfiles.set(connId, { sub: user.sub, email: user.email ?? '',
  name: user.name ?? user.login })` + `upsertBySub`.

Новый `RoomManager.logout(connId)` — удаляет профиль из `authProfiles`.
В `ws.ts` case `'logout'` → `manager.logout(connId)` + broadcast.

### Клиент (web/src/App.vue, web/src/api.ts, web/src/i18n.ts)

- Из `App.vue` удаляется всё Google: объявление `window.google`,
  `GOOGLE_CLIENT_ID`, `initGoogleButton`, `onGoogleNotConfigured`, загрузка
  скрипта gsi, блок `.menu__google`; i18n-ключи `menu.signInGoogle`,
  `menu.googleNotConfigured` — удалить.
- Вместо блока Google — форма: инпуты «Логин» и «Пароль», кнопки
  «Войти» и «Регистрация», строка ошибки.
- `api.ts`: `GameClient` получает `setAuthToken(token: string | null)`;
  в `ws.onopen` при наличии токена отправляется `{ type: 'auth', token }`.
- `App.vue`: `loginOpen`/`login`/`password`/`authError` refs; функции
  `submitLogin(register: boolean)` — fetch на `/api/auth/login` или
  `/api/auth/register`, при успехе `localStorage.setItem('conquest.authToken',
  token)` + `client.setAuthToken(token)` + `client.sendAuth(token)`;
  при `connected` уже после открытия WS — просто `sendAuth`.
- При старте (`onMounted` перед `client.connect()`): токен из localStorage →
  `client.setAuthToken(token)`; после первого `onopen`/broadcast `auth`
  заполнится автоматически.
- Кнопка «Выйти» рядом с «Вы вошли как …»: удаляет токен из localStorage,
  `client.setAuthToken(null)`, `client.sendLogout()`.
- Новые i18n-ключи: `menu.login`, `menu.password`, `menu.signIn`,
  `menu.register`, `menu.logout`, `menu.loggedInAs` (существует),
  `auth.errorInvalid` («Invalid login or password» / «Неверный логин или
  пароль»), `auth.errorTaken` («Login is already taken» / «Логин уже занят»),
  `auth.errorValidation` («Login 3–32 chars, password 6+ chars» / «Логин
  3–32 символа, пароль от 6»), `auth.errorNetwork` («Network error» /
  «Ошибка сети»).

`AuthProfile` (web/src/types.ts) остаётся `{ sub, email, name }` — для
локальных `email = ''`.

## 2. Фидбек (доделать)

По плану `2026-08-19-feedback-form.md` (Tasks 4–6), с поправкой на текущее
состояние кода:

- `server/src/index.ts`: импортировать `registerFeedbackRoutes` из
  `feedback.js` и `SlidingWindowLimiter` из `rate-limit.js`; в `main()`:
  `const feedbackLimiter = new SlidingWindowLimiter(60000);
  registerFeedbackRoutes(app, feedbackRepository, feedbackLimiter,
  config.feedbackRateLimit);` + `setInterval(() => feedbackLimiter.sweep(),
  60000)`.
- `server/src/admin.ts`: `registerAdminRoutes` получает 6-й аргумент
  `feedback: FeedbackRepository`; три защищённых роута:
  `GET /api/admin/feedback`, `POST /api/admin/feedback/:id/read`,
  `DELETE /api/admin/feedback/:id` (валидация id → 400, отсутствие → 404).
- `server/test/admin-http.test.ts`: добавить 6-й стаб-аргумент.
- `server/test/feedback-http.test.ts`: починить зависание `afterAll`
  (keep-alive соединения fetch): `server.close()` + `server.closeAllConnections()`;
  добавить админ-тесты (логин, список, read, delete, 401).
- `web/src/App.vue`: кнопка «Фидбек» на главном меню + модалка (textarea,
  maxlength 2000, статусы sent/error/rateLimited/tooLong) — код из плана
  Task 5.
- `web/src/i18n.ts`: ключи `menu.feedback`, `feedback.*` (en/ru) — из плана.
- `server/public/admin.html`: вкладка «Отзывы» (список, «Прочитано»,
  «Удалить», подсветка непрочитанных) — код из плана Task 6.

## 3. Войны ИИ (server/src/ai.ts, server/test/ai.test.ts, server/test/rooms.test.ts)

Причина: см. контекст. Фикс — разрешить объявление войны через зазор.

В `chooseDiplomacyAction` заменить поиск прямой границы на контактную зону:

```ts
// гекс цели в контактной зоне: примыкает к ИИ напрямую,
// либо соседствует с нейтральным гексом, примыкающим к ИИ (зазор в 1 гекс)
function inContactZone(state: GameState, hex: HexState, aiId: number): boolean {
  if (hasAdjacentOwner(state, hex.q, hex.r, aiId)) return true;
  for (const [dq, dr] of NEIGHBOR_OFFSETS) {
    const n = findHex(state, hex.q + dq, hex.r + dr);
    if (n === undefined || n.ownerId !== null) continue;
    if (hasAdjacentOwner(state, n.q, n.r, aiId)) return true;
  }
  return false;
}
```

Ветка войны: среди гексов цели выбирается самый дешёвый гекс контактной зоны
(для порога очков). Условия «сильнее цели» и «хватает очков» — без изменений.

Ветка союза: пропускать цели с 0 гексов (`targetStr.hexes < 1`) — ИИ не
предлагает союз игроку без территории (убирает спам в нагрузочном тесте).

Тесты:
- `ai.test.ts`: война объявляется через зазор в 1 нейтральный гекс;
  войны нет, если между территориями 2+ нейтральных гекса (вне зоны);
  союз не предлагается цели с 0 гексов.
- `rooms.test.ts`: существующие тесты «агрессия ИИ» остаются зелёными
  (прямое соседство по-прежнему работает); добавить интеграционный тест:
  территория ИИ и человека разделены одним нейтральным гексом → война.

## 4. Карта обучения 9×7 (server/src/map.ts, web/src/App.vue, web/src/types.ts, web/src/i18n.ts)

- Новый пресет карты `tutorial`: rect, columns 9, rows 7, minPlayers 2,
  maxPlayers 2 (см. раздел 7 — это строка в `DEFAULT_MAPS`).
- `App.vue` `startTutorial()`: `client.sendStartSolo('tutorial', 1, 'easy',
  true)`.
- `types.ts`: `MapType` расширяется (см. раздел 7); `MAP_INFO.tutorial` с
  флагом `hidden: true` — не показывается в списках выбора карт
  (в шаблонах фильтр `!info.hidden`).
- i18n: `map.tutorial` («Tutorial» / «Обучение»), `map.tutorialDesc`
  («small 9×7 map» / «маленькая карта 9×7»).

## 5. Панель дипломатии (server/src/rooms.ts, server/src/ws.ts, web/src/api.ts, web/src/types.ts, web/src/App.vue, web/src/i18n.ts)

### Сервер

`Room.handleAction` case `'respond-proposal'`: предложение находится по
`msg.playerId` (число), если передан, иначе как сейчас — по координатам
`q/r` владельца гекса:

```ts
const proposer = typeof msg.playerId === 'number'
  ? msg.playerId
  : this.targetPlayerId(playerId, msg);
```

`ws.ts` `WsMessage` + `playerId?: number`. Контекстное меню продолжает
работать через `q/r`.

### Клиент

- `types.ts`: `ClientMessage` — вариант
  `{ type: 'respond-proposal'; playerId: number; accept: boolean }`.
- `api.ts`: `sendRespondProposalTo(playerId: number, accept: boolean)`.
- `App.vue`: `incomingProposals` = `game.pendingProposals.filter(p => p.to ===
  playerId)`. Панель слева под HUD (fixed, `left: 16px; top: 130px`, z-index
  25): для каждого входящего предложения строка «{имя} предлагает
  {союз/мир}» + кнопки «Принять» / «Отклонить» → `sendRespondProposalTo`.
  Имя — из `game.players`. Панель скрыта в load test.
- i18n: `diplomacy.proposes` («{name} proposes {kind}» / «{name} предлагает
  {kind}»), `diplomacy.peace` («peace» / «мир»), `diplomacy.alliance`
  («alliance» / «союз»), `diplomacy.accept` («Accept» / «Принять»),
  `diplomacy.decline` («Decline» / «Отклонить»).

## 6. Доход по типу гекса (server/src/config.ts, server/src/rules.ts, web/src/types.ts, web/src/components/HexMap.vue, server/test/rules.test.ts)

Конфиг: вместо `incomePerHex` + `mineIncomeBonus` — таблица
`terrainIncomes` (env `CONQUEST_INCOME_GRASS` и т.д.):

| terrain | доход |
|---|---|
| grass | 2 |
| desert | 1 |
| forest | 3 |
| water | 1 |
| mountain | 4 |
| mine | 6 |

`rules.ts`: удалить `INCOME_PER_HEX`/`MINE_INCOME_BONUS`, добавить
`INCOME_BY_TERRAIN = config.terrainIncomes`; `playerIncome`:
`INCOME_BY_TERRAIN[hex.terrain]`. HUD и всё остальное считает через
`playerIncome` — не меняется. Проверить grep по удалённым константам
(stats.ts, rooms.ts, тесты).

Клиент: `TERRAIN_INCOMES` в `types.ts` (по образцу `TERRAIN_COSTS`).
`HexMap.vue`: на каждом гексе подпись `+N` (`TERRAIN_INCOMES[hex.terrain]`)
— мелкий текст в нижней части гекса (y = центр + 12), класс `hex-income`,
полупрозрачный белый со штрихом. Шахты и доходные гексы выделяются цветом
текста (#ffd54f для доход ≥ 4). Надпись не перекрывает ★/⚑ (они по центру)
и мечи (сдвиг вверх).

Тесты `rules.test.ts`: обновить тесты дохода на таблицу
(2/1/3/1/4/6).

## 7. Карты в БД (server/src/map.ts, server/src/db.ts, server/src/index.ts, server/src/rooms.ts, server/src/admin.ts, server/src/ws.ts, server/test/map.test.ts, server/test/rooms.test.ts)

### map.ts — определения

```ts
export type MapShape = 'rect' | 'ellipse' | 'circle' | 'blobs' | 'ridge';
export interface Blob { x: number; y: number; rx: number; ry: number }
export interface MapParams {
  rx?: number; ry?: number;        // ellipse
  radius?: number;                 // circle
  blobs?: Blob[];                  // blobs — материки
  ridge?: { a: { q: number; r: number }; b: { q: number; r: number }; width: number }; // ridge
}
export interface MapDefinition {
  key: string; name: string; shape: MapShape;
  columns: number; rows: number;
  minPlayers: number; maxPlayers: number; recommendedAi: number;
  qOffset: number; params: MapParams;
}
export type MapType = string; // ключ карты (из БД); без union — новые карты не требуют кода
```

`DEFAULT_MAPS: MapDefinition[]` — 8 карт (сид для БД и кэш по умолчанию):

| key | name | shape | columns×rows | players | params |
|---|---|---|---|---|---|
| normal | Normal | rect | 16×12 | 2–5 | {} |
| long | Long | rect | 24×9 | 2–4 | {} |
| island | Island | ellipse | 15×13 | 2–4 | rx 7, ry 6 |
| round | Round | circle | 19×19 | 2–6 | radius 9 |
| continents | Continents | blobs | 22×14 | 2–5 | см. ниже |
| peninsula | Peninsula | blobs | 18×14 | 2–4 | см. ниже |
| ridge | Ridge | ridge | 18×12 | 2–4 | см. ниже |
| tutorial | Tutorial | rect | 9×7 | 2–2 | {} |

Новые карты (детерминированные, без воды):

- **continents** («Материки»): западный материк `{x:7, y:7, rx:5.5, ry:6}`
  + выступ `{x:10, y:3.5, rx:2.8, ry:2.5}`; восточный `{x:16.5, y:8.5,
  rx:4.5, ry:4}`; перешеек `{x:13, y:7.5, rx:2.2, ry:1.2}` — узкий мост,
  стратегическое бутылочное горло.
- **peninsula** («Полуостров»): материк `{x:8, y:4, rx:7, ry:4.5}`;
  основание полуострова `{x:9.5, y:8, rx:2.5, ry:1.5}`; длинный тонкий
  полуостров на юг `{x:10, y:10.5, rx:1.6, ry:3}` (как Италия).
- **ridge** («Хребет»): всё суша, гряда гор по вертикали `{a:{q:9,r:0.5},
  b:{q:9,r:11.5}, width:1.4}` — гексы ближе width к отрезку получают terrain
  `mountain` (с шансом мины), остальные — обычный randomTerrain.

`generateMap(def: MapDefinition): Hex[]` — работает по определению:
`isLand(def, q, r)` по shape; для `circle` — отсечка `isInCircle(def)`;
`terrainAt(def, q, r)` — для `ridge` сначала проверка гряды. Логика
`randomTerrain` не меняется.

Кэш определений (в map.ts же):

```ts
let catalog = new Map<string, MapDefinition>(DEFAULT_MAPS.map((m) => [m.key, m]));
export function setMapCatalog(defs: MapDefinition[]): void; // полная замена
export function getMap(key: string): MapDefinition | null;
export function listMaps(): MapDefinition[];
```

### db.ts

`MapEntity` (таблица `maps`): `id` serial PK, `key` text unique, `name` text,
`shape` text, `columns`/`rows`/`minPlayers`/`maxPlayers`/`recommendedAi`/
`qOffset` int, `params` jsonb default `{}`, `enabled` boolean default true,
`created_at` timestamptz default now(). Регистрация в entities.

`MapsRepository`:
- `list(): Promise<MapEntity[]>` — все (ORDER BY id);
- `ensureSeeded(defs: MapDefinition[]): Promise<void>` — INSERT ... ON
  CONFLICT (key) DO NOTHING для отсутствующих (сид стандартных карт).

### Проводка

- `index.ts` / `initDb()` (db.ts): после инициализации БД —
  `setMapCatalog(await mapsRepository.list() → MapDefinition[])` (entity →
  definition; `enabled === false` отфильтровывается). В тестах БД нет —
  кэш остаётся `DEFAULT_MAPS`, все существующие тесты работают без изменений.
- `rooms.ts`: `MAP_PRESETS` → `getMap()`: валидация типа карты и лимитов
  игроков в `createRoom`/`createSolo`; `start()`/`restart()` берут
  `columns/rows/qOffset` из определения; `buildHexes()` →
  `generateMap(def)`. `RoomView.mapType`/`RoomDump` — string.
- `admin.ts`: защищённый `GET /api/admin/maps` → `{ ok: true, maps:
  listMaps() }` (для проверки миграции; UI не добавляем).
- `ws.ts`: `mapType` — string без изменений.

### Клиент

`types.ts`: `MapType` — union известных ключей:
`'normal' | 'long' | 'island' | 'round' | 'continents' | 'peninsula' |
'ridge' | 'tutorial'`; `MAP_INFO` дополняется записями continents/peninsula/
ridge (+tutorial hidden). i18n: `map.continents`/`map.continentsDesc`
(«Continents» / «Материки», «two continents with an isthmus» / «два материка
с перешейком»), `map.peninsula`/`map.peninsulaDesc` («Peninsula» /
«Полуостров», «mainland with a peninsula» / «материк с полуостровом»),
`map.ridge`/`map.ridgeDesc` («Ridge» / «Хребет», «continent divided by a
mountain ridge» / «континент, разделённый горной грядой»).

## Обработка ошибок

- Логин: невалидные входные данные → 400/401/409 с кодами ошибок; сбой БД
  при регистрации/входе → 500 `{ ok: false, error: 'server' }`, логируется.
- WS-авторизация: неверный/протухший токен → error «Invalid session token»;
  сбой БД → «Login failed» (не блокирует игру, но вход не проходит).
- Фидбек: как в плане (400/429/500).
- Карты: `getMap(key)` вернул null → «Unknown map type» (существующее
  поведение); сбой сида карт в БД логируется, сервер продолжает работу с
  `DEFAULT_MAPS`.
- Панель дипломатии: `playerId` вне комнаты/без предложения → существующие
  ошибки валидации.

## Тестирование

- `server/test/auth-http.test.ts` (новый, паттерн `feedback-http.test.ts`,
  стаб-репозиторий): регистрация (успех, короткий логин/пароль, занятый
  логин 409), логин (успех, неверный пароль 401, неизвестный логин 401),
  токен подписывается/проверяется (`verifySessionToken`).
- `server/test/ai.test.ts`: война через зазор, нет войны вне зоны, союз не
  предлагается без территории.
- `server/test/rooms.test.ts`: война ИИ через зазор (интеграционно),
  `respond-proposal` по `playerId`.
- `server/test/map.test.ts`: переписать под `generateMap(def)`; новые карты:
  continents — суша связна (один компонент через перешеек), peninsula —
  суша связна и есть узкий «хвост», ridge — по центру гряда гор
  (колонка 9 — только mountain/mine), tutorial — ровно 9×7.
- `server/test/rules.test.ts`: доход по таблице.
- `server/test/feedback-http.test.ts`: фикс afterAll + админ-роуты.
- `server/test/admin-http.test.ts`: 6-й аргумент + GET /api/admin/maps.
- Web: `npm run build` (vue-tsc).

## Затрагиваемые файлы

- Сервер: `auth.ts` (переписать), `auth-routes.ts` (новый), `db.ts`,
  `config.ts`, `index.ts`, `admin.ts`, `feedback.ts` (есть), `rate-limit.ts`
  (есть), `ai.ts`, `map.ts`, `rooms.ts`, `rules.ts`, `ws.ts`.
- Тесты: `auth-http.test.ts` (новый), `ai.test.ts`, `rooms.test.ts`,
  `map.test.ts`, `rules.test.ts`, `admin-http.test.ts`, `feedback-http.test.ts`.
- Web: `App.vue`, `api.ts`, `types.ts`, `i18n.ts`, `HexMap.vue`.
- `server/public/admin.html`.

## Вне объёма (YAGNI)

- CRUD карт из админки (только GET /api/admin/maps; архитектура готова).
- Смена пароля/логина игроком.
- Rate limit на попытки входа.
- Персистентность сессий между рестартами сервера (токен инвалидируется,
  пользователь входит заново).