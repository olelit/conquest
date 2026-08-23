# Дизайн: Google-вход, таблица users, экспорт игры админом, дипломатия ИИ

Дата: 2026-08-23. Проект: Conquest.

## Контекст и цель

Пять связанных изменений:

1. **Кнопка Google-входа не видна.** Код авторизации есть (`server/src/auth.ts`,
   `RoomManager.handleAuth`, `client.sendAuth`), но в `App.vue` блок логина
   рендерится только при заданном `VITE_GOOGLE_CLIENT_ID`. Требуется, чтобы
   кнопка входа была видна всегда.

2. **Персистентность вошедших.** Google-профиль живёт только в памяти
   (`authProfiles`). Нужна таблица `users` для хранения вошедших. Существующая
   `admin_credentials` не переименовывается (решение пользователя).

3. **Убрать файлы статистики.** Сейчас при завершении игры рекордер пишет JSON
   в `stats/` (`GameStatsRecorder.writeSummary`, `config.statsDir`,
   `Room.writeStatsIfNeeded`). Запись на диск убирается; данные остаются в
   памяти до экспорта.

4. **Экспорт прошедшей игры админом.** На экране завершения игры админ видит
   кнопку «Экспорт»: сырой стейт комнаты + события статов + сводка сохраняются
   в `game_dumps` (уже есть сырой просмотр в админке).

5. **Лог в игре.** Порядок уже правильный (новые сверху, `unshift` на сервере).
   Увеличить шрифт лога с 12px до 14px. События статов в дампе разворачиваются —
   новые сверху.

6. **Дипломатия ИИ.** ИИ объявляет войну в начале игры сразу, без плана атаки.
   Требуется: война только при реальном намерении напасть (граница + очки);
   ИИ сам предлагает мир/союз, когда это выгодно.

## Архитектура

### 1. Кнопка Google-входа (web/src/App.vue, web/src/i18n.ts)

- Блок `.menu__google` рендерится всегда:
  - `GOOGLE_CLIENT_ID` задан и вошёл → текст «Вы вошли как …» (как сейчас);
  - `GOOGLE_CLIENT_ID` задан и не вошёл → кнопка Google (`#google-btn`);
  - `GOOGLE_CLIENT_ID` не задан → обычная кнопка «Войти через Google», по клику
    показывается сообщение об ошибке конфигурации (`error.value` или локальный
    текст). Кнопка ничего не отправляет на сервер.
- Новые ключи i18n: `menu.signInGoogle` («Sign in with Google» / «Войти через
  Google»), `menu.googleNotConfigured` («Google sign-in is not configured» /
  «Google-вход не настроен»).

### 2. Таблица users (server/src/db.ts, server/src/rooms.ts, server/src/admin.ts, server/public/admin.html)

- Новая сущность `UserEntity`, таблица `users` (создаётся `synchronize: true`):

  | колонка | тип | описание |
  |---|---|---|
  | `id` | serial PK | автоинкремент |
  | `sub` | text, unique | Google subject |
  | `email` | text | email из профиля |
  | `name` | text | имя из профиля |
  | `first_seen_at` | timestamptz | первое появление |
  | `last_seen_at` | timestamptz | последний вход |

- `UsersRepository`:
  - `upsertBySub(sub, email, name)` — INSERT ... ON CONFLICT (sub) DO UPDATE
    (`email`, `name`, `last_seen_at = now()`); при вставке `first_seen_at = now()`.
    Реализация через `repo().upsert()` TypeORM с учётом колонок конфликта.
  - `list()` — все записи, новые сверху (`last_seen_at DESC`).
- `RoomManager.handleAuth`: после успешной верификации токена —
  `await usersRepository.upsertBySub(...)`. Сбой БД не роняет авторизацию
  (оборачивается в try/catch, логируется).
- Админка: защищённый `GET /api/admin/users` → `{ ok: true, users }`.
  В `admin.html` — блок «Пользователи» на вкладке «Обзор»: имя, email,
  первый/последний визит (загружается в `renderDashboard`).
- Регистрация `UserEntity` в `entities` dataSource, экспорт
  `usersRepository`.

### 3. Убрать файлы статов (server/src/stats.ts, server/src/rooms.ts, server/src/config.ts)

- `stats.ts`: удалить `writeSummary`, импорты `mkdirSync/writeFileSync/join`;
  `buildSummary()` сделать публичным.
- `rooms.ts`: удалить `writeStatsIfNeeded()` и вызовы
  (`tick()` при записи `end`, `removeRoom` в `RoomManager`); поля
  `statsWritten` больше нет.
- `config.ts`: удалить `statsDir`.
- Игровой лог не меняется: `addLog` использует `unshift` (новые сверху) —
  покрыть тестом порядок.

### 4. Экспорт прошедшей игры (server/src/rooms.ts, web/src/App.vue, web/src/admin.ts)

- `RoomDump` расширяется:
  ```ts
  stats: { events: StatsEvent[]; summary: StatsSummary };
  ```
  В `dumpState()`: `events: [...this.stats.events].reverse()` (новые сверху),
  `summary: this.stats.buildSummary()`.
- Экспорт использует существующий `POST /api/admin/rooms/:roomId/dump`
  (только admin-сессия, уже есть). Ограничений «только завершённые игры» на
  сервере не добавляем (админ может экспортировать и для дебага).
- `web/src/App.vue`: кнопка «Экспорт» на экране завершения игры —
  `winner !== null && isAdmin && room` — рядом с баннером победы/поражения,
  вызывает `adminDumpRoom(room.id)` без промпта (заметка необязательна,
  оставляем пустой). Текущая кнопка «Сохранить состояние в БД» из
  бургер-меню удаляется.
