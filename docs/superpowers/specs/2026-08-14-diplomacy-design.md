# Дизайн: дипломатия — мир/союз/война

Дата: 2026-08-14

## Обзор

Отношения между каждой парой игроков: `peace` / `war` / `alliance`. Старт — все в мире. Война блокирует атаки и захваты у границы; союз открывает взаимные ресурсы в HUD и требует взаимной войны. ИИ объявляет войну только при силовом преимуществе (с учётом союзников), показатели игрока видит из кэша разведки (раз в 30 сек). Мир/союз — предложения через ПКМ-меню.

## 1. Модель отношений (server/src/rules.ts)

- `export type DiplomacyRelation = 'peace' | 'war' | 'alliance'`.
- `export type DiplomacyMap = Map<string, DiplomacyRelation>` — ключ `\`${Math.min(a,b)}-${Math.max(a,b)}\``, по умолчанию `'peace'` (отсутствующий ключ = мир).
- `export function relation(state: GameState, a: number, b: number): DiplomacyRelation` — читает из `state.diplomacy` (новое поле `GameState.diplomacy?: DiplomacyMap`; undefined = всё в мире).
- `export function declareWar(state: GameState, a: number, b: number): void`:
  - `state.diplomacy.set(a-b-key, 'war')`;
  - **союзники обеих сторон вступают в войну** (взаимно): для каждого союзника sa игрока a → война sa↔b; для каждого союзника sb игрока b → война sb↔a; союзники a и b остаются союзниками друг с другом.
- `export function makePeace(state, a, b)` и `export function makeAlliance(state, a, b)` — устанавливают отношения (проверки применимости — в комнате).
- `export function alliesOf(state, playerId): number[]` — список союзников.
- `GameState` получает `diplomacy: DiplomacyMap` (инициализируется пустым при создании комнаты).

## 2. Блокировки (rules.ts)

- `validateAttack`: если у гекса есть владелец и отношение с ним не `war` → ошибка «Нужно объявить войну» (в мире/союзе атака запрещена).
- `validateCapture`: захват нейтрального гекса, у которого сосед — чужой владелец с отношением не `war` → ошибка (в мире нельзя начинать битву у его границы).
- Атака на союзника — запрещена той же проверкой (союз ≠ война).
- `applyCapture`/`applyAttack` не меняются (валидация выше уже блокирует).

## 3. Комната: объявление войны и предложения (rooms.ts)

### WS-сообщения

- `declare-war { q, r }` — владелец гекса = цель; `rules.declareWar`, лог «X объявил войну Y».
- `propose { q, r, kind: 'peace' | 'alliance' }` — владелец гекса = цель; создаёт предложение, лог «X предлагает мир/союз Y».
- `respond-proposal { q, r, accept: boolean }` — владелец гекса = предлагавший; при `accept` → `makePeace`/`makeAlliance` + лог «X и Y заключили мир/союз»; иначе лог «X отклонил предложение Y».
- Все действия идут через `handleAction` (расширить типы `ClientMessage`).

### Предложения

- `Room.pendingProposals: { from: number; to: number; kind: 'peace' | 'alliance' }[]` (в `Room`, не в `GameState`).
- Валидация: цель существует и не выбыла; отношения с целью ещё не такие (для мира — не мир; для союза — не союз и не война); предложение не дублируется.
- `respond-proposal` доступен адресату (владелец гекса — предлагавший).

### ИИ-ответ на предложение

- `aiAcceptsProposal(state, aiId, proposerId): boolean`:
  - принять, если `hexCount(proposer) >= hexCount(ai) * 0.8` (примерно равен или сильнее) **ИЛИ** ИИ уже воюет хотя бы с одним игроком;
  - иначе отклонить.
- Предложения ИИ решаются в `tick()` (в цикле обработки ИИ, до выбора действия).

### Агрессия ИИ

- Перед выбором действия ИИ (в `tick()`, для каждого ИИ) вызывается `maybeDeclareWar(aiId)`:
  - для каждой цели X (не союзник, не уже в войне, не выбыла):
    - сила ИИ-стороны: `hexCount(ai) + Σ hexCount(союзников ai)` и `points(ai) + Σ points(союзников)`;
    - сила стороны X: та же формула, но показатели ИГРОКА-человека берутся из **кэша разведки** (см. §4);
    - если `sideHexes(ai) >= sideHexes(X) || sidePoints(ai) >= sidePoints(X)` → `declareWar(ai, X)` + лог «X объявил войну Y».
  - правило действует и против других ИИ (подтверждено пользователем).

## 4. Разведка ИИ (rooms.ts)

- `Room.scoutCache: { targetId: number; hexCount: number; points: number; updatedAt: number } | null` — кэш показателей человека (единственного человеческого слога; при нескольких — всех, но достаточно одного).
- Обновляется в `tick()`: если `now - updatedAt >= 30000` → перечитать `hexCount`/`points` человека.
- Агрессия ИИ использует кэш вместо живых данных. Прочие ИИ — живые данные (ИИ не «обманывают» друг друга).

## 5. HUD и view (web + rooms.ts)

- `Room.view(playerId: number | null)` — фильтрация по отношениям зрителя:
  - себе и союзникам: `points`, `limit`, `income` — как сейчас;
  - врагам (и при отсутствии отношений — мир): `points: null`, `income: null` (вместо чисел) — клиент показывает «?»;
  - `hexCount` и `eliminated` видны всем.
- `ViewPlayer` получает `points: number | null`, `income: number | null`, `relation: 'self' | 'ally' | 'enemy'` (для подсветки строки союзника).
- ViewGame получает `pendingProposals` (только входящие для зрителя) — для пунктов меню «Принять/Отклонить».

## 6. ПКМ-меню (web)

- На чужом гексе пункты зависят от отношения с владельцем:
  - мир: «Война» (активен), «Мир» (disabled — уже мир), «Союз» (активен);
  - война: «Война» (disabled), «Мир» (активен — предложение), «Союз» (disabled);
  - союз: «Война» (активен — разрыв союза), «Мир» (disabled), «Союз» (disabled);
  - если есть входящее предложение от владельца: «Принять мир/союз», «Отклонить» (вместо стандартных пунктов).
- Отправка: `declare-war` / `propose` / `respond-proposal` с координатами гекса.
- Все события дипломатии — в игровой лог.

## 7. Тесты

- rules: `relation`/`declareWar` (союзники обеих сторон вступают в войну), `validateAttack`/`validateCapture` блокируют в мире и союзе.
- rooms: `declare-war`/`propose`/`respond-proposal` через handleAction (валидации, логи); ИИ принимает предложение при равенстве или при уже идущей войне, отклоняет при слабом игроке; агрессия ИИ (объявляет войну при перевесе, не трогает при слабости); кэш разведки (не обновляется чаще 30 сек); фильтрация `view()` (враг не видит очки/доход, союзник видит).
- ai: `chooseAiAction` не атакует в мире (в тестах ai.test.ts добавить отношения).

## 8. Файлы

- Изменить: `server/src/rules.ts`, `server/src/rooms.ts`, `server/src/ai.ts`, `server/src/ws.ts`, `server/test/rules.test.ts`, `server/test/rooms.test.ts`, `server/test/ai.test.ts`.
- Web: `web/src/types.ts` (сообщения, ViewPlayer/ViewGame), `web/src/api.ts` (отправка), `web/src/App.vue` (обработка пунктов меню, HUD-поля), `web/src/components/ContextMenu.vue` (активные пункты дипломатии), `web/src/components/Hud.vue` («?» у врагов, подсветка союзников).
