# Битвы v3 и UI-правки — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Переделать механику битвы на знаковый прогресс захвата за лидером (перевес пула), уменьшить горы, запретить первый гекс на воде, перенести информацию о гексе на наведение, клик сделать действием, карту — на весь экран, добавить WASD-камеру, анимацию захвата и тик 500 мс.

**Architecture:** Сервер: `tickBattles` — знаковый `battleProgress` (+1 при перевесе атакующего, −1 при перевесе защитника, ±5 = исход), победитель получает остаток пула, проигравший теряет всё. Web: тултип на любом гексе через те же viewBox-координаты, клик = действие без выбора, полноэкранная карта с фиксированными оверлеями, WASD-пан через viewBox с клампом, flash-анимация по смене `ownerId`.

**Tech Stack:** Node TS (vitest), Vue 3 (script setup), SVG.

## Global Constraints

- Битва: оба пула −10/тик; `battleProgress` знаковый; ±`CAPTURE_TICKS` (5) = исход; победитель получает остаток пула; проигравший теряет всё; ничья при обоих нулевых пулах; вложения не сбрасывают прогресс (меняют лидера).
- Первая атака — минимум `terrainCost`; первый бесплатный гекс не может быть водой.
- Суша: равнина 45%, лес 25%, пустыня 20%, горы 10% (шахты — из гор, шанс 0.1).
- `CONQUEST_TICK_INTERVAL_MS` по умолчанию 500.
- Web: клик = действие; информация — на наведении; карта во весь экран; WASD/стрелки двигают камеру (только когда вид меньше карты); flash при смене владельца.
- Схема БД не меняется (`battle_progress` float — знаковые значения ок).
- Тесты: `npm test` (vitest), сборки `npm run build` в `server/` и `web/`.

---

### Task 1: Механика битвы v3 — знаковый прогресс за лидером

**Files:**
- Modify: `server/src/rules.ts`
- Test: `server/test/rules.test.ts`

**Interfaces:**
- Produces: `tickBattles(state): BattleResult[]` — новая семантика `battleProgress` (знаковое); `applyAttack`/`applyDefend` больше не сбрасывают прогресс.
- Consumes: `CAPTURE_TICKS` (5), `DRAIN_PER_TICK` (10) — уже есть.

- [ ] **Step 1: Написать тесты (RED)**

В `server/test/rules.test.ts` полностью замени блоки `describe('тик битвы: трата', ...)` и `describe('тик битвы: захват', ...)` (включая устаревшие тесты отмены захвата) на:

