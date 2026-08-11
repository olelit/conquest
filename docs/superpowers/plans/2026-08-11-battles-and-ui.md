# Сражения и UI-правки — план реализации (Этап 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Переделать механику сражений на трату очков по 10/тик с фазой захвата, и перенести цифры битвы из гекса в модалку при наведении, добавить зум колесом и сдвинуть бургер/паузу вправо.

**Architecture:** Серверная механика живёт в `server/src/rules.ts` (`tickBattles` возвращает результаты битв для логов в `game.ts`). Клиент: `HexMap.vue` получает `players` и `captureTicks`, показывает тултип с пулами и прогрессом захвата, зум реализован через изменение `viewBox` (курсор остаётся на месте). Схема БД не меняется — меняется только семантика `battle_progress` (теперь это прогресс захвата).

**Tech Stack:** Node TS (vitest, express/ws), Vue 3 (script setup), SVG.

## Global Constraints

- Трата пулов: `CONQUEST_DRAIN_PER_TICK = 10` очков за тик (серверный конфиг).
- Длительность захвата: `CONQUEST_CAPTURE_TICKS = 5` тиков.
- Минимум первой атаки на гекс = `terrainCost(hex.terrain)`; доливки ≥ 1.
- Пул не уходит ниже 0; во время захвата оба пула заморожены.
- Остаток пула победителя возвращается в его очки после захвата.
- Ничья (оба пула = 0): битва заканчивается без победителя, гекс остаётся у владельца.
- Захват отменяется вложением в пул, который был на нуле (`battleProgress = 0`).
- Схема БД не меняется.
- Команды: сервер `npm test` (vitest run) и `npm run build` (tsc) в `server/`; web `npm run build` (vue-tsc -b && vite build) в `web/`.

---

### Task 1: Конфиг траты и захвата

**Files:**
- Modify: `server/src/config.ts:27`
- Modify: `server/src/rules.ts:12`
- Modify: `docker-compose.yml:44`

**Interfaces:**
- Produces: `rules.CAPTURE_TICKS: number` (5), `rules.DRAIN_PER_TICK: number` (10); `config.captureTicks`, `config.drainPerTick`.

- [ ] **Step 1: Заменить `battleTicks` на `captureTicks` и `drainPerTick` в конфиге**

В `server/src/config.ts` замени строку:
```ts
  battleTicks: number('CONQUEST_BATTLE_TICKS', 5),
```
на:
```ts
  captureTicks: number('CONQUEST_CAPTURE_TICKS', 5),
  drainPerTick: number('CONQUEST_DRAIN_PER_TICK', 10),
```

- [ ] **Step 2: Обновить экспорты в rules.ts**

В `server/src/rules.ts` замени строку:
```ts
export const BATTLE_TICKS = config.battleTicks;
```
на:
```ts
export const CAPTURE_TICKS = config.captureTicks;
export const DRAIN_PER_TICK = config.drainPerTick;
```

- [ ] **Step 3: Обновить комментарий в docker-compose.yml**

В `docker-compose.yml` строку:
```yml
      # CONQUEST_BATTLE_TICKS: 5
```
замени на:
```yml
      # CONQUEST_DRAIN_PER_TICK: 10
      # CONQUEST_CAPTURE_TICKS: 5
```

- [ ] **Step 4: Проверить сборку сервера**

Run: `npm run build` (workdir: `server`)
Expected: `tsc` завершается без ошибок (файл ещё не используется — ошибок быть не должно).

- [ ] **Step 5: Коммит**

```bash
git add server/src/config.ts server/src/rules.ts docker-compose.yml
git commit -m "feat: конфиг траты пулов и длительности захвата"
```

---

### Task 2: Механика тика битвы — трата, захват, ничья, возврат остатка

**Files:**
- Modify: `server/src/rules.ts:187-212`
- Test: `server/test/rules.test.ts` (блоки `тик битв` и вспомогательный `BATTLE_STEP константа`)

**Interfaces:**
- Produces: `export interface BattleResult { q: number; r: number; winnerId: number | null }` и `tickBattles(state: GameState): BattleResult[]` — возвращает результаты завершившихся битв (для логов в game.ts).
- Consumes: `CAPTURE_TICKS`, `DRAIN_PER_TICK` из Task 1.

- [ ] **Step 1: Переписать `tickBattles` в rules.ts**

Замени всю функцию `tickBattles` (строки 187-204) и добавь интерфейс перед ней:

```ts
export interface BattleResult {
  q: number;
  r: number;
  winnerId: number | null;
}

export function tickBattles(state: GameState): BattleResult[] {
  const results: BattleResult[] = [];
  for (const hex of state.hexes) {
    if (hex.attackerId === null) continue;
    if (hex.attackInvestment > 0 && hex.defenseInvestment > 0) {
      hex.attackInvestment = Math.max(0, hex.attackInvestment - DRAIN_PER_TICK);
      hex.defenseInvestment = Math.max(0, hex.defenseInvestment - DRAIN_PER_TICK);
      hex.battleProgress = 0;
      if (hex.attackInvestment === 0 && hex.defenseInvestment === 0) {
        results.push({ q: hex.q, r: hex.r, winnerId: null });
        resetBattle(hex);
      }
      continue;
    }
    if (hex.attackInvestment > 0 || hex.defenseInvestment > 0) {
      hex.battleProgress += 1;
      if (hex.battleProgress < CAPTURE_TICKS) continue;
      const attackerWon = hex.attackInvestment > 0;
      const winnerId = attackerWon ? hex.attackerId : hex.defenderId;
      if (winnerId === null) continue;
      const winner = state.players.find((p) => p.id === winnerId);
      if (winner) {
        winner.points += attackerWon ? hex.attackInvestment : hex.defenseInvestment;
      }
      results.push({ q: hex.q, r: hex.r, winnerId });
      hex.ownerId = winnerId;
      resetBattle(hex);
      continue;
    }
    results.push({ q: hex.q, r: hex.r, winnerId: null });
    resetBattle(hex);
  }
  return results;
}
```

