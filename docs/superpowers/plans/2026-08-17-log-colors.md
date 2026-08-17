# Цветной лог (красная война, зелёный мир/союз) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Лог внизу справа выделяет объявление войны красным текстом, а установление мира/союза — зелёным.

**Architecture:** Лог превращается из плоских строк в структурированные записи `{ text, kind }` на сервере; клиент рендерит их с CSS-классами по `kind`. Статусы война/мир/союз уже работают (по умолчанию мир, война через дипломатию) — изменений не требуется, только регрессия.

**Tech Stack:** TypeScript, Node (tsx), vitest, Vue 3.

## Global Constraints

- Серверные строки лога остаются на английском (решение из спека языков, их не переводим).
- `kind` только трёх значений: `'info' | 'war' | 'diplomacy'`. Мир/союз — только `'diplomacy'`, война — только `'war'`, всё остальное — `'info'`.
- Никакой правки параллельно изменённых файлов вне затронутых строк: `server/src/rooms.ts`, `server/test/rooms.test.ts`, `web/src/types.ts`, `web/src/App.vue` — в этих файлах работают параллельные агенты (end-game, majorityHolderId, палитра). Редактируем только указанные строки.

---

### Task 1: Сервер — структурированные записи лога

**Files:**
- Modify: `server/src/rooms.ts:42-56` (типы), `:736-738` (addLog), `:427`, `:548` (война), `:346`, `:577` (мир/союз)
- Test: `server/test/rooms.test.ts:149`, `:523`, `:704`, `:708` (правки существующих), `:524` (новый тест в describe «Room: дипломатия»)

**Interfaces:**
- Produces: `export type LogKind = 'info' | 'war' | 'diplomacy'`; `export interface LogEntry { text: string; kind: LogKind }`; `RoomView.log: LogEntry[]`; `addLog(message: string, kind: LogKind = 'info')`.

- [ ] **Step 1: Обновить существующие тесты под `entry.text`, добавить тест на `kind`**

В `server/test/rooms.test.ts` заменить четыре использования:

- строка 149: `expect(log.some((entry) => entry.includes('захватил'))).toBe(false);` → `expect(log.some((entry) => entry.text.includes('захватил'))).toBe(false);`
- строка 523: `expect(room.view(1).log.some((l) => l.includes('declared war'))).toBe(true);` → `expect(room.view(1).log.some((l) => l.text.includes('declared war'))).toBe(true);`
- строка 704: `expect(room.view(1).log.some((l) => l.includes('built a fortress'))).toBe(true);` → `expect(room.view(1).log.some((l) => l.text.includes('built a fortress'))).toBe(true);`
- строка 708: `expect(room.view(1).log.some((l) => l.includes('removed a fortress'))).toBe(true);` → `expect(room.view(1).log.some((l) => l.text.includes('removed a fortress'))).toBe(true);`

После строки 524 (внутри `describe('Room: дипломатия')`) добавить тест:

```ts
  it('объявление войны попадает в лог с kind=war', () => {
    const room = new Room(1, 'Тест', 'normal', 6, true, 2, () => 0.5);
    room.addHuman('A', 1);
    room.start(1);
    const g = room.gameState!;
    for (const [playerId, i] of [[1, 0], [2, 1], [3, 2]] as [number, number][]) {
      g.hexes[i].ownerId = playerId;
      g.players.find((p) => p.id === playerId)!.capital = { q: g.hexes[i].q, r: g.hexes[i].r };
    }
    const hex = g.hexes.find((h) => h.ownerId === 2)!;
    room.handleAction(1, 'declare-war', { q: hex.q, r: hex.r });
    const entry = room.view(1).log.find((l) => l.text.includes('declared war'))!;
    expect(entry.kind).toBe('war');
  });
```

- [ ] **Step 2: Прогнать тесты — должны падать**

Run: `npm test` (в `server/`)
Expected: FAIL — ошибки типов `entry.text`/`l.text` не существует на `string`, тест `kind=war` не компилируется.

- [ ] **Step 3: Реализовать типы и addLog**

В `server/src/rooms.ts`:

Добавить перед `RoomView` (после строки 40):

```ts
export type LogKind = 'info' | 'war' | 'diplomacy';

export interface LogEntry {
  text: string;
  kind: LogKind;
}
```