```ts
describe('тик битвы: перевес двигает захват', () => {
  it('оба пула тратятся по DRAIN_PER_TICK за тик', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 600, defenseInvestment: 300 }]);
    tickBattles(s);
    expect(findHex(s, 6, 5)!.attackInvestment).toBe(590);
    expect(findHex(s, 6, 5)!.defenseInvestment).toBe(290);
  });
  it('перевес атаки двигает прогресс в плюс', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 600, defenseInvestment: 300 }]);
    tickBattles(s);
    expect(findHex(s, 6, 5)!.battleProgress).toBe(1);
  });
  it('перевес обороны двигает прогресс в минус', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, defenderId: AI, attackerId: P, attackInvestment: 300, defenseInvestment: 600 }]);
    tickBattles(s);
    expect(findHex(s, 6, 5)!.battleProgress).toBe(-1);
  });
  it('равные пулы не двигают прогресс', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 500, defenseInvestment: 500 }]);
    tickBattles(s);
    expect(findHex(s, 6, 5)!.battleProgress).toBe(0);
  });
  it('смена лидера разворачивает прогресс', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 600, defenseInvestment: 300, battleProgress: 3 }]);
    tickBattles(s);
    expect(findHex(s, 6, 5)!.battleProgress).toBe(4);
    applyDefend(s, AI, 6, 5, 400);
    tickBattles(s);
    expect(findHex(s, 6, 5)!.battleProgress).toBe(3);
  });
  it('завершение: +5 тиков перевеса — атакующий захватывает, остаток возвращается', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 600, defenseInvestment: 300 }], [{ id: 1, points: 400 }, { id: 2, points: 700 }]);
    for (let i = 0; i < 5; i++) tickBattles(s);
    const hex = findHex(s, 6, 5)!;
    expect(hex.ownerId).toBe(P);
    expect(hex.attackerId).toBeNull();
    expect(hex.battleProgress).toBe(0);
    expect(s.players[0].points).toBe(950);
    expect(s.players[1].points).toBe(700);
  });
  it('завершение: −5 тиков перевеса — защитник отбивает, остаток возвращается', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, defenderId: AI, attackerId: P, attackInvestment: 300, defenseInvestment: 600 }], [{ id: 1, points: 700 }, { id: 2, points: 400 }]);
    for (let i = 0; i < 5; i++) tickBattles(s);
    const hex = findHex(s, 6, 5)!;
    expect(hex.ownerId).toBe(AI);
    expect(hex.attackerId).toBeNull();
    expect(s.players[1].points).toBe(950);
    expect(s.players[0].points).toBe(700);
  });
  it('нейтральный спорный гекс достаётся защитнику при его перевесе', () => {
    const s = makeState([{ q: 4, r: 5, attackerId: P, defenderId: AI, attackInvestment: 300, defenseInvestment: 600 }, { q: 5, r: 5, ownerId: AI }]);
    for (let i = 0; i < 5; i++) tickBattles(s);
    expect(findHex(s, 4, 5)!.ownerId).toBe(AI);
  });
  it('ничья: оба пула дошли до 0 — битва заканчивается без победителя', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 100, defenseInvestment: 100 }]);
    const results: { q: number; r: number; winnerId: number | null }[] = [];
    for (let i = 0; i < 10; i++) results.push(...tickBattles(s));
    const hex = findHex(s, 6, 5)!;
    expect(hex.ownerId).toBe(AI);
    expect(hex.attackerId).toBeNull();
    expect(results).toEqual([{ q: 6, r: 5, winnerId: null }]);
  });
});
```

Также в блоке `атака на гекс соперника` замени два устаревших теста:

```ts
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

на:

```ts
  it('вложения не сбрасывают прогресс — они меняют лидера', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 300, battleProgress: 2 }]);
    applyDefend(s, AI, 6, 5, 400);
    expect(findHex(s, 6, 5)!.battleProgress).toBe(2);
    expect(findHex(s, 6, 5)!.defenseInvestment).toBe(400);
    applyAttack(s, P, 6, 5, 200);
    expect(findHex(s, 6, 5)!.battleProgress).toBe(2);
    expect(findHex(s, 6, 5)!.attackInvestment).toBe(500);
  });
