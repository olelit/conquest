# Дизайн: авто-сохранение статов игры в БД, длительность ошибок, крепость раньше

Дата: 2026-08-23. Проект: Conquest.

## Контекст и цель

Три изменения поверх предыдущей работы (google-вход/users/экспорт/дипломатия ИИ):

1. **Статы завершённых игр сейчас живут только в памяти** рекордера и попадают
   в БД лишь при ручном экспорте админом. Требуется: при завершении игры и при
   удалении брошенной комнаты автоматически сохранять дамп (стейт + лог +
   `stats.events` + сводка) в существующую таблицу `game_dumps` с пометкой
   «авто». Список и сырой просмотр — уже в админке (вкладка «Обзор», блок
   «Дампы»); добавить бейдж «авто».

2. **Ошибки действий (например «не могу захватить клетку») отображаются
   меньше тика**: `client.onState` обнуляет `error` при каждом броадкасте
   (~500 мс), а действие с ошибкой не шлёт state. Требуется: показывать ошибку
   не менее ~3.5 с.

3. **Крепость доступна слишком поздно** (первая — с 15 гексов,
   `fortressLimit = floor(hexCount / 15)`). Требуется: первая крепость с
   10 гексов (`floor(hexCount / 10)`).

## Архитектура

### 1. Авто-сохранение в game_dumps

**DB (`server/src/db.ts`):**
- В `GameDumpEntity` добавляется колонка `auto` (boolean, default false) —
  `synchronize: true` добавит её существующей таблице.
- `DumpsRepository.save(dump)` принимает `auto?: boolean`;
  `list()` дополнительно возвращает `auto`.

**Комната (`server/src/rooms.ts`):**
- Новый метод `Room.dumpToDb(): Promise<void>`:
  - guard `if (this.autoDumped) return;` → `this.autoDumped = true;`
  - `try { await dumpsRepository.save({ roomId, roomName, mapType, note: null, auto: true, state: this.dumpState() }); } catch (err) { console.error('auto dump failed:', err); }`
- Поле `private autoDumped = false;` сбрасывается в `start()` и `restart()`
  (после рестарта вторая игра тоже сохраняется).
- Триггеры:
  - **завершённая игра:** в `tick()`, в блоке `if (state.winnerId !== null)` —
    после записи `end`-события в рекордер (чтобы дамп содержал его):
    `void this.dumpToDb();`
  - **брошенная игра:** в `RoomManager.removeRoom`, перед удалением из
    `rooms` — только если `room.stats.events.length > 0` (игра стартовала,
    `start()` пишет `start`-событие) и авто-дамп ещё не сделан (флаг
    `autoDumped`); вызов `void room.dumpToDb();` — fire-and-forget.
- Ручной экспорт (кнопка «Экспорт» / `RoomManager.dumpRoom`) не меняется
  (`auto: false` по умолчанию) и не трогает флаг `autoDumped`.

**Админка (`server/public/admin.html`):**
- В таблице дампов в строке дампа — бейдж «авто», если `d.auto`
  (рядом с существующими бейджами). Сырой просмотр без изменений.

**Тесты (`server/test/rooms-auto-dump.test.ts`, новый):**
- `vi.mock('../src/db.js', ...)` с фейком `dumpsRepository.save` и
  `usersRepository` (rooms.ts импортирует оба); фейк возвращает id.
- Тесты:
  1. завершённая игра (winnerId установлен, `room.tick()`) → `save` вызван
     один раз с `auto: true` и `state.stats.events` (новые сверху);
  2. брошенная комната (через `RoomManager`: комната в игре, человек вышел
     (`leaveRoom`), `tickAll()` удаляет её) → `save` вызван;
  3. рестарт: финиш → save; `restart()`; второй финиш → второй save
     (флаг сброшен);
  4. нестартовавшая (waiting) комната удаляется без save;
  5. ожидание асинхронного вызова — `vi.waitFor(() => expect(save).toHaveBeenCalled())`.

### 2. Длительность ошибок (web/src/App.vue)

- Убрать `error.value = null;` из `client.onState`.
- В `client.onError`:
  ```ts
  client.onError = (message) => {
    error.value = message;
    window.clearTimeout(errorTimer);
    errorTimer = window.setTimeout(() => {
      error.value = null;
    }, 3500);
  };
  ```
- `let errorTimer: number | undefined;` в `<script setup>` рядом с `error`.
- Прочие состояния (баннеры `dumpMsg`, `googleMsg`) не меняются.

### 3. Крепость раньше (порог 15 → 10)

- `server/src/rules.ts:96` — `fortressLimit`: `Math.floor(hexCount / 15)` →
  `Math.floor(hexCount / 10)`.
- `server/test/rules.test.ts:889` — `expect(fortressLimit(15)).toBe(1)` →
  `expect(fortressLimit(10)).toBe(1)` (и `fortressLimit(9)).toBe(0)`).
- `web/src/components/ContextMenu.vue:33` — `Math.floor(props.hexCount / 15)` →
  `Math.floor(props.hexCount / 10)` (дубль лимита на клиенте).
- `web/src/training.ts:72` — `Math.floor(hexCount / 15)` →
  `Math.floor(hexCount / 10)` (дубль лимита).
- `web/src/i18n.ts` `cm.fortressHint` — en: «Need 10+ hexes and limit
  headroom», ru: «нужно 10+ клеток и запас лимита».
- Существующие тесты крепости (15 гексов, лимит 1) не ломаются:
  `floor(15/10) = 1`.

## Обработка ошибок

- Сбой БД при авто-дампе: try/catch + `console.error`; игра и удаление
  комнаты не зависят от результата сохранения (fire-and-forget).
- Повторные срабатывания исключены флагом `autoDumped` (и для финиша, и для
  удаления комнаты) — не более одного авто-дампа на партию.
- Таймер ошибок в `onError` сбрасывается на новой ошибке; устаревшее
  сообщение не затирает свежее.

## Тестирование

- `server/test/rooms-auto-dump.test.ts` — новый (5 тестов, выше).
- `server/test/rules.test.ts` — обновить тест `fortressLimit`.
- `web`: `npm run build` (vue-tsc) — проверка типов после правок
  ContextMenu.vue/training.ts/App.vue.
- Существующие тесты крепости и дампов (rooms.test.ts) — зелёные без правок.
- Ручная проверка: сыграть партию до победы → в админке дамп с бейджем
  «авто» и событиями; бросить партию (выйти из комнаты) → авто-дамп;
  ошибка «не могу захватить» видна ~3.5 с; крепость доступна с 10 гексов.

## Затрагиваемые файлы

- `server/src/db.ts` — колонка `auto`, save/list.
- `server/src/rooms.ts` — `dumpToDb`, `autoDumped`, триггеры.
- `server/test/rooms-auto-dump.test.ts` — новый.
- `server/test/rules.test.ts` — тест лимита крепости.
- `server/src/rules.ts` — `fortressLimit`.
- `web/src/App.vue` — таймер ошибок, `onState`.
- `web/src/components/ContextMenu.vue`, `web/src/training.ts` — порог 10.
- `web/src/i18n.ts` — текст подсказки крепости.
- `server/public/admin.html` — бейдж «авто».

## Вне объёма (YAGNI)

- Отдельная таблица `game_stats` (решение пользователя — авто-дамп в
  `game_dumps`).
- Изменение порога/экономики крепости (только доступность).
- Рефакторинг клиентских дублей констант лимитов в общий модуль.