Логика: оба пула > 0 → трата по `DRAIN_PER_TICK` (не ниже 0), оба дошли до 0 в один тик → ничья. Ровно один пул > 0 → фаза захвата: `battleProgress` +1 за тик, пулы не трогаются (заморожены); при `battleProgress >= CAPTURE_TICKS` победитель получает гекс и остаток пула. Оба пула = 0 (защитный случай) → ничья.

- [ ] **Step 2: Написать тесты на новую механику**

В `server/test/rules.test.ts`:
- в import замени `BATTLE_TICKS,` на `CAPTURE_TICKS,` и добавь `DRAIN_PER_TICK,`;
- полностью замени блок `describe('тик битв', ...)` (строки 213-280) на:

```ts
describe('тик битвы: трата', () => {
  it('оба пула тратятся по DRAIN_PER_TICK за тик', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 600, defenseInvestment: 300 }]);
    tickBattles(s);
    expect(findHex(s, 6, 5)!.attackInvestment).toBe(590);
    expect(findHex(s, 6, 5)!.defenseInvestment).toBe(290);
  });
  it('пул не уходит в минус', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 5, defenseInvestment: 100 }]);
    tickBattles(s);
    expect(findHex(s, 6, 5)!.attackInvestment).toBe(0);
  });
  it('ничья: оба пула дошли до 0 — битва заканчивается без победителя, гекс у владельца', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 100, defenseInvestment: 100 }]);
    const results: { q: number; r: number; winnerId: number | null }[] = [];
    for (let i = 0; i < 10; i++) results.push(...tickBattles(s));
    const hex = findHex(s, 6, 5)!;
    expect(hex.ownerId).toBe(AI);
    expect(hex.attackerId).toBeNull();
    expect(hex.attackInvestment).toBe(0);
    expect(hex.defenseInvestment).toBe(0);
    expect(results).toEqual([{ q: 6, r: 5, winnerId: null }]);
  });
});

describe('тик битвы: захват', () => {
  it('пул соперника на нуле — начинается захват, пул победителя заморожен', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 300 }]);
    tickBattles(s);
    const hex = findHex(s, 6, 5)!;
    expect(hex.battleProgress).toBe(1);
    expect(hex.attackInvestment).toBe(300);
  });
  it('через CAPTURE_TICKS тиков захват завершается: гекс у атакующего, остаток пула возвращается', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 300 }], [{ id: 1, points: 100 }, { id: 2, points: 900 }]);
    const results: { q: number; r: number; winnerId: number | null }[] = [];
    for (let i = 0; i < CAPTURE_TICKS; i++) results.push(...tickBattles(s));
    const hex = findHex(s, 6, 5)!;
    expect(hex.ownerId).toBe(P);
    expect(hex.attackerId).toBeNull();
    expect(hex.attackInvestment).toBe(0);
    expect(hex.defenseInvestment).toBe(0);
    expect(hex.battleProgress).toBe(0);
    expect(s.players[0].points).toBe(400);
    expect(s.players[1].points).toBe(900);
    expect(results).toEqual([{ q: 6, r: 5, winnerId: P }]);
  });
  it('вложение защитника во время захвата отменяет его и возобновляет трату', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 300 }], [{ id: 1, points: 400 }, { id: 2, points: 900 }]);
    tickBattles(s);
    expect(findHex(s, 6, 5)!.battleProgress).toBe(1);
    applyDefend(s, AI, 6, 5, 500);
    const hex = findHex(s, 6, 5)!;
    expect(hex.battleProgress).toBe(0);
    expect(hex.defenseInvestment).toBe(500);
    tickBattles(s);
    expect(findHex(s, 6, 5)!.attackInvestment).toBe(290);
    expect(findHex(s, 6, 5)!.defenseInvestment).toBe(490);
  });
  it('защитник отбивает свой гекс: пул атакующего сгорает, остаток защитника возвращается', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, defenderId: AI, attackerId: P, attackInvestment: 100, defenseInvestment: 600 }], [{ id: 1, points: 900 }, { id: 2, points: 400 }]);
    for (let i = 0; i < 15; i++) tickBattles(s);
    const hex = findHex(s, 6, 5)!;
    expect(hex.ownerId).toBe(AI);
    expect(hex.attackerId).toBeNull();
    expect(s.players[1].points).toBe(900);
    expect(s.players[0].points).toBe(800);
  });
  it('обороняющийся забирает нейтральный спорный гекс, если его пул выстоял', () => {
    const s = makeState([{ q: 4, r: 5, attackerId: P, defenderId: AI, attackInvestment: 100, defenseInvestment: 600 }, { q: 5, r: 5, ownerId: AI }]);
    for (let i = 0; i < 15; i++) tickBattles(s);
    expect(findHex(s, 4, 5)!.ownerId).toBe(AI);
  });
});
```

- [ ] **Step 3: Обновить тест констант**

В блоке `describe('вспомогательные', ...)` замени:

```ts
  it('BATTLE_STEP константа', () => {
    expect(WIN_HEX_COUNT).toBe(97);
  });
```

на:

```ts
  it('константы захвата', () => {
    expect(WIN_HEX_COUNT).toBe(97);
    expect(CAPTURE_TICKS).toBe(5);
    expect(DRAIN_PER_TICK).toBe(10);
  });
```

- [ ] **Step 4: Прогнать тесты**

Run: `npm test` (workdir: `server`)
Expected: все тесты проходят (битвы — новые; атака/оборона/нейтральные пока на старых правилах, они не конфликтуют).

- [ ] **Step 5: Коммит**

```bash
git add server/src/rules.ts server/test/rules.test.ts
git commit -m "feat: механика битвы — трата пулов по 10/тик и фаза захвата"
```

---

### Task 3: Вложения — минимум атаки, отмена захвата, бесплатный первый гекс

**Files:**
- Modify: `server/src/rules.ts:107-185`
- Test: `server/test/rules.test.ts` (блоки `захват нейтрального гекса у границы соперника порождает битву`, `атака на гекс соперника`)

**Interfaces:**
- Consumes: `terrainCost` (уже есть).
- Produces: изменённые `validateAttack` (минимум для первой атаки = стоимость гекса), `applyAttack`/`applyDefend` (вложение в пул, который был 0, сбрасывает `battleProgress`), `applyCapture` (вложение `max(1, cost)` при создании битвы).

- [ ] **Step 1: Обновить `validateAttack`**

Замени тело `validateAttack` в `server/src/rules.ts` (строки 107-120) на:

```ts
export function validateAttack(state: GameState, playerId: number, q: number, r: number, points: number): ActionValidation {
  if (hasGameWinner(state)) return { ok: false, error: 'Игра окончена' };
  if (!isValidPoints(points)) return { ok: false, error: 'Вложение должно быть целым числом ≥ 1' };
  const hex = findHex(state, q, r);
  if (!hex) return { ok: false, error: 'Гекс не найден' };
  if (hex.ownerId !== null && hex.ownerId === playerId) return { ok: false, error: 'Нельзя атаковать свой гекс' };
  if (hex.ownerId === null) return { ok: false, error: 'Нейтральный гекс захватывается, а не атакуется' };
  if (hex.attackerId !== null && hex.attackerId !== playerId) return { ok: false, error: 'Битву уже ведёт соперник' };
  if (!hasAdjacentOwner(state, q, r, playerId)) return { ok: false, error: 'Гекс не соседний' };
  if (hex.attackerId !== playerId && points < terrainCost(hex.terrain)) {
    return { ok: false, error: 'Минимальное вложение в атаку — стоимость гекса' };
  }
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { ok: false, error: 'Игрок не найден' };
  if (player.points < points) return { ok: false, error: 'Не хватает очков' };
  return { ok: true };
}
```

- [ ] **Step 2: Обновить `applyAttack` и `applyDefend`**

Замени `applyAttack` и `applyDefend` (строки 163-185) на:

```ts
export function applyAttack(state: GameState, playerId: number, q: number, r: number, points: number): void {
  const hex = findHex(state, q, r)!;
  const player = state.players.find((p) => p.id === playerId)!;
  player.points -= points;
  const wasZero = hex.attackInvestment === 0;
  hex.attackInvestment += points;
  if (hex.attackerId === null) {
    hex.attackerId = playerId;
    hex.defenderId = hex.ownerId;
  }
  if (wasZero) hex.battleProgress = 0;
}

export function applyDefend(state: GameState, playerId: number, q: number, r: number, points: number): void {
  const hex = findHex(state, q, r)!;
  const player = state.players.find((p) => p.id === playerId)!;
  player.points -= points;
  const wasZero = hex.defenseInvestment === 0;
  hex.defenseInvestment += points;
  if (hex.defenderId === null) {
    hex.defenderId = playerId;
  }
  if (wasZero) hex.battleProgress = 0;
}
```

- [ ] **Step 3: Обновить `applyCapture`**

В `applyCapture` (строка 149-150) замени:

```ts
    hex.attackerId = playerId;
    hex.attackInvestment = cost;
```

на:

```ts
    hex.attackerId = playerId;
    hex.attackInvestment = Math.max(1, cost);
```

(Бесплатный первый гекс у границы врага получает пул 1, иначе пул 0/0 сразу завершился бы ничьей.)

- [ ] **Step 4: Обновить тесты нейтральных гексов у границы**

В `server/test/rules.test.ts` в блоке `захват нейтрального гекса у границы соперника порождает битву` замени последний тест:

```ts
  it('бесплатный первый гекс у границы ИИ — битва с нулевым вложением', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI }]);
    applyCapture(s, P, 5, 5);
    const hex = findHex(s, 5, 5)!;
    expect(hex.attackerId).toBe(P);
    expect(hex.attackInvestment).toBe(0);
  });
```

на:

```ts
  it('бесплатный первый гекс у границы ИИ — битва с вложением 1 очко', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI }]);
    applyCapture(s, P, 5, 5);
    const hex = findHex(s, 5, 5)!;
    expect(hex.attackerId).toBe(P);
    expect(hex.attackInvestment).toBe(1);
  });
```

- [ ] **Step 5: Обновить тесты атаки**

В блоке `атака на гекс соперника`:
- тест `валидна только для соседнего гекса соперника` — замени `validateAttack(s2, P, 6, 5, 100)` на `validateAttack(s2, P, 6, 5, 150)`;
- после теста `долив в свою атаку увеличивает вложение` добавь:

```ts
  it('первая атака требует минимум — стоимость гекса', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: P }, { q: 6, r: 5, terrain: 'mountain', ownerId: AI }]);
    expect(validateAttack(s, P, 6, 5, 449).ok).toBe(false);
    expect(validateAttack(s, P, 6, 5, 450).ok).toBe(true);
  });
  it('долив в свою атаку может быть меньше стоимости', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: P }, { q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 500 }]);
    expect(validateAttack(s, P, 6, 5, 10).ok).toBe(true);
  });
  it('вложение защитника во время захвата атакующего сбрасывает прогресс', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 300, battleProgress: 2 }]);
    applyDefend(s, AI, 6, 5, 100);
    expect(findHex(s, 6, 5)!.battleProgress).toBe(0);
    expect(findHex(s, 6, 5)!.defenseInvestment).toBe(100);
  });
  it('долив атакующего, пока он сам захватывает, не сбрасывает прогресс', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 300, battleProgress: 2 }]);
    applyAttack(s, P, 6, 5, 100);
    expect(findHex(s, 6, 5)!.battleProgress).toBe(2);
    expect(findHex(s, 6, 5)!.attackInvestment).toBe(400);
  });
```

- [ ] **Step 6: Прогнать тесты и сборку**

Run: `npm test && npm run build` (workdir: `server`)
Expected: все тесты проходят, tsc без ошибок.

- [ ] **Step 7: Коммит**

```bash
git add server/src/rules.ts server/test/rules.test.ts
git commit -m "feat: минимум атаки = стоимость гекса, отмена захвата вложением, фикс первого захвата"
```

---

### Task 4: Логи исхода битв в game.ts

**Files:**
- Modify: `server/src/game.ts:324-347`

**Interfaces:**
- Consumes: `tickBattles(state): BattleResult[]` из Task 2.
- Produces: лог «Битва … окончена — победил X» / «— ничья» по результатам, а не по косвенным признакам.

- [ ] **Step 1: Переписать блок логирования в `tick()`**

В `server/src/game.ts` внутри `async tick()` замени:

```ts
      const battlesBefore = this.state.hexes.map((hex) => hex.attackerId);
      rules.tickBattles(this.state);
      for (let i = 0; i < this.state.hexes.length; i++) {
        const hex = this.state.hexes[i];
        if (battlesBefore[i] !== null && hex.attackerId === null && hex.ownerId !== null) {
          this.addLog(`Битва за (${hex.q}, ${hex.r}) окончена — победил ${this.playerMeta(hex.ownerId).name}`);
        }
      }
```

на:

```ts
      const results = rules.tickBattles(this.state);
      for (const result of results) {
        if (result.winnerId === null) {
          this.addLog(`Битва за (${result.q}, ${result.r}) окончена — ничья`);
        } else {
          this.addLog(`Битва за (${result.q}, ${result.r}) окончена — победил ${this.playerMeta(result.winnerId).name}`);
        }
      }
```

- [ ] **Step 2: Прогнать тесты и сборку**

Run: `npm test && npm run build` (workdir: `server`)
Expected: тесты проходят, tsc без ошибок.

- [ ] **Step 3: Коммит**

```bash
git add server/src/game.ts
git commit -m "feat: логи исхода битв по результатам tickBattles (победитель/ничья)"
```

---

### Task 5: ИИ под новую механику

**Files:**
- Modify: `server/src/ai.ts` (вся функция `chooseAiAction`)
- Test: `server/test/ai.test.ts` (полная замена тела файла)

**Interfaces:**
- Produces: `chooseAiAction(state: GameState, aiId: number, playerId: number): AiAction | null` — приоритеты: (1) срочная защита от захвата (свой гекс или нейтральный рядом), (2) топ-ап обороны при перевесе врага, (3) топ-ап своей атаки при перевесе обороны, (4) захват нейтрального, (5) атака границы врага за `terrainCost`.

- [ ] **Step 1: Написать тесты (красный)**

Полностью замени `server/test/ai.test.ts` на:

```ts
import { describe, expect, it } from 'vitest';
import { MAP_COLUMNS, MAP_ROWS } from '../src/map.js';
import type { GameState, HexState } from '../src/rules.js';
import { hasAdjacentOwner } from '../src/rules.js';
import { chooseAiAction } from '../src/ai.js';

function makeState(hexes: Partial<HexState>[], aiPoints = 1000, playerPoints = 1000): GameState {
  const h: HexState[] = [];
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let q = 0; q < MAP_COLUMNS; q++) {
      h.push({ q, r, terrain: 'grass', ownerId: null, attackerId: null, defenderId: null, attackInvestment: 0, defenseInvestment: 0, battleProgress: 0 });
    }
  }
  for (const p of hexes) {
    const hex = h.find((x) => x.q === p.q && x.r === p.r);
    if (hex) Object.assign(hex, p);
  }
  return { players: [{ id: 2, points: aiPoints }, { id: 1, points: playerPoints }], hexes: h, winnerId: null };
}

const P = 1;
const AI = 2;

describe('chooseAiAction', () => {
  it('приоритет 1: враг захватывает наш гекс — вкладываемся с перевесом', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 400, battleProgress: 3 }]);
    expect(chooseAiAction(s, AI, P)).toEqual({ type: 'defend', q: 6, r: 5, points: 401 });
  });
  it('приоритет 1: враг захватывает нейтральный гекс у нашей границы — вступаемся', () => {
    const s = makeState([{ q: 5, r: 5, attackerId: P, attackInvestment: 400, battleProgress: 3 }, { q: 6, r: 5, ownerId: AI }]);
    expect(chooseAiAction(s, AI, P)).toEqual({ type: 'defend', q: 5, r: 5, points: 401 });
  });
  it('приоритет 2: топ-ап обороны при перевесе врага в атаке', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 400, defenseInvestment: 100 }], 1000, 1000);
    expect(chooseAiAction(s, AI, P)).toEqual({ type: 'defend', q: 6, r: 5, points: 301 });
  });
  it('приоритет 2: не отвечает, когда оборона уже сильнее', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 100, defenseInvestment: 400 }]);
    expect(chooseAiAction(s, AI, P)).toBeNull();
  });
  it('приоритет 3: топ-ап своей атаки, если враг контрит', () => {
    const s = makeState([{ q: 5, r: 5, attackerId: AI, defenseInvestment: 400, attackInvestment: 100 }, { q: 6, r: 5, ownerId: AI }]);
    expect(chooseAiAction(s, AI, P)).toEqual({ type: 'attack', q: 5, r: 5, points: 301 });
  });
  it('приоритет 3: не оспаривает нейтральный гекс не у своей границы', () => {
    const s = makeState([{ q: 2, r: 2, attackerId: P, attackInvestment: 400 }, { q: 6, r: 5, ownerId: AI }], 0);
    expect(chooseAiAction(s, AI, P)).toBeNull();
  });
  it('приоритет 4: захватывает самый дешёвый нейтральный соседний гекс', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI }, { q: 5, r: 5, terrain: 'mountain' }, { q: 6, r: 4, terrain: 'grass' }]);
    expect(chooseAiAction(s, AI, P)).toEqual({ type: 'capture', q: 6, r: 4 });
  });
  it('приоритет 4: не захватывает, если не хватает очков', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI }, { q: 5, r: 5, terrain: 'mountain' }], 100);
    expect(chooseAiAction(s, AI, P)).toBeNull();
  });
  it('приоритет 5: атакует границу врага за стоимость гекса, когда нечего захватывать', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, terrain: 'mountain' }, { q: 5, r: 5, ownerId: P }], 450);
    expect(chooseAiAction(s, AI, P)).toEqual({ type: 'attack', q: 5, r: 5, points: 150 });
  });
  it('приоритет 5: не атакует, если очков меньше стоимости гекса', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI }, { q: 5, r: 5, ownerId: P }], 100);
    expect(chooseAiAction(s, AI, P)).toBeNull();
  });
  it('приоритет 0: без гексов — первый бесплатный захват вдали от игрока', () => {
    const s = makeState([{ q: 8, r: 6, ownerId: P }]);
    const action = chooseAiAction(s, AI, P);
    expect(action).toEqual({ type: 'capture', q: expect.any(Number), r: expect.any(Number) });
    const hex = s.hexes.find((h) => h.q === action!.q && h.r === action!.r)!;
    expect(hex.ownerId).toBeNull();
    expect(hasAdjacentOwner(s, hex.q, hex.r, P)).toBe(false);
  });
  it('приоритет 0: без гексов и у игрока тоже — захватывает первый нейтральный гекс', () => {
    const s = makeState([]);
    expect(chooseAiAction(s, AI, P)).toEqual({ type: 'capture', q: 0, r: 0 });
  });
  it('без доступных действий — null', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI }], 50);
    expect(chooseAiAction(s, AI, P)).toBeNull();
  });
});
```

- [ ] **Step 2: Прогнать тесты — должны упасть**

Run: `npm test` (workdir: `server`)
Expected: FAIL (старая логика: нет ответа на захват с перевесом 401, топ-ап по gap+1 и т.п.).

- [ ] **Step 3: Переписать `chooseAiAction` в ai.ts**

Полностью замени содержимое функции `chooseAiAction` (строки 8-62) на:

```ts
export function chooseAiAction(state: GameState, aiId: number, playerId: number): AiAction | null {
  const ai = state.players.find((p) => p.id === aiId);
  if (!ai) return null;

  const aiHexCount = hexCount(state, aiId);
  if (aiHexCount === 0) {
    return chooseFirstCapture(state, playerId);
  }

  for (const hex of state.hexes) {
    if (hex.attackerId === null || hex.attackerId !== playerId) continue;
    const contestable =
      hex.ownerId === aiId || (hex.ownerId === null && hasAdjacentOwner(state, hex.q, hex.r, aiId));
    if (!contestable) continue;
    if (hex.defenseInvestment === 0 && hex.attackInvestment > 0) {
      const invest = Math.min(ai.points, hex.attackInvestment + 1);
      if (invest >= 1) return { type: 'defend', q: hex.q, r: hex.r, points: invest };
    }
    if (hex.attackInvestment >= hex.defenseInvestment) {
      const invest = Math.min(ai.points, hex.attackInvestment - hex.defenseInvestment + 1);
      if (invest >= 1) return { type: 'defend', q: hex.q, r: hex.r, points: invest };
    }
  }

  for (const hex of state.hexes) {
    if (hex.attackerId !== aiId) continue;
    if (hex.attackInvestment <= hex.defenseInvestment) {
      const invest = Math.min(ai.points, hex.defenseInvestment - hex.attackInvestment + 1);
      if (invest >= 1) return { type: 'attack', q: hex.q, r: hex.r, points: invest };
    }
  }

  const affordableNeutral = state.hexes
    .filter((hex) => hex.ownerId === null && hex.attackerId === null && hasAdjacentOwner(state, hex.q, hex.r, aiId))
    .filter((hex) => terrainCost(hex.terrain) <= ai.points)
    .sort((a, b) => terrainCost(a.terrain) - terrainCost(b.terrain));
  if (affordableNeutral.length > 0) {
    const hex = affordableNeutral[0];
    return { type: 'capture', q: hex.q, r: hex.r };
  }

  const playerHexes = state.hexes.filter((hex) => hex.ownerId === playerId && hasAdjacentOwner(state, hex.q, hex.r, aiId));
  if (playerHexes.length > 0) {
    const hex = playerHexes.sort((a, b) => terrainCost(a.terrain) - terrainCost(b.terrain))[0];
    const cost = terrainCost(hex.terrain);
    if (ai.points >= cost) return { type: 'attack', q: hex.q, r: hex.r, points: cost };
  }

  return null;
}
```