```

- [ ] **Step 2: Прогнать тесты — должны упасть**

Run: `npm test` (workdir: `server`)
Expected: FAIL (старая механика: прогресс не движется при обоих положительных пулах).

- [ ] **Step 3: Переписать tickBattles в rules.ts**

Замени функцию `tickBattles` целиком на:

```ts
export function tickBattles(state: GameState): BattleResult[] {
  const results: BattleResult[] = [];
  for (const hex of state.hexes) {
    if (hex.attackerId === null) continue;
    hex.attackInvestment = Math.max(0, hex.attackInvestment - DRAIN_PER_TICK);
    hex.defenseInvestment = Math.max(0, hex.defenseInvestment - DRAIN_PER_TICK);
    if (hex.attackInvestment === 0 && hex.defenseInvestment === 0) {
      results.push({ q: hex.q, r: hex.r, winnerId: null });
      resetBattle(hex);
      continue;
    }
    if (hex.attackInvestment > hex.defenseInvestment) {
      hex.battleProgress += 1;
    } else if (hex.defenseInvestment > hex.attackInvestment) {
      hex.battleProgress -= 1;
    }
    if (hex.battleProgress >= CAPTURE_TICKS) {
      const winner = state.players.find((p) => p.id === hex.attackerId);
      if (winner) winner.points += hex.attackInvestment;
      results.push({ q: hex.q, r: hex.r, winnerId: hex.attackerId });
      hex.ownerId = hex.attackerId;
      resetBattle(hex);
      continue;
    }
    if (hex.battleProgress <= -CAPTURE_TICKS) {
      if (hex.defenderId === null) {
        results.push({ q: hex.q, r: hex.r, winnerId: null });
        resetBattle(hex);
        continue;
      }
      const winner = state.players.find((p) => p.id === hex.defenderId);
      if (winner) winner.points += hex.defenseInvestment;
      results.push({ q: hex.q, r: hex.r, winnerId: hex.defenderId });
      hex.ownerId = hex.defenderId;
      resetBattle(hex);
    }
  }
  return results;
}
```

- [ ] **Step 4: Убрать сброс прогресса из applyAttack/applyDefend**

В `server/src/rules.ts` в `applyAttack` и `applyDefend` удали строки `if (wasZero) hex.battleProgress = 0;` и соответствующие объявления `const wasZero = ...`. В `applyAttack` оставь установку `hex.battleProgress = 0;` только внутри `if (hex.attackerId === null)` (новая битва стартует с нуля).

- [ ] **Step 5: Прогнать тесты и сборку**

Run: `npm test && npm run build` (workdir: `server`)
Expected: PASS, tsc без ошибок.

- [ ] **Step 6: Коммит**

```bash
git add server/src/rules.ts server/test/rules.test.ts
git commit -m "feat: битва v3 — знаковый прогресс захвата за лидером (перевес пула)"
```

---

### Task 2: ИИ под механику перевеса + первый гекс не на воде

**Files:**
- Modify: `server/src/ai.ts`
- Modify: `server/src/rules.ts` (validateCapture: первый гекс не вода)
- Test: `server/test/ai.test.ts`, `server/test/rules.test.ts`

**Interfaces:**
- Produces: `chooseAiAction` — защита при `attack >= defense` (вкладывает разницу+1), первый захват исключает воду; `validateCapture` отклоняет воду для первого гекса.

- [ ] **Step 1: Обновить ai.ts**

В `server/src/ai.ts` в первом цикле (защита/оспаривание) замени два условия на одно:

```ts
    if (hex.attackInvestment >= hex.defenseInvestment) {
      const invest = Math.min(ai.points, hex.attackInvestment - hex.defenseInvestment + 1);
      if (invest >= 1) return { type: 'defend', q: hex.q, r: hex.r, points: invest };
    }
```

(блок `if (hex.defenseInvestment === 0 && hex.attackInvestment > 0) { ... }` удаляется — покрыт общим правилом).

В `chooseFirstCapture` добавь фильтр воды:

```ts
  const free = state.hexes.filter(
    (hex) => hex.ownerId === null && hex.attackerId === null && hex.terrain !== 'water',
  );
```

- [ ] **Step 2: Обновить rules.ts (первый гекс не вода)**

В `server/src/rules.ts` в `validateCapture` замени:

```ts
  const count = hexCount(state, playerId);
  if (count === 0) return { ok: true };
```

на:

```ts
  const count = hexCount(state, playerId);
  if (count === 0) {
    if (hex.terrain === 'water') return { ok: false, error: 'Первый гекс не может быть на воде' };
    return { ok: true };
  }
```

- [ ] **Step 3: Обновить тесты**

В `server/test/rules.test.ts` в блок `первый бесплатный захват` добавь:

```ts
  it('первый гекс не может быть на воде', () => {
    const s = makeState([{ q: 5, r: 5, terrain: 'water' }]);
    expect(validateCapture(s, P, 5, 5).ok).toBe(false);
    const s2 = makeState([{ q: 5, r: 5, terrain: 'water' }]);
    expect(validateCapture(s2, P, 6, 5).ok).toBe(true);
  });
