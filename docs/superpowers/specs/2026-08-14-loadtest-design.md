# Дизайн: инструмент нагрузочного тестирования

Дата: 2026-08-14

## Обзор

Режим нагрузочного теста: комната с 5/10/20/30 игроками (1 человек-зритель + ИИ) на карте `round`, ИИ играют как обычно; клиент показывает FPS-оверлей (живой счётчик, итог: мин/средний FPS и длительность). HUD, панель армии и лог в тестовом режиме скрыты — на экране только карта и оверлей.

## 1. Сервер

- `RoomManager.createLoadTest(connId: number, aiCount: number): { ok: true } | { ok: false; error: string }`:
  - `aiCount` из допустимого набора {5, 10, 20, 30} (иначе ошибка «Количество игроков должно быть 5, 10, 20 или 30»);
  - создаёт комнату: `mapType: 'round'`, `maxPlayers: aiCount + 1`, `aiMode: true`, `aiCount` — обычная валидация `createSolo` проходит естественно (обход лимита 6 без спец-кода);
  - добавляет человека и стартует.
- `Room` — новый параметр конструктора `loadTest = false` (после `difficulty`); поле `readonly loadTest: boolean`.
- `view()` — добавляет `loadTest: boolean` в RoomView.
- ws.ts: case `'start-load-test'` → `manager.createLoadTest(connId, Number(message.aiCount))`.

## 2. Web

- Главное меню — кнопка «Нагрузочный тест» → экран с выбором числа игроков (5/10/20/30) → `sendStartLoadTest(aiCount)`.
- `types.ts`: `RoomView.loadTest: boolean`; ClientMessage `{ type: 'start-load-test'; aiCount: number }`; `api.ts`: `sendStartLoadTest(aiCount)`.
- В тестовой комнате (`room.loadTest`):
  - скрыты `Hud`, `ArmyBar`, `log-panel` (шапка и бургер остаются — выход из теста);
  - показывается `FpsOverlay.vue`.
- `FpsOverlay.vue`:
  - rAF-цикл считает кадры; живой счётчик FPS обновляется ~2 раза/сек;
  - кнопка «Итог» — панель с мин./средним FPS и длительностью теста (счётчик продолжает работать);
  - позиция — верхний левый угол (там, где обычно HUD), тёмная плашка.

## 3. Тесты

- server: `createLoadTest` — создаёт комнату с нужным числом ИИ (5/10/20/30), `view().loadTest === true`; недопустимое число игроков — ошибка.
- Web: сборка.

## 4. Файлы

- Изменить: `server/src/rooms.ts`, `server/src/ws.ts`, `server/test/rooms.test.ts`.
- Web: `web/src/types.ts`, `web/src/api.ts`, `web/src/App.vue`, создать `web/src/components/FpsOverlay.vue`.
