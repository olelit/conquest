# Дизайн: статусы война/мир/союз и цветной лог

Дата: 2026-08-17

## Обзор

Две связанные части:

1. **Статусы война/мир/союз.** Проверка существующей системы: по умолчанию все игроки/компьютеры в мире друг с другом, война объявляется через дипломатию (ПКМ-меню), ИИ объявляет войну при перевесе сил. Система уже реализована — изменений не требуется, только регрессионная проверка.
2. **Цветной лог.** Лог внизу справа рендерит плоские строки без стилей. Нужно, чтобы объявление войны выделялось красным текстом, а установление мира/союза — зелёным.

## 1. Статусы (без изменений)

- По умолчанию все в мире: `relation(state, a, b)` возвращает `state.diplomacy?.get(key) ?? 'peace'` (rules.ts:557).
- Война объявляется через ПКМ по вражескому гексу → «War» (`declare-war`), ИИ — при перевесе сил (rooms.ts `maybeDeclareWar`).
- Мир/союз — через предложения (`propose`/`respond-proposal`), ИИ принимает/отклоняет по силе.
- При объявлении войны союзники обеих сторон автоматически втягиваются в войну (rules.ts `declareWar`).

## 2. Лог: структурированные записи

### 2.1 Сервер (`server/src/rooms.ts`)

- `ViewRoom.log: string[]` → `LogEntry[]`, где `LogEntry = { text: string; kind: LogKind }`, `LogKind = 'info' | 'war' | 'diplomacy'`.
- `addLog(message: string, kind: LogKind = 'info')` — без изменения механики (unshift, лимит 100).
- Объявление войны (человек, строка ~548, и ИИ, строка ~427) → `kind='war'`.
- «made peace» / «formed an alliance» (строки ~346, ~577) → `kind='diplomacy'`.
- Предложения, отказы, бои, захваты, постройки, выбывания — `kind='info'` (предложение — ещё не факт).

### 2.2 Клиент (`web/src/types.ts`, `web/src/App.vue`)

- `types.ts`: `log: string[]` → `log: RoomLogEntry[]` (`{ text, kind }`).
- `App.vue` (~617): `<div v-for="(entry, i) in room.log" :key="i" class="log-panel__entry" :class="logClass(entry.kind)">{{ entry.text }}</div>`.
- CSS: `.log-panel__entry--war { color: #ff6b6b; }` (красный), `.log-panel__entry--diplomacy { color: #69db7c; }` (зелёный). Остальные — как сейчас, `#ccc`.

### 2.3 Тесты (`server/test/rooms.test.ts`)

- 5 мест `entry.includes(...)` → `entry.text.includes(...)` (строки 148, 523, 704, 708 и др.).
- Новый тест: после `declare-war` через `handleAction` последняя запись лога имеет `kind='war'`; после принятия предложения мира — `kind='diplomacy'`.

## 3. Регрессионная проверка

- `npm test` в `server/` — все тесты зелёные.
- `npm run build` в `web/` — типы сходятся.