- Результат показывается тем же `dumpMsg`-баннером (id дампа или ошибка).
- Новые ключи i18n: `dump.export` («Export game data» / «Экспорт данных игры»).

### 5. Шрифт лога (web/src/App.vue)

- `.log-panel` `font-size: 12px` → `14px`.

### 6. Дипломатия ИИ (server/src/ai.ts, server/src/rooms.ts, server/test/rooms.test.ts)

Новый чистый модуль в `ai.ts`:

```ts
export type AiDiplomacyAction =
  | { type: 'declare-war'; targetId: number }
  | { type: 'propose-peace'; targetId: number }
  | { type: 'propose-alliance'; targetId: number };

export interface DiplomacyContext {
  scout: { hexCount: number; points: number } | null; // разведка о человеке
}

export function chooseDiplomacyAction(
  state: GameState,
  aiId: number,
  ctx: DiplomacyContext,
): AiDiplomacyAction | null;
```

Логика (по приоритету):

1. **Война** — только если у ИИ есть общая граница с целью (соседний гекс
   цели), `relation === 'peace'` и `ai.points >= terrainCost` самого дешёвого
   приграничного гекса цели, и цель не сильнее ИИ (hexes; при равенстве —
   points). Без границы война не объявляется.
2. **Мир** — если ИИ в войне с целью и проигрывает (его `hexCount <
   hexCount` цели), и мир уже не предлагался недавно (кулдаун).
3. **Союз** — если не воюет и не в союзе с целью, цель не выбыла, и выгодно:
   - у цели есть война с кем-то третьим (общий враг), либо
   - ИИ слабее цели (защита сильным союзником), либо
   - есть третий игрок сильнее обоих.
   Не предлагать союз, если между ИИ и целью уже есть входящее/исходящее
   предложение союза (дедупликацию по `pendingProposals` делает `rooms.ts`
   перед применением действия — чистая функция её не знает).

Порядок проверки: сначала война, затем мир, затем союз.

`rooms.ts`:
- `maybeDeclareWar` заменяется на `handleAiDiplomacy(state, aiId)`:
  - вызывает `chooseDiplomacyAction` с `scoutCache`;
  - `declare-war` → `rules.declareWar` + лог kind=war
    («X declared war on Y»);
  - `propose-peace` → если такого предложения ещё нет в `pendingProposals` —
    push + лог kind=diplomacy («X proposes peace to Y») + запись кулдауна
    предложения (`proposalCooldowns: Map<string, number>`, 30 с);
  - `propose-alliance` → аналогично.
- `aiAcceptsProposal` остаётся (принимает мир/союз при равенстве сил или
  войне), кулдаун мира (`peaceCooldowns`) сохраняется.
- Дедупликация: `pendingProposals.some(from/to/kind)` уже есть —
  ИИ не дублирует активные предложения.

Тесты (`server/test/rooms.test.ts`):
- обновить «агрессия ИИ: объявляет войну без общей границы при перевесе» →
  теперь войны нет без границы;
- обновить «агрессия ИИ: объявляет войну при перевесе сил» → цель
  прилегает к ИИ;
- добавить: война не объявляется, если очков не хватает на атаку;
- добавить: ИИ предлагает мир, когда проигрывает;
- добавить: ИИ предлагает союз, когда это выгодно;
- добавить: ИИ не спамит предложения (кулдаун);
- добавить: порядок лога — новые записи в начале массива.

## Обработка ошибок

- Сбой `usersRepository` при входе: логируем, авторизацию не блокируем.
- Сбой экспорта: существующий `dumpRoom` уже возвращает
  `{ ok: false, error }` и 404/500.
- `chooseDiplomacyAction` — чистая функция, исключений не бросает.

## Тестирование

- `server/test/rooms.test.ts` — дипломатия ИИ (выше), порядок лога,
  `dumpState().stats` содержит события и сводку (обновить существующий
  тест дампа).
- `server/test/stats.test.ts` — удалить тесты `writeSummary` (файловой
  записи), оставить `buildSummary`.
- Новый тест `usersRepository.upsertBySub` (idempotent: повторный вход не
  создаёт дубль) — в `server/test/db.test.ts`, если такой файл есть, иначе
  в отдельном `users`-тесте с mock-репозиторием.
- `server/test/rooms.test.ts`/`ai`-тесты для `chooseDiplomacyAction` как
  чистой функции (в `server/test/ai.test.ts`).
- Ручная проверка: вход через Google → строка в таблице `users`; победа →
  кнопка «Экспорт» у админа → дамп в админке с `stats.events` (новые сверху)
  и `summary`; в `stats/` файлы не появляются.

## Затрагиваемые файлы

- `server/src/db.ts` — `UserEntity`, `UsersRepository`, регистрация.
- `server/src/rooms.ts` — handleAuth upsert; удаление writeStatsIfNeeded;
  dumpState + stats; handleAiDiplomacy; proposalCooldowns.
- `server/src/stats.ts` — удаление файловой записи, публичный buildSummary.
- `server/src/config.ts` — удаление statsDir.
- `server/src/ai.ts` — chooseDiplomacyAction + типы.
- `server/src/admin.ts` — GET /api/admin/users.
- `server/public/admin.html` — блок «Пользователи».
- `web/src/App.vue` — кнопка Google всегда, кнопка «Экспорт» на экране
  завершения, шрифт лога.
- `web/src/i18n.ts` — новые ключи.
- `web/src/admin.ts` — без изменений (adminDumpRoom уже есть).
- `server/test/rooms.test.ts`, `server/test/stats.test.ts`,
  `server/test/ai.test.ts` — тесты.

## Вне объёма (YAGNI)

- Логаут из Google-аккаунта.
- Список `users` в отдельной вкладке админки (достаточно блока на «Обзор»).
- Персистентность логов игр вне дампов.