```

В `server/test/ai.test.ts`:
- тест `приоритет 1: враг захватывает наш гекс — вкладываемся с перевесом` ожидает `points: 401` — остаётся валидным (единое правило).
- добавь в конец describe-блока:

```ts
  it('первый захват не выбирает воду', () => {
    const s = makeState([{ q: 0, r: 0, terrain: 'water' }, { q: 8, r: 6, ownerId: 1 }]);
    const action = chooseAiAction(s, 2)!;
    const hex = s.hexes.find((h) => h.q === action.q && h.r === action.r)!;
    expect(hex.terrain).not.toBe('water');
  });
```

- [ ] **Step 4: Прогнать тесты и сборку**

Run: `npm test && npm run build` (workdir: `server`)
Expected: PASS, tsc без ошибок.

- [ ] **Step 5: Коммит**

```bash
git add server/src/ai.ts server/src/rules.ts server/test/ai.test.ts server/test/rules.test.ts
git commit -m "feat: ИИ по перевесу пула, первый гекс не на воде"
```

---

### Task 3: Меньше гор — веса террейнов

**Files:**
- Modify: `server/src/map.ts`
- Test: `server/test/map.test.ts`

**Interfaces:**
- Produces: `randomTerrain` с весами суши: равнина 45, лес 25, пустыня 20, горы 10; шахты — из гор с шансом `config.mineChance`.

- [ ] **Step 1: Написать тест (RED)**

В `server/test/map.test.ts` добавь:

```ts
  it('гор меньше 15% и больше 5% на большой выборке', () => {
    const hexes = Array.from({ length: 50 }, () => generateMap('normal')).flat();
    const mountains = hexes.filter((h) => h.terrain === 'mountain').length;
    expect(mountains / hexes.length).toBeLessThan(0.15);
    expect(mountains / hexes.length).toBeGreaterThan(0.05);
  });
```

- [ ] **Step 2: Прогнать тест — должен упасть**

Run: `npm test` (workdir: `server`)
Expected: FAIL (сейчас гор ~20%, > 15%).

- [ ] **Step 3: Реализовать веса**

В `server/src/map.ts` замени `randomTerrain` и константу `LAND_TERRAINS` на:

```ts
const LAND_WEIGHTS: { terrain: Terrain; weight: number }[] = [
  { terrain: 'grass', weight: 45 },
  { terrain: 'forest', weight: 25 },
  { terrain: 'desert', weight: 20 },
  { terrain: 'mountain', weight: 10 },
];