- [ ] **Step 4: Прогнать тесты и сборку**

Run: `npm test && npm run build` (workdir: `server`)
Expected: PASS, tsc без ошибок.

- [ ] **Step 5: Коммит**

```bash
git add server/src/ai.ts server/test/ai.test.ts
git commit -m "feat: ИИ под механику траты пулов и захвата"
```

---

### Task 6: Web — модалка битвы при наведении, обводка захвата, убрать цифры из гекса

**Files:**
- Modify: `web/src/components/HexMap.vue`
- Modify: `web/src/App.vue` (проброс пропсов)
- Modify: `web/src/types.ts` (поле `captureTicks` в `GameState`)

**Interfaces:**
- Produces: `HexMap` получает новые пропсы `players: Player[]`, `captureTicks: number`; уходит текст `a / d` из гекса; при наведении показывается тултип с пулами и полосой прогресса; при захвате — обводка цвета захватывающего.
- Consumes: `game.players`, `game.captureTicks` из state (сервер отдаёт `captureTicks` — Step 2 этого таска).

- [ ] **Step 1: Типы web**

В `web/src/types.ts` в интерфейс `GameState` после `paused: boolean;` добавь:

```ts
  captureTicks: number;
```

- [ ] **Step 2: Сервер отдаёт `captureTicks`**

В `server/src/game.ts` в `getState()` в возвращаемом объекте после `paused: this.paused,` добавь:

```ts
      captureTicks: rules.CAPTURE_TICKS,
```

- [ ] **Step 3: Переписать `HexMap.vue`**

Полностью замени `web/src/components/HexMap.vue` на:

```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { PLAYER_COLOR, TERRAIN_COLORS, type Hex, type Player } from '../types';

const props = defineProps<{ hexes: Hex[]; players: Player[]; humanId: number | null; captureTicks: number }>();

const emit = defineEmits<{ click: [hex: Hex]; select: [hex: { q: number; r: number }] }>();

const HEX_SIZE = 30;
const SQRT3 = Math.sqrt(3);
const PADDING = 20;

const pointCache = new Map<string, ReturnType<typeof hexPoints>>();

function hexCenter(q: number, r: number): { x: number; y: number } {
  return {
    x: HEX_SIZE * SQRT3 * (q + r / 2),
    y: HEX_SIZE * (3 / 2) * r,
  };
}

function hexPoints(q: number, r: number): { points: string; minX: number; minY: number; maxX: number; maxY: number } {
  const key = `${q},${r}`;
  const cached = pointCache.get(key);
  if (cached) return cached;
  const { x, y } = hexCenter(q, r);
  const pts: string[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    const px = x + HEX_SIZE * Math.cos(angle);
    const py = y + HEX_SIZE * Math.sin(angle);
    pts.push(`${px.toFixed(2)},${py.toFixed(2)}`);
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
  }
  const result = { points: pts.join(' '), minX, minY, maxX, maxY };
  pointCache.set(key, result);
  return result;
}

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const baseViewBox = computed<ViewBox>(() => {
  const xs = props.hexes.map((h) => hexCenter(h.q, h.r).x);
  const ys = props.hexes.map((h) => hexCenter(h.q, h.r).y);
  const minX = Math.min(...xs) - HEX_SIZE - PADDING;
  const maxX = Math.max(...xs) + HEX_SIZE + PADDING;
  const minY = Math.min(...ys) - HEX_SIZE - PADDING;
  const maxY = Math.max(...ys) + HEX_SIZE + PADDING;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
});

const view = ref<ViewBox | null>(null);
const viewBox = computed(() => {
  const v = view.value ?? baseViewBox.value;
  return `${v.x} ${v.y} ${v.w} ${v.h}`;
});

watch(baseViewBox, (b) => {
  view.value = { ...b };
});

const mapWrap = ref<HTMLDivElement | null>(null);

function onWheel(e: WheelEvent): void {
  e.preventDefault();
  const base = baseViewBox.value;
  const el = mapWrap.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const cx = (e.clientX - rect.left) / rect.width;
  const cy = (e.clientY - rect.top) / rect.height;
  const v = view.value ?? base;
  const worldX = v.x + cx * v.w;
  const worldY = v.y + cy * v.h;
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  const minW = base.w / 3;
  const maxW = base.w / 0.5;
  const newW = Math.min(maxW, Math.max(minW, v.w / factor));
  if (Math.abs(newW - v.w) < 0.001) return;
  const newH = newW * (base.h / base.w);
  view.value = {
    x: worldX - cx * newW,
    y: worldY - cy * newH,
    w: newW,
    h: newH,
  };
}

const hoveredPos = ref<{ q: number; r: number } | null>(null);
const hovered = computed(() => {
  if (!hoveredPos.value) return null;
  return props.hexes.find((h) => h.q === hoveredPos.value!.q && h.r === hoveredPos.value!.r) ?? null;
});

function colorOf(id: number | null): string {
  if (id === null) return '#999';
  return id === props.humanId ? PLAYER_COLOR.human : PLAYER_COLOR.ai;
}

function playerName(id: number | null): string {
  if (id === null) return '—';
  return props.players.find((p) => p.id === id)?.name ?? `Игрок ${id}`;
}

function captureState(hex: Hex): { byId: number; progress: number } | null {
  if (hex.attackerId === null || hex.battleProgress === 0) return null;
  if (hex.attackInvestment > 0 && hex.defenseInvestment === 0) {
    return { byId: hex.attackerId, progress: hex.battleProgress };
  }
  if (hex.defenseInvestment > 0 && hex.attackInvestment === 0) {
    if (hex.defenderId === null) return null;
    return { byId: hex.defenderId, progress: hex.battleProgress };
  }
  return null;
}

const tooltipPos = computed(() => {
  const hex = hovered.value;
  if (!hex || hex.attackerId === null) return null;
  const el = mapWrap.value;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const v = view.value ?? baseViewBox.value;
  const center = hexCenter(hex.q, hex.r);
  const left = ((center.x - v.x) / v.w) * rect.width;
  const top = ((center.y - v.y) / v.h) * rect.height;
  return { left, top: Math.max(70, top) };
});

function terrainFill(hex: Hex): string {
  return TERRAIN_COLORS[hex.terrain];
}

function ownerStyle(hex: Hex): { fill: string; stroke: string } | null {
  if (hex.ownerId === null) return null;
  const color = colorOf(hex.ownerId);
  return { fill: color, stroke: color };
}

function battleOverlay(hex: Hex): { fill: string; y: number; height: number } | null {
  if (hex.attackerId === null) return null;
  const box = hexPoints(hex.q, hex.r);
  const total = hex.attackInvestment + hex.defenseInvestment;
  const share = total === 0 ? 0.5 : hex.attackInvestment / total;
  return { fill: colorOf(hex.attackerId), y: box.minY, height: (box.maxY - box.minY) * share };
}
</script>

<template>
  <div ref="mapWrap" class="hex-map" @contextmenu.prevent @wheel.prevent="onWheel">
    <svg :viewBox="viewBox" class="hex-map__svg">
      <defs>
        <clipPath v-for="hex in props.hexes.filter((h) => h.attackerId !== null)" :key="`clip-${hex.q}-${hex.r}`" :id="`clip-${hex.q}-${hex.r}`">
          <rect
            v-if="battleOverlay(hex)"
            :x="hexPoints(hex.q, hex.r).minX"
            :y="battleOverlay(hex)!.y"
            :width="hexPoints(hex.q, hex.r).maxX - hexPoints(hex.q, hex.r).minX"
            :height="battleOverlay(hex)!.height"
          />
        </clipPath>
      </defs>
      <g
        v-for="hex in props.hexes"
        :key="`${hex.q},${hex.r}`"
        class="hex-group"
        @click="emit('click', hex)"
        @contextmenu.prevent="emit('select', { q: hex.q, r: hex.r })"
        @mouseenter="hoveredPos = { q: hex.q, r: hex.r }"
        @mouseleave="hoveredPos = null"
      >
        <polygon :points="hexPoints(hex.q, hex.r).points" :fill="terrainFill(hex)" class="hex" />
        <polygon
          v-if="ownerStyle(hex)"
          :points="hexPoints(hex.q, hex.r).points"
          :style="ownerStyle(hex)!"
          class="hex-tint"
        />
        <polygon
          v-if="battleOverlay(hex)"
          :points="hexPoints(hex.q, hex.r).points"
          :fill="battleOverlay(hex)!.fill"
          :clip-path="`url(#clip-${hex.q}-${hex.r})`"
          class="hex-battle"
        />
        <polygon
          v-if="captureState(hex)"
          :points="hexPoints(hex.q, hex.r).points"
          :stroke="colorOf(captureState(hex)!.byId)"
          class="hex-capture-ring"
        />
      </g>
    </svg>

    <div
      v-if="tooltipPos && hovered && hovered.attackerId !== null"
      class="battle-tooltip"
      :style="{ left: tooltipPos.left + 'px', top: tooltipPos.top + 'px' }"
    >
      <div class="battle-tooltip__row">
        <span class="battle-tooltip__name" :style="{ color: colorOf(hovered.attackerId) }">{{ playerName(hovered.attackerId) }}</span>
        <span class="battle-tooltip__pool">{{ hovered.attackInvestment }}</span>
      </div>
      <div class="battle-tooltip__row">
        <span class="battle-tooltip__name" :style="{ color: colorOf(hovered.defenderId) }">{{ playerName(hovered.defenderId) }}</span>
        <span class="battle-tooltip__pool">{{ hovered.defenseInvestment }}</span>
      </div>
      <div v-if="captureState(hovered)" class="battle-tooltip__capture">
        <div class="battle-tooltip__capture-label">
          Захват: {{ playerName(captureState(hovered)!.byId) }}
        </div>
        <div class="battle-tooltip__bar">
          <div
            class="battle-tooltip__bar-fill"
            :style="{ width: (captureState(hovered)!.progress / props.captureTicks) * 100 + '%' }"
          ></div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hex-map {
  position: relative;
  width: 100%;
  max-width: 1100px;
}

.hex-map__svg {
  display: block;
  width: 100%;
  height: auto;
}

.hex {
  stroke: #1a1a1a;
  stroke-width: 1.5;
  cursor: pointer;
  transition:
    stroke-width 0.12s ease,
    filter 0.12s ease;
}

.hex-group:hover .hex {
  stroke: #ffd54f;
  stroke-width: 3.5;
  filter: brightness(1.18);
}

.hex-tint {
  fill-opacity: 0.5;
  stroke-opacity: 1;
  stroke-width: 3.5;
  pointer-events: none;
}

.hex-group:hover .hex-tint {
  fill-opacity: 0.65;
  stroke-width: 4.5;
}

.hex-battle {
  stroke: #1a1a1a;
  stroke-width: 1.5;
  opacity: 0.55;
  pointer-events: none;
}

.hex-capture-ring {
  fill: none;
  stroke-width: 3;
  pointer-events: none;
}

.battle-tooltip {
  position: absolute;
  transform: translate(-50%, calc(-100% - 12px));
  background: rgba(20, 20, 26, 0.94);
  border: 1px solid #555;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  color: #fff;
  pointer-events: none;
  white-space: nowrap;
  z-index: 20;
}

.battle-tooltip__row {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  line-height: 1.5;
}

.battle-tooltip__pool {
  font-family: monospace;
  font-weight: 700;
}

.battle-tooltip__capture {
  margin-top: 6px;
}

.battle-tooltip__capture-label {
  font-size: 11px;
  color: #ffd54f;
  margin-bottom: 3px;
}

.battle-tooltip__bar {
  width: 120px;
  height: 6px;
  border-radius: 3px;
  background: #333;
  overflow: hidden;
}

.battle-tooltip__bar-fill {
  height: 100%;
  background: #ffd54f;
}
</style>
```

Примечание: зум уже встроен в этот файл — `onWheel` меняет `view`/`viewBox` (центрирование на курсоре, лимиты 0.5–3× относительно базового вида); тултип позиционируется через те же координаты, поэтому остаётся корректным при любом зуме.

- [ ] **Step 4: Пробросить пропсы в App.vue**

В `web/src/App.vue` замени строку:

```html
      <HexMap v-if="game" :hexes="game.hexes" :human-id="viewerId" @click="onHexClick" @select="onSelect" />
```

на:

```html
      <HexMap
        v-if="game"
        :hexes="game.hexes"
        :players="game.players"
        :human-id="viewerId"
        :capture-ticks="game.captureTicks"
        @click="onHexClick"
        @select="onSelect"
      />
```

- [ ] **Step 5: Собрать web**

Run: `npm run build` (workdir: `web`)
Expected: vue-tsc и vite build без ошибок.

- [ ] **Step 6: Проверить вручную**

Запусти `docker compose up --build -d` (dev-профиль), открой http://localhost:5173, сыграй с компьютером: атакуй гекс ИИ — в гексе нет цифр, при наведении появляется тултип с именами/пулами, при захвате — жёлтая полоса прогресса и обводка цвета захватывающего; колесо мыши приближает к курсору (0.5–3×).

- [ ] **Step 7: Коммит**

```bash
git add web/src/components/HexMap.vue web/src/App.vue web/src/types.ts server/src/game.ts
git commit -m "feat: модалка битвы при наведении, обводка захвата, зум колесом"
```

---

### Task 7: Заголовок — бургер и пауза справа

**Files:**
- Modify: `web/src/App.vue` (шаблон `.app__header` и CSS)

**Interfaces:**
- Produces: заголовок во всю ширину, слева название, справа кнопки паузы и бургера.

- [ ] **Step 1: Изменить разметку заголовка**

В `web/src/App.vue` замени:

```html
      <div class="app__header">
        <h1>Conquest</h1>
        <button class="app__btn" :disabled="!connected" @click="onPause">
          {{ game.paused ? 'Продолжить' : 'Пауза' }}
        </button>
        <button class="app__btn app__burger" :disabled="!connected" @click="burgerOpen = !burgerOpen">
          ☰
        </button>
      </div>
```

на:

```html
      <div class="app__header">
        <h1>Conquest</h1>
        <div class="app__controls">
          <button class="app__btn" :disabled="!connected" @click="onPause">
            {{ game.paused ? 'Продолжить' : 'Пауза' }}
          </button>
          <button class="app__btn app__burger" :disabled="!connected" @click="burgerOpen = !burgerOpen">
            ☰
          </button>
        </div>
      </div>
```

- [ ] **Step 2: Обновить CSS**

В `<style scoped>` замени:

```css
.app__header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 8px;
}
```

на:

```css
.app__header {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.app__controls {
  display: flex;
  gap: 8px;
}
```

- [ ] **Step 3: Собрать web**

Run: `npm run build` (workdir: `web`)
Expected: сборка без ошибок.

- [ ] **Step 4: Коммит**

```bash
git add web/src/App.vue
git commit -m "feat: бургер и пауза в правой части заголовка"
```

---

### Task 8: Итоговая проверка

**Files:** нет (проверка).

- [ ] **Step 1: Тесты сервера**

Run: `npm test` (workdir: `server`)
Expected: PASS.

- [ ] **Step 2: Сборка сервера**

Run: `npm run build` (workdir: `server`)
Expected: tsc без ошибок.

- [ ] **Step 3: Сборка web**

Run: `npm run build` (workdir: `web`)
Expected: vue-tsc + vite без ошибок.

- [ ] **Step 4: Smoke-тест**

Запусти dev-профиль `docker compose up --build -d`, открой игру: захват нейтрала без врага рядом — мгновенный; атака на гекс ИИ с вложением меньше стоимости — ошибка «Минимальное вложение в атаку — стоимость гекса»; атака с вложением ≥ стоимости — битва, защитник-ИИ отвечает; после победы остаток пула возвращается в очки.

- [ ] **Step 5: Коммит (если smoke-тест выявил фиксы — отдельными коммитами с описанием)**

```bash
git log --oneline -10
```
Expected: 8 коммитов по этапу (конфиг → механика → вложения → логи → ИИ → модалка → заголовок → итоговая проверка).
