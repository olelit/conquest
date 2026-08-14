# Дизайн: крепость — постройка на своём гексе

Дата: 2026-08-14

## Обзор

Здание на своём гексе: защищает гекс и его соседей (атакующий теряет на четверть больше юнитов), уменьшает лимит очков на 100 за каждую крепость, имеет лимит построек от размера территории, уничтожается при смене владельца гекса. Строится и сносится через ПКМ-меню, на гексе — иконка.

## 1. Данные (rules.ts)

- `HexState.fortress: boolean` (по умолчанию `false`).
- `export function fortressLimit(hexCount: number): number` — `Math.floor(hexCount / 15)`.
- `export function fortressCount(state: GameState, playerId: number): number` — гексы `ownerId === playerId && fortress`.
- `pointLimit` становится `pointLimit(count: number, fortresses = 0): number` = `BASE_POINTS + count * LIMIT_PER_HEX - 100 * fortresses` (не ниже 0). Обновить все вызовы (applyIncome, view).
- `export function isFortressProtected(state: GameState, hex: HexState): boolean` — `hex.fortress` ИЛИ соседний гекс с `fortress`, владелец которого = обороняющийся в битве за этот гекс (`hex.defenderId ?? hex.ownerId`).

## 2. Постройка/снос (rules.ts)

- `export function validateBuildFortress(state, playerId, q, r): ActionValidation`:
  - гекс существует и `ownerId === playerId`;
  - `attackerId === null` (не идёт битва);
  - `!hex.fortress`;
  - `fortressCount(state, playerId) < fortressLimit(hexCount(state, playerId))`;
  - `player.points <= pointLimit(count, fortresses + 1)` — иначе «Сначала потрать очки: крепость уменьшает лимит».
- `export function buildFortress(state, playerId, q, r): void` — `hex.fortress = true`.
- `export function validateRemoveFortress(state, playerId, q, r): ActionValidation` — гекс свой и `fortress`.
- `export function removeFortress(state, playerId, q, r): void` — `hex.fortress = false`.

## 3. Уничтожение при смене владельца

Во всех местах, где `hex.ownerId` присваивается другому игроку или `null`, снимать `hex.fortress = false`:
- `tickBattles` (обе ветки победы);
- `applyCapture` (мгновенный захват — нейтральный гекс, флага нет, но снять на всякий случай);
- `applyCut` (нейтрализация);
- `applyEnclosure` (захват региона);
- `eliminateIfCapitalLost` (нейтрализация и передача новым ИИ);
- sweep в `Room.tick()` (нейтрализация гексов выбывших).

## 4. Эффект в битве (tickBattles)

- `FORTRESS_DRAIN_PER_TICK = Math.round(DRAIN_PER_TICK * 1.25)` = 13.
- В `tickBattles`: если `isFortressProtected(state, hex)` — дренаж вложений АТАКУЮЩЕГО `FORTRESS_DRAIN_PER_TICK` вместо `DRAIN_PER_TICK`; дренаж защиты без изменений.

## 5. Комната и ws (rooms.ts, ws.ts)

- Сообщения `build-fortress { q, r }`, `remove-fortress { q, r }` → case в `handleAction` с валидацией; логи «X построил крепость на (q,r)» / «X снёс крепость на (q,r)».
- `applyIncome` и `view()` используют `pointLimit(count, fortressCount(...))`.

## 6. Web

- `types.ts`: `Hex.fortress?: boolean`; ClientMessage: `build-fortress` / `remove-fortress`.
- `api.ts`: `sendBuildFortress(q, r)`, `sendRemoveFortress(q, r)`.
- `ContextMenu.vue`: свой гекс — «Построить крепость» (активна, если есть запас лимита построек — клиент считает `floor(hexCount/15) > fortressCount`) и «Снести крепость» (если `hex.fortress`).
- `HexMap.vue`: иконка крепости (⚑) на гексе с `fortress`; в тултипе строка «Крепость».
- `Hud.vue` — без изменений (лимит уже приходит с сервера с учётом крепостей).

## 7. Тесты

- rules: `fortressLimit` (0/15/30/45), `pointLimit` с крепостями, `validateBuildFortress` (свой/чужой гекс, битва, лимит построек, запас очков), build/remove, уничтожение при битве/отрезании/окружении/выбытии, `isFortressProtected` (сам гекс, сосед, чужой сосед), дренаж 13 в защищённой битве.
- rooms: `build-fortress`/`remove-fortress` через handleAction, логи, view-лимит с крепостью.
- Web: сборка.

## 8. Файлы

- Изменить: `server/src/rules.ts`, `server/src/rooms.ts`, `server/src/ws.ts`, `server/test/rules.test.ts`, `server/test/rooms.test.ts`.
- Web: `web/src/types.ts`, `web/src/api.ts`, `web/src/components/ContextMenu.vue`, `web/src/components/HexMap.vue`.