function randomTerrain(): Terrain {
  const total = LAND_WEIGHTS.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = Math.random() * total;
  for (const entry of LAND_WEIGHTS) {
    roll -= entry.weight;
    if (roll <= 0) {
      let terrain = entry.terrain;
      if (terrain === 'mountain' && Math.random() < config.mineChance) terrain = 'mine';
      return terrain;
    }
  }
  return LAND_WEIGHTS[LAND_WEIGHTS.length - 1].terrain;
}
```

(убедись, что нигде больше не используется `LAND_TERRAINS`; удали его, если не нужен.)

- [ ] **Step 4: Прогнать тесты и сборку**

Run: `npm test && npm run build` (workdir: `server`)
Expected: PASS (горы ~9% в пределах 5–15%), tsc чистый.

- [ ] **Step 5: Коммит**

```bash
git add server/src/map.ts server/test/map.test.ts
git commit -m "feat: меньше гор — веса террейнов (10%)"
```

---

### Task 4: Тик 500 мс

**Files:**
- Modify: `server/src/config.ts`
- Modify: `docker-compose.yml` (комментарий, если упоминается TICK_INTERVAL)

**Interfaces:**
- Produces: `config.tickIntervalMs` по умолчанию 500.

- [ ] **Step 1: Изменить конфиг**

В `server/src/config.ts` замени `tickIntervalMs: number('CONQUEST_TICK_INTERVAL_MS', 1000),` на `tickIntervalMs: number('CONQUEST_TICK_INTERVAL_MS', 500),`.

Проверь `docker-compose.yml`: если в комментариях есть `CONQUEST_TICK_INTERVAL_MS: 1000` — замени значение на 500.

- [ ] **Step 2: Прогнать тесты и сборку**

Run: `npm test && npm run build` (workdir: `server`)
Expected: PASS, tsc чистый.

- [ ] **Step 3: Коммит**

```bash
git add server/src/config.ts docker-compose.yml
git commit -m "feat: тик 500 мс"
```

---

### Task 5: Web — тултип на любом гексе, знаковый прогресс, клик = действие

**Files:**
- Modify: `web/src/components/HexMap.vue`
- Modify: `web/src/App.vue`
- Modify: `web/src/components/ArmyBar.vue`

**Interfaces:**
- Produces: HexMap показывает тултип при наведении на ЛЮБОЙ гекс (местность, стоимость, владелец; при битве — пулы, лидер, знаковый прогресс); кольцо захвата по лидеру (`battleProgress !== 0`); `captureState` со знаковым прогрессом; событие `select` удаляется; App.vue: клик = действие без выбора; ArmyBar — только ползунок.

- [ ] **Step 1: Обновить HexMap.vue — тултип и знаковый прогресс**

В `web/src/components/HexMap.vue`:

1. Импорт дополни:

```ts
import { playerColor, TERRAIN_COLORS, TERRAIN_COSTS, TERRAIN_LABELS, type Hex, type Player } from '../types';
```

2. `captureState` замени на знаковую версию:

```ts
function captureState(hex: Hex): { byId: number; progress: number } | null {
  if (hex.attackerId === null || hex.battleProgress === 0) return null;
  if (hex.battleProgress > 0) return { byId: hex.attackerId, progress: hex.battleProgress };
  if (hex.defenderId === null) return null;
  return { byId: hex.defenderId, progress: -hex.battleProgress };
}
```

3. В `tooltipPos` убери условие `hex.attackerId === null` (тултип для любого гекса):

```ts
const tooltipPos = computed(() => {
  const hex = hovered.value;
  if (!hex) return null;
  ...
});
```

4. Замени блок тултипа в шаблоне на:

```html
    <div
      v-if="tooltipPos && hovered"
      class="battle-tooltip"
      :style="{ left: tooltipPos.left + 'px', top: tooltipPos.top + 'px' }"
    >
      <div class="battle-tooltip__row">
        <span>{{ TERRAIN_LABELS[hovered.terrain] }}</span>
        <span class="battle-tooltip__pool">{{ TERRAIN_COSTS[hovered.terrain] }}</span>
      </div>
      <div class="battle-tooltip__row">
        <span>Владелец: {{ playerName(hovered.ownerId) }}</span>
      </div>
      <template v-if="hovered.attackerId !== null">
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
              :style="{ width: Math.min(100, (captureState(hovered)!.progress / props.captureTicks) * 100) + '%' }"
            ></div>
          </div>
        </div>
      </template>
    </div>