- строка 55: `log: string[];` → `log: LogEntry[];`
- строка 77: `private log: string[] = [];` → `private log: LogEntry[] = [];`
- строки 735-738 (addLog):

```ts
  private addLog(message: string, kind: LogKind = 'info'): void {
    this.log.unshift({ text: message, kind });
    if (this.log.length > 100) this.log.pop();
  }
```

- [ ] **Step 4: Пометить войну и мир/союз**

В `server/src/rooms.ts`:

- строка 427: `this.addLog(\`${this.playerName(aiId)} declared war on ${this.playerName(target.id)}\`, 'war');`
- строка 548: `this.addLog(\`${this.playerName(playerId)} declared war on ${this.playerName(target)}\`, 'war');`
- строка 346: `this.addLog(\`${this.playerName(aiPlayer.id)} and ${this.playerName(proposal.from)} ${proposal.kind === 'peace' ? 'made peace' : 'formed an alliance'}\`, 'diplomacy');`
- строка 577: `this.addLog(\`${this.playerName(playerId)} and ${this.playerName(proposer)} ${proposal.kind === 'peace' ? 'made peace' : 'formed an alliance'}\`, 'diplomacy');`

(Вызовы `addLog` без второго аргумента не меняем — по умолчанию `'info'`.)

- [ ] **Step 5: Прогнать тесты**

Run: `npm test` (в `server/`)
Expected: PASS — все тесты, включая новый `kind=war`.

- [ ] **Step 6: Commit**

```bash
git add server/src/rooms.ts server/test/rooms.test.ts
git commit -m "feat: сервер — структурированный лог (war/diplomacy/info) для цветной отрисовки"
```

---

### Task 2: Клиент — цветная отрисовка лога

**Files:**
- Modify: `web/src/types.ts:107`, `web/src/App.vue:616-617` и CSS после `:1035`

**Interfaces:**
- Consumes: `RoomView.log: { text: string; kind: 'info' | 'war' | 'diplomacy' }[]` (JSON от сервера, Task 1).

- [ ] **Step 1: Тип лога на клиенте**

В `web/src/types.ts` строка 107:

```ts
  log: string[];
```
→
```ts
  log: { text: string; kind: 'info' | 'war' | 'diplomacy' }[];
```

- [ ] **Step 2: Рендер с классом по kind**

В `web/src/App.vue` строка 617:

```html
<div v-for="(entry, i) in room.log" :key="i" class="log-panel__entry" :class="`log-panel__entry--${entry.kind}`">{{ entry.text }}</div>
```

- [ ] **Step 3: CSS-цвета**

В `web/src/App.vue` после `.log-panel__entry:last-child` (строка ~1035) добавить:

```css
.log-panel__entry--war {
  color: #ff6b6b;
}

.log-panel__entry--diplomacy {
  color: #69db7c;
}
```

- [ ] **Step 4: Проверка сборки**

Run: `npm run build` (в `web/`)
Expected: PASS — `vue-tsc` без ошибок типов, vite build успешен.

- [ ] **Step 5: Ручная проверка**

Запустить `npm run dev` в `server/` и `web/`, в игре ПКМ по вражескому гексу → «War». Ожидание: строка «X declared war on Y» красная; после принятия мира/союза строка «... made peace / formed an alliance» зелёная; остальные записи серые.

- [ ] **Step 6: Commit**

```bash
git add web/src/types.ts web/src/App.vue
git commit -m "feat: клиент — красная война и зелёный мир/союз в логе"
```

---

### Task 3: Регрессия

- [ ] **Step 1: Полный прогон**

Run: `npm test` в `server/`, `npm run build` в `web/`
Expected: все тесты PASS, сборка без ошибок.

- [ ] **Step 2: Проверка статусов (регрессия дипломатии)**

Уже покрыто существующими тестами в `server/test/rules.test.ts`:
- `describe('дипломатия')`, строка 829: по умолчанию `relation(...) === 'peace'` — все в мире.
- строки 838-843: `declareWar` меняет отношение на войну и втягивает союзников.

Если оба есть — ничего не добавлять. Если какого-то нет — добавить в `describe('дипломатия')`:

```ts
  it('по умолчанию все в мире', () => {
    const s = makeState();
    expect(relation(s, P, AI)).toBe('peace');
  });
```

- [ ] **Step 3: Commit (если тест добавлялся)**

```bash
git add server/test/rules.test.ts
git commit -m "test: по умолчанию все игроки в мире"
```
