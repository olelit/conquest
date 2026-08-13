# Дизайн: анализ скорости ИИ (статистика), уровни сложности, дефолт армии 20%

Дата: 2026-08-13

## Обзор

Три связанных изменения:

1. Дефолт армии — 20% (сейчас 50%).
2. Модуль статистики игры — записывает структурированные события партии в JSON-файл для последующего анализа темпа ИИ vs человека.
3. Уровни сложности ИИ (лёгкий/средний/сложный) — множитель дохода ИИ.

## 1. Дефолт армии — 20%

- `web/src/App.vue`: `const army = ref(50);` → `const army = ref(20);` (процент от текущих очков; конвертация уже реализована).

## 2. Модуль статистики

### Назначение

Дать данные для ответа на вопрос «почему компьютер быстрее человека»: темп действий, время реакции ИИ на атаку, кривая роста территории.

### Реализация

Новый файл `server/src/stats.ts`:

- `export interface StatsEvent` — дискриминантное объединение:
  - `{ type: 'start'; t: number; mapType: string; players: { id: number; name: string; isAi: boolean; incomeMultiplier: number }[] }`
  - `{ type: 'action'; t: number; playerId: number; action: 'capture' | 'attack' | 'defend'; q: number; r: number }`
  - `{ type: 'battle'; t: number; q: number; r: number; winnerId: number | null }`
  - `{ type: 'reaction'; t: number; playerId: number; ms: number }` — ИИ ответил на атаку по своему гексу за ms мс
  - `{ type: 'snapshot'; t: number; players: { id: number; hexCount: number; points: number }[] }` — раз в 10 тиков
  - `{ type: 'end'; t: number; winnerId: number | null; durationMs: number }`
- `export class GameStatsRecorder`:
  - `constructor(roomId: number, events: StatsEvent[] = [])`
  - `record(event: StatsEvent): void`
  - `writeSummary(): string` — считает сводку (действий в минуту на игрока, среднее/максимальное время реакции, итоговые hexCount) и возвращает путь к файлу.
  - Сводка записывается одним JSON: `{ meta, summary, events }`.

### Куда пишется файл

- Каталог: `server/stats/` (переопределяется `CONQUEST_STATS_DIR`). В dev-режиме docker `./server` смонтирован в контейнер — файл виден на хосте.
- Имя: `<roomId>-<startedAtMs>.json`.
- Запись при завершении игры: в `Room.tick()` при `finishedAt !== null` (один раз — флаг `statsWritten`), а также при удалении комнаты в `RoomManager` (страховка для брошенных игр).
- `RoomManager.tickAll()`: после удаления комнаты вызвать `room.writeStatsIfNeeded()`.

### Хуки записи событий (в `server/src/rooms.ts`)

- `start`: в `Room.start()` и `Room.restart()` (для рестарта — новый лог, события продолжают писаться в тот же recorder; стартовое событие перезаписывает meta).
- `action`: в `handleAction` (capture/attack/defend — только успешные, после валидации) и в `applyAiAction` (успешные действия ИИ).
- `battle`: в `tick()` для каждого `BattleResult` (включая ничьи).
- `reaction`: в `applyAiAction` — если действие ИИ (defend/attack/capture) относится к гексу, на который ранее была начата атака на владение ИИ, зафиксировать `ms = now - attackStartedAt`. Таймеры хранятся в комнате: `private attackStartedAt = new Map<string, number>()` (ключ `${q},${r}`). Заполняется на уровне комнаты: в `handleAction` и в `applyAiAction` при успешной атаке/захвате с битвой по гексу, который владеет ИИ (или нейтральному соседнему с ИИ); очищается после фиксации реакции или через 30 сек (проверка `now - started < 30000`).
- `snapshot`: в `tick()` — каждые 10 тиков (счётчик `tickCounter`), по всем игрокам.
- `end`: в `tick()` при установке `finishedAt`.

## 3. Уровни сложности

### Правила

- `export type Difficulty = 'easy' | 'medium' | 'hard'` (в `server/src/rules.ts` или `server/src/config.ts`).
- Конфиг в `config.ts`:
  ```ts
  aiIncomeMultipliers: {
    easy: number('CONQUEST_AI_INCOME_EASY', 0.5),
    medium: number('CONQUEST_AI_INCOME_MEDIUM', 0.75),
    hard: number('CONQUEST_AI_INCOME_HARD', 1),
  } as Record<Difficulty, number>,
  ```
- `PlayerState.incomeMultiplier?: number` (по умолчанию 1).
- `applyIncome`: `player.points = min(points + round(income * multiplier), limit)` — округление вниз через `Math.floor` после умножения на доход (не на базу).
  - Актуальная формула: `income = playerIncome(state, id) * (player.incomeMultiplier ?? 1)` — множитель применяется к полному доходу игрока за тик, `Math.floor` результата.
- `Room.start()`: ИИ-игроки получают `incomeMultiplier` по сложности комнаты; человек — не получает (undefined = 1).
- Комнаты с людьми (мультиплеер): ИИ на средней сложности (0.75) — фиксированно.
- `Room` хранит `difficulty: Difficulty` (по умолчанию 'medium'); конструктор принимает параметр.
- `createSolo(connId, mapType, aiCount, difficulty)` → валидация difficulty; `Room` создаётся с ней.
- `ws.ts`: сообщение `start-solo` получает поле `difficulty?: string` → валидация в `createSolo` (неизвестное значение → ошибка).

### Web

- `web/src/types.ts`: `export type Difficulty = 'easy' | 'medium' | 'hard';` + `ClientMessage['start-solo']` получает `difficulty: Difficulty`.
- `web/src/api.ts`: `sendStartSolo(mapType, aiCount, difficulty)`.
- `web/src/App.vue`: на экране «Игра с компьютером» — select «Сложность» (Лёгкая/Средняя/Сложная), `aiDifficulty = ref<Difficulty>('medium')`, передаётся в `startSolo()`.

## 4. Тесты

- `rules.test.ts`: `applyIncome` с `incomeMultiplier: 0.5` (доход округляется вниз), без множителя — как раньше; множитель 1 = как раньше.
- `rooms.test.ts`:
  - соло-создание с difficulty: `createSolo(conn, mapType, aiCount, 'easy')` → у ИИ `incomeMultiplier === 0.5`, у человека undefined;
  - некорректная difficulty → ошибка;
  - мультиплеерная комната: у ИИ множитель 0.75.
  - статистика: после `handleAction` capture в recorder есть событие `action`; после победы в битве — `battle`; реакция ИИ фиксируется; `writeSummary()` создаёт файл (временный каталог через `CONQUEST_STATS_DIR` env или параметр конструктора — для теста передавать каталог).
- `config.ts` не тестируется (числовые фолбэки).

## 5. Файлы

- Создать: `server/src/stats.ts`.
- Изменить: `server/src/config.ts`, `server/src/rules.ts`, `server/src/rooms.ts`, `server/src/ws.ts`, `server/test/rules.test.ts`, `server/test/rooms.test.ts`.
- Web: `web/src/types.ts`, `web/src/api.ts`, `web/src/App.vue`.