```

5. Убери эмит `select` из `defineEmits` и обработчик `@contextmenu.prevent="emit('select', ...)"` из шаблона (гекс-групп): клик остаётся, контекстное меню больше не выбирает гекс.

- [ ] **Step 2: Обновить App.vue — клик = действие**

В `web/src/App.vue`:
1. Удали `selected` ref, функцию `onSelect`, обновление `selected` в `onState`, и `@select` из тега HexMap.
2. `onHexClick` замени на:

```ts
function onHexClick(hex: Hex): void {
  if (playerId.value === null) return;
  const send = Math.max(1, Math.min(army.value, myPlayer.value?.points ?? 0));
  if (hex.attackerId !== null) {
    if (hex.attackerId === playerId.value) {
      client.sendAttack(hex.q, hex.r, send);
    } else if (hex.ownerId === playerId.value || isAdjacentToMine(hex)) {
      client.sendDefend(hex.q, hex.r, send);
    }
    return;
  }
  if (isCapturable(hex)) {
    client.sendCapture(hex.q, hex.r, army.value);
  }
}
```

3. Убери `onSelect` из `@select` в шаблоне HexMap (остаётся только `@click="onHexClick"`).
4. Убери передачу `:hex="selected"` в ArmyBar.

- [ ] **Step 3: Обновить ArmyBar.vue — только ползунок**

В `web/src/components/ArmyBar.vue`:
1. Удали проп `hex: Hex | null` из `defineProps` и импорт `TERRAIN_LABELS`/`Hex` (если не используются).
2. Удали блоки `.army-bar__info` из шаблона и их CSS; оставь только `.army-bar__row` (ползунок) и общую подпись «атакующих · макс N».

- [ ] **Step 4: Собрать web**

Run: `npm run build` (workdir: `web`)
Expected: без ошибок.

- [ ] **Step 5: Коммит**

```bash
git add web/src/components/HexMap.vue web/src/App.vue web/src/components/ArmyBar.vue
git commit -m "feat: web — тултип на любом гексе, знаковый прогресс, клик = действие"
```

---

### Task 6: Web — полноэкранная карта, WASD-камера, анимация захвата

**Files:**
- Modify: `web/src/components/HexMap.vue`
- Modify: `web/src/App.vue`

**Interfaces:**
- Produces: карта `position: fixed; inset: 0` (оверлеи поверх); WASD/стрелки двигают viewBox с клампом в базовых границах (при зуме); flash-перекраска гекса при смене `ownerId`.

- [ ] **Step 1: Полноэкранная карта**

В `web/src/components/HexMap.vue` в `<style scoped>` замени:

```css
.hex-map {
  position: relative;
  width: 100%;
  max-width: 1100px;
}
```

на:

```css
.hex-map {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
}
```

(остальные фиксированные элементы — HUD, ArmyBar, лог, баннеры — уже позиционированы поверх; убедись, что их `z-index` больше и что баннеры не конфликтуют.)

В `web/src/App.vue` игровой экран оберни в контейнер (шаблон `v-else-if="room && game"`):

```html
    <template v-else-if="room && game">
      <div class="game-screen">
        ...текущее содержимое (header, баннеры, Hud, HexMap, ArmyBar, лог)...
      </div>
    </template>
```

и добавь в `<style scoped>`:

```css
.game-screen {
  position: fixed;
  inset: 0;
}
```

Проверь, что `.app`-контейнер меню не затронут (экран меню остаётся в обычном потоке).

- [ ] **Step 2: WASD-камера**

В `web/src/components/HexMap.vue` в `<script setup>` добавь (после `onWheel`):

```ts
const PAN_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);
const pressedKeys = new Set<string>();
let panRaf = 0;

function onKeyDown(e: KeyboardEvent): void {
  if (!PAN_KEYS.has(e.code)) return;
  pressedKeys.add(e.code);
  if (!panRaf) panRaf = requestAnimationFrame(panStep);
}

function onKeyUp(e: KeyboardEvent): void {
  pressedKeys.delete(e.code);
  if (pressedKeys.size === 0 && panRaf) {
    cancelAnimationFrame(panRaf);
    panRaf = 0;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function panStep(): void {
  const base = baseViewBox.value;
  const v = view.value ?? base;
  let dx = 0;
  let dy = 0;
  const stepX = v.w * 0.03;
  const stepY = v.h * 0.03;
  if (pressedKeys.has('KeyA') || pressedKeys.has('ArrowLeft')) dx -= stepX;
  if (pressedKeys.has('KeyD') || pressedKeys.has('ArrowRight')) dx += stepX;
  if (pressedKeys.has('KeyW') || pressedKeys.has('ArrowUp')) dy -= stepY;
  if (pressedKeys.has('KeyS') || pressedKeys.has('ArrowDown')) dy += stepY;
  if (dx !== 0 || dy !== 0) {
    view.value = {
      ...v,
      x: clamp(v.x + dx, base.x, base.x + base.w - v.w),
      y: clamp(v.y + dy, base.y, base.y + base.h - v.h),
    };
  }
  panRaf = requestAnimationFrame(panStep);
}
```

(кламп гарантирует: когда вид равен базовому (карта целиком влезает), движение невозможно — камера работает только при зуме.)

В `onMounted` добавь слушатели, в `onBeforeUnmount` — удали и отмени rAF. Для этого импортируй `onBeforeUnmount` из vue (в файле уже есть `computed, ref, watch`).

- [ ] **Step 3: Анимация захвата**

В `web/src/components/HexMap.vue` в `<script setup>` добавь:

```ts
const prevOwners = ref<Map<string, number | null>>(new Map());
const flashKeys = ref<Set<string>>(new Set());

watch(
  () => props.hexes,
  (hexes) => {
    const next = new Map<string, number | null>();
    for (const hex of hexes) {
      const key = `${hex.q},${hex.r}`;
      next.set(key, hex.ownerId);
      const prev = prevOwners.value.get(key);
      if (prev !== undefined && prev !== hex.ownerId && hex.ownerId !== null) {
        flashKeys.value = new Set(flashKeys.value).add(key);
        setTimeout(() => {
          const s = new Set(flashKeys.value);
          s.delete(key);
          flashKeys.value = s;
        }, 600);
      }
    }
    prevOwners.value = next;
  },
);
```

Полигону тонировки владельца добавь класс (в шаблоне, где `ownerStyle(hex)`):

```html
        <polygon
          v-if="ownerStyle(hex)"
          :points="hexPoints(hex.q, hex.r).points"
          :style="ownerStyle(hex)!"
          :class="{ 'hex-flash': flashKeys.has(hex.q + ',' + hex.r) }"
          class="hex-tint"
        />
```

И в `<style scoped>` добавь:

```css
.hex-flash {
  animation: owner-flash 0.6s ease-out;
}

@keyframes owner-flash {
  0% {
    fill: #ffffff;
    fill-opacity: 0.9;
  }
  60% {
    fill: #ffffff;
    fill-opacity: 0.8;
  }
  100% {
    fill-opacity: 0.5;
  }
}
```

- [ ] **Step 4: Собрать web и сервер**

Run: `npm run build` (workdir: `web`) и `npm test && npm run build` (workdir: `server`)
Expected: обе сборки чистые, тесты PASS.

- [ ] **Step 5: Коммит**

```bash
git add web/src/components/HexMap.vue web/src/App.vue
git commit -m "feat: web — полноэкранная карта, WASD-камера, анимация захвата"
```

---

### Task 7: Итоговая проверка

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

Запусти dev-профиль `docker compose up --build -d`, открой игру:
- соло: атакуй гекс ИИ с вложением больше его пула — тултип показывает пулы и знаковый прогресс, кольцо у лидера; через ~5 тиков гекс захвачен (flash), остаток пула вернулся;
- наведение на любой гекс — местность/стоимость/владелец; клик захватывает/атакует сразу;
- карта во весь экран, HUD/ползунок/лог поверх;
- при зуме WASD двигает камеру, без зума — не двигается;
- на картах остров/беларусь первый гекс на воде невозможен;
- гор на карте заметно меньше прежнего.

Если какой-то шаг невозможен в окружении — отметь в отчёте.

- [ ] **Step 5: Коммит (если smoke-тест выявил фиксы — отдельными коммитами с описанием)**

```bash
git log --oneline -10
```
Expected: 7 коммитов этапа (механика → ИИ/вода → горы → тик → тултип/клик → полноэкран/WASD/flash → проверка).
