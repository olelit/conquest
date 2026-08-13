# Дипломатия — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Отношения мир/союз/война между парами игроков: блок атак в мире, взаимное вступление союзников в войну, предложения мира/союза через ПКМ-меню, агрессия ИИ по силовому соотношению с кэшем разведки (30 с), фильтрация ресурсов в HUD для врагов.

**Architecture:** `GameState.diplomacy: DiplomacyMap` (ключ `minId-maxId`, отсутствие = мир). `declareWar` втягивает союзников обеих сторон. Валидаторы блокируют атаки/захваты без войны. Комната хранит `pendingProposals`, обрабатывает ws-сообщения, отвечает за предложения ИИ, агрессию (`maybeDeclareWar` + `scoutCache`) и фильтрует `view()` по зрителю.

**Tech Stack:** Node.js + TypeScript + vitest (server); Vue 3 + Vite (web).

## Global Constraints

- Тесты сервера: `npx vitest run` из `server/` (161 существующих тестов зелёные).
- Проверка web: `npm run build` из `web/`.
- Язык логов/сообщений — русский.
- Спецификация: `docs/superpowers/specs/2026-08-14-diplomacy-design.md`.
- `GameState.diplomacy?: DiplomacyMap` — опциональное поле (undefined = все в мире); `rooms.ts` инициализирует при старте/рестарте.
- Сообщения: `declare-war {q,r}`, `propose {q,r,kind}`, `respond-proposal {q,r,accept}` — цель определяется владельцем гекса.

---

### Task 1: Правила — отношения, объявление войны, блокировки

**Files:**
- Modify: `server/src/rules.ts`
- Test: `server/test/rules.test.ts`

**Interfaces:**
- Produces: `DiplomacyRelation = 'peace' | 'war' | 'alliance'`; `DiplomacyMap = Map<string, DiplomacyRelation>`; `relation(state, a, b)`; `alliesOf(state, playerId): number[]`; `declareWar(state, a, b)`; `makePeace(state, a, b)`; `makeAlliance(state, a, b)`; `hasPeacefulNeighbor(state, q, r, playerId): boolean`. Блокировки в `validateAttack` и `validateCapture`; `applyEnclosure` не захватывает владения без войны.

- [ ] **Step 1: Написать падающие тесты**

В `server/test/rules.test.ts` добавить:

```ts
describe('дипломатия', () => {
  it('по умолчанию все в мире', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: AI }]);
    expect(relation(s, P, AI)).toBe('peace');
  });
  it('объявление войны втягивает союзников обеих сторон', () => {
    const s = makeState([], [
      { id: 1, points: 100 }, { id: 2, points: 100 },
      { id: 3, points: 100 }, { id: 4, points: 100 },
    ]);
    makeAlliance(s, P, 3);
    makeAlliance(s, AI, 4);
    declareWar(s, P, AI);
    expect(relation(s, P, AI)).toBe('war');
    expect(relation(s, 3, AI)).toBe('war');
    expect(relation(s, P, 4)).toBe('war');
    expect(relation(s, 3, 4)).toBe('war');
    expect(relation(s, P, 3)).toBe('alliance');
    expect(alliesOf(s, P)).toEqual([3]);
  });
  it('в мире нельзя атаковать чужой гекс', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: AI }, { q: 6, r: 5, ownerId: P }]);
    expect(validateAttack(s, P, 5, 5, 200).ok).toBe(false);
    declareWar(s, P, AI);
    expect(validateAttack(s, P, 5, 5, 200).ok).toBe(true);
  });
  it('в мире нельзя захватывать нейтральный гекс у границы врага', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: AI }, { q: 6, r: 5, ownerId: P }, { q: 4, r: 5 }]);
    expect(validateCapture(s, P, 4, 5).ok).toBe(false);
    declareWar(s, P, AI);
    expect(validateCapture(s, P, 4, 5).ok).toBe(true);
  });
  it('окружение не захватывает владение без войны', () => {
    const s = makeState([{ q: 7, r: 6, ownerId: P }, { q: 8, r: 6, ownerId: P }]);
    s.players[0].capital = { q: 7, r: 6 };
    for (const [q, r] of [[6,6],[7,7],[7,5],[8,5],[6,7],[9,6],[8,7],[9,5]]) {
      s.hexes.find((h) => h.q === q && h.r === r)!.ownerId = AI;
    }
    applyEnclosure(s);
    expect(s.hexes.find((h) => h.q === 7 && h.r === 6)!.ownerId).toBe(P);
    declareWar(s, P, AI);
    applyEnclosure(s);
    expect(s.hexes.find((h) => h.q === 7 && h.r === 6)!.ownerId).toBe(AI);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run test/rules.test.ts -t "дипломатия"`
Expected: FAIL — `relation is not defined`.

- [ ] **Step 3: Реализовать**

В `server/src/rules.ts`:

1. В `GameState` (после `winnerId`) добавить:

```ts
  diplomacy?: DiplomacyMap;
```

2. Добавить (после `computeWinner`):

```ts
export type DiplomacyRelation = 'peace' | 'war' | 'alliance';
export type DiplomacyMap = Map<string, DiplomacyRelation>;

function diplomacyKey(a: number, b: number): string {
  return `${Math.min(a, b)}-${Math.max(a, b)}`;
}

export function relation(state: GameState, a: number, b: number): DiplomacyRelation {
  return state.diplomacy?.get(diplomacyKey(a, b)) ?? 'peace';
}

export function alliesOf(state: GameState, playerId: number): number[] {
  return state.players.filter((p) => p.id !== playerId && relation(state, playerId, p.id) === 'alliance').map((p) => p.id);
}

export function declareWar(state: GameState, a: number, b: number): void {
  const d = state.diplomacy ?? (state.diplomacy = new Map());
  d.set(diplomacyKey(a, b), 'war');
  for (const sa of alliesOf(state, a)) d.set(diplomacyKey(sa, b), 'war');
  for (const sb of alliesOf(state, b)) d.set(diplomacyKey(sb, a), 'war');
}

export function makePeace(state: GameState, a: number, b: number): void {
  const d = state.diplomacy ?? (state.diplomacy = new Map());
  d.set(diplomacyKey(a, b), 'peace');
}

export function makeAlliance(state: GameState, a: number, b: number): void {
  const d = state.diplomacy ?? (state.diplomacy = new Map());
  d.set(diplomacyKey(a, b), 'alliance');
}

export function hasPeacefulNeighbor(state: GameState, q: number, r: number, playerId: number): boolean {
  return NEIGHBOR_OFFSETS.some(([dq, dr]) => {
    const nq = q + dq;
    const nr = r + dr;
    if (!isInBounds(state, nq, nr)) return false;
    const hex = findHex(state, nq, nr);
    return hex !== undefined && hex.ownerId !== null && hex.ownerId !== playerId && relation(state, playerId, hex.ownerId) !== 'war';
  });
}
```

3. В `validateAttack` — после проверки «Нельзя атаковать свой гекс» (строка с `hex.ownerId === playerId`) добавить:

```ts
  if (hex.ownerId !== null && hex.ownerId !== playerId && relation(state, playerId, hex.ownerId) !== 'war') {
    return { ok: false, error: 'Нужно объявить войну' };
  }
```

4. В `validateCapture` — в обеих ветках (первый гекс и обычный), после проверок бюджета, перед `return { ok: true }` добавить:

```ts
  if (hasPeacefulNeighbor(state, q, r, playerId)) {
    return { ok: false, error: 'Нужно объявить войну соседнему игроку' };
  }
```

5. В `applyEnclosure` — перед `claims.push(...)` добавить проверку отношений:

```ts
    if (owner !== null && owner !== regionOwnerId) {
      if (regionOwnerId !== null && relation(state, owner, regionOwnerId) !== 'war') continue;
      for (const hex of region) hex.ownerId = owner;
      claims.push({ ownerId: owner, prevOwnerId: regionOwnerId, hexes: region });
    }
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run test/rules.test.ts -t "дипломатия"` → PASS. Затем `npx vitest run` — все зелёные.

- [ ] **Step 5: Коммит**

```bash
git add server/src/rules.ts server/test/rules.test.ts
git commit -m "feat: дипломатия — отношения, объявление войны с союзниками, блокировки"
```

---

### Task 2: Комната — война и предложения через handleAction

**Files:**
- Modify: `server/src/rooms.ts`, `server/src/ws.ts`
- Test: `server/test/rooms.test.ts`

**Interfaces:**
- Consumes: `rules.relation/declareWar/makePeace/makeAlliance` (Task 1).
- Produces: `Room.pendingProposals: PendingProposal[]`; handleAction cases `declare-war` / `propose` / `respond-proposal`; ИИ-ответы на предложения в `tick()`; `Room.aiAcceptsProposal(state, aiId, proposerId): boolean`; старт/рестарт сбрасывают `state.diplomacy` и `pendingProposals`.

- [ ] **Step 1: Написать падающие тесты**

В `server/test/rooms.test.ts` добавить:

```ts
describe('Room: дипломатия', () => {
  it('declare-war через handleAction + вступление союзников', () => {
    const room = new Room(1, 'Тест', 'normal', 6, true, 2, () => 0.5);
    room.addHuman('A', 1);
    room.start(1);
    const g = room.gameState!;
    // раздаём стартовые клетки: человек 1, ИИ 2, ИИ 3
    for (const [playerId, i] of [[1, 0], [2, 1], [3, 2]] as [number, number][]) {
      g.hexes[i].ownerId = playerId;
      g.players.find((p) => p.id === playerId)!.capital = { q: g.hexes[i].q, r: g.hexes[i].r };
    }
    // ИИ 2 и ИИ 3 в союзе, человек объявляет войну ИИ 2
    rules.makeAlliance(g, 2, 3);
    const hex = g.hexes.find((h) => h.ownerId === 2)!;
    const result = room.handleAction(1, 'declare-war', { q: hex.q, r: hex.r });
    expect(result.type).toBe('state');
    expect(rules.relation(g, 1, 2)).toBe('war');
    expect(rules.relation(g, 1, 3)).toBe('war');
    expect(room.view(1).log.some((l) => l.includes('объявил войну'))).toBe(true);
  });
  it('предложение мира: ИИ принимает при равенстве сил', () => {
    const room = new Room(1, 'Тест', 'normal', 6, true, 1, () => 0.5);
    room.addHuman('A', 1);
    room.start(1);
    const g = room.gameState!;
    const ai = g.players.find((p) => p.isAi)!;
    // по одной клетке у каждого -> равенство
    g.hexes[0].ownerId = 1;
    g.players[0].capital = { q: g.hexes[0].q, r: g.hexes[0].r };
    g.hexes[1].ownerId = ai.id;
    g.players[1].capital = { q: g.hexes[1].q, r: g.hexes[1].r };
    const hex = g.hexes.find((h) => h.ownerId === 1)!;
    rules.declareWar(g, 1, ai.id);
    const result = room.handleAction(1, 'propose', { q: hex.q, r: hex.r, kind: 'peace' });
    expect(result.type).toBe('state');
    room.tick();
    expect(rules.relation(g, 1, ai.id)).toBe('peace');
  });
  it('предложение союза: ИИ отклоняет при слабом игроке', () => {
    const room = new Room(1, 'Тест', 'normal', 6, true, 1, () => 0.5);
    room.addHuman('A', 1);
    room.start(1);
    const g = room.gameState!;
    const ai = g.players.find((p) => p.isAi)!;
    g.hexes[0].ownerId = 1;
    g.players[0].capital = { q: g.hexes[0].q, r: g.hexes[0].r };
    for (let i = 1; i <= 10; i++) g.hexes[i].ownerId = ai.id;
    g.players[1].capital = { q: g.hexes[1].q, r: g.hexes[1].r };
    const hex = g.hexes.find((h) => h.ownerId === 1)!;
    const result = room.handleAction(1, 'propose', { q: hex.q, r: hex.r, kind: 'alliance' });
    expect(result.type).toBe('state');
    room.tick();
    expect(rules.relation(g, 1, ai.id)).not.toBe('alliance');
  });
  it('respond-proposal: человек принимает предложение', () => {
    const room = new Room(1, 'Тест', 'normal', 6, true, 1, () => 0.5);
    room.addHuman('A', 1);
    room.start(1);
    const g = room.gameState!;
    const ai = g.players.find((p) => p.isAi)!;
    g.hexes[0].ownerId = 1;
    g.players[0].capital = { q: g.hexes[0].q, r: g.hexes[0].r };
    g.hexes[1].ownerId = ai.id;
    g.players[1].capital = { q: g.hexes[1].q, r: g.hexes[1].r };
    const aiHex = g.hexes.find((h) => h.ownerId === ai.id)!;
    // ИИ предлагает союз человеку (через handleAction от имени ИИ нельзя — создаём напрямую)
    room['pendingProposals'] = [{ from: ai.id, to: 1, kind: 'alliance' }];
    const result = room.handleAction(1, 'respond-proposal', { q: aiHex.q, r: aiHex.r, accept: true });
    expect(result.type).toBe('state');
    expect(rules.relation(g, 1, ai.id)).toBe('alliance');
  });
});
```

В начало файла добавить импорт `rules` (если ещё нет): `import * as rules from '../src/rules.js';`

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run test/rooms.test.ts -t "дипломатия"`
Expected: FAIL — `room.handleAction(1, 'declare-war', ...)` возвращает «Неизвестный тип сообщения».

- [ ] **Step 3: Реализовать**

В `server/src/rooms.ts`:

1. Тип и поле (рядом с `lastCapturerId`):

```ts
  private pendingProposals: { from: number; to: number; kind: 'peace' | 'alliance' }[] = [];
```

2. В `start()` — после создания state добавить:

```ts
    this.state.diplomacy = new Map();
    this.pendingProposals = [];
```

3. В `restart()` — аналогично (после создания state).

4. Хелпер (рядом с `playerName`):

```ts
  private targetPlayerId(playerId: number, msg: { q?: number; r?: number }): number | null {
    const hex = rules.findHex(this.state!, msg.q ?? 0, msg.r ?? 0);
    if (!hex || hex.ownerId === null || hex.ownerId === playerId) return null;
    return hex.ownerId;
  }
```

5. В `handleAction` — новые case (после `defend`):

```ts
      case 'declare-war': {
        const target = this.targetPlayerId(playerId, msg);
        if (target === null) return { type: 'error', message: 'Владелец гекса не найден' };
        rules.declareWar(this.state, playerId, target);
        this.addLog(`${this.playerName(playerId)} объявил войну ${this.playerName(target)}`);
        return { type: 'state' };
      }
      case 'propose': {
        const target = this.targetPlayerId(playerId, msg);
        if (target === null) return { type: 'error', message: 'Владелец гекса не найден' };
        const kind = msg.kind;
        if (kind !== 'peace' && kind !== 'alliance') return { type: 'error', message: 'Неизвестный тип предложения' };
        const rel = rules.relation(this.state!, playerId, target);
        if (kind === 'peace' && rel === 'peace') return { type: 'error', message: 'Уже в мире' };
        if (kind === 'alliance' && (rel === 'alliance' || rel === 'war')) {
          return { type: 'error', message: 'Союз невозможен при текущих отношениях' };
        }
        if (this.pendingProposals.some((p) => p.from === playerId && p.to === target && p.kind === kind)) {
          return { type: 'error', message: 'Предложение уже отправлено' };
        }
        this.pendingProposals.push({ from: playerId, to: target, kind });
        this.addLog(`${this.playerName(playerId)} предлагает ${kind === 'peace' ? 'мир' : 'союз'} ${this.playerName(target)}`);
        return { type: 'state' };
      }
      case 'respond-proposal': {
        const proposer = this.targetPlayerId(playerId, msg);
        if (proposer === null) return { type: 'error', message: 'Владелец гекса не найден' };
        const idx = this.pendingProposals.findIndex((p) => p.from === proposer && p.to === playerId);
        if (idx === -1) return { type: 'error', message: 'Нет предложения от этого игрока' };
        const [proposal] = this.pendingProposals.splice(idx, 1);
        if (msg.accept) {
          if (proposal.kind === 'peace') rules.makePeace(this.state!, playerId, proposer);
          else rules.makeAlliance(this.state!, playerId, proposer);
          this.addLog(`${this.playerName(playerId)} и ${this.playerName(proposer)} заключили ${proposal.kind === 'peace' ? 'мир' : 'союз'}`);
        } else {
          this.addLog(`${this.playerName(playerId)} отклонил предложение ${this.playerName(proposer)}`);
        }
        return { type: 'state' };
      }
```

6. В `tick()` — ИИ-ответы на предложения (перед циклом выбора действий ИИ, после обработки выбытий):

```ts
    for (const aiPlayer of state.players) {
      if (!aiPlayer.isAi || aiPlayer.eliminated) continue;
      const incoming = this.pendingProposals.filter((p) => p.to === aiPlayer.id);
      for (const proposal of incoming) {
        this.pendingProposals.splice(this.pendingProposals.indexOf(proposal), 1);
        const proposer = state.players.find((p) => p.id === proposal.from);
        if (!proposer || proposer.eliminated) continue;
        if (this.aiAcceptsProposal(state, aiPlayer.id, proposal.from)) {
          if (proposal.kind === 'peace') rules.makePeace(state, aiPlayer.id, proposal.from);
          else rules.makeAlliance(state, aiPlayer.id, proposal.from);
          this.addLog(`${this.playerName(aiPlayer.id)} и ${this.playerName(proposal.from)} заключили ${proposal.kind === 'peace' ? 'мир' : 'союз'}`);
        } else {
          this.addLog(`${this.playerName(aiPlayer.id)} отклонил предложение ${this.playerName(proposal.from)}`);
        }
      }
    }
```

7. Метод (рядом с `handlePlayerLoss`):

```ts
  private aiAcceptsProposal(state: GameState, aiId: number, proposerId: number): boolean {
    const proposer = state.players.find((p) => p.id === proposerId);
    if (!proposer || proposer.eliminated) return false;
    const proposerHexes = rules.hexCount(state, proposerId);
    const aiHexes = rules.hexCount(state, aiId);
    const atWar = state.players.some((p) => p.id !== aiId && rules.relation(state, aiId, p.id) === 'war');
    return proposerHexes >= aiHexes * 0.8 || atWar;
  }
```

В `server/src/ws.ts`:

1. В `WsMessage` добавить `kind?: string; accept?: boolean;`
2. Новые case (после `'restart'`):

```ts
          case 'declare-war':
          case 'propose':
          case 'respond-proposal': {
            const result = manager.handleAction(connId, message as { type: string; q?: number; r?: number; kind?: string; accept?: boolean });
            if (result.type === 'state') broadcast();
            else ws.send(JSON.stringify(result));
            return;
          }
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run test/rooms.test.ts -t "дипломатия"` → PASS. Затем `npx vitest run` — все зелёные.

- [ ] **Step 5: Коммит**

```bash
git add server/src/rooms.ts server/src/ws.ts server/test/rooms.test.ts
git commit -m "feat: объявление войны и предложения мира/союза, ответы ИИ"
```

---

### Task 3: Агрессия ИИ и разведка

**Files:**
- Modify: `server/src/rooms.ts`, `server/src/ai.ts`
- Test: `server/test/rooms.test.ts`

**Interfaces:**
- Consumes: `rules.alliesOf`, `rules.relation`, `rules.declareWar`, `rules.hasPeacefulNeighbor` (Task 1).
- Produces: `Room.scoutCache` (кэш показателей человека, обновление раз в 30 с); `Room.maybeDeclareWar(state, aiId)` (объявляет войну соседней цели при силовом перевесе); `chooseAiAction` не захватывает гексы у мирных границ.

- [ ] **Step 1: Написать падающие тесты**

В `server/test/rooms.test.ts` добавить (в блок «Room: дипломатия»):

```ts
  it('агрессия ИИ: объявляет войну при перевесе сил', () => {
    const room = new Room(1, 'Тест', 'normal', 6, true, 1, () => 0.5);
    room.addHuman('A', 1);
    room.start(1);
    const g = room.gameState!;
    const ai = g.players.find((p) => p.isAi)!;
    // человек 1 клетка, ИИ 10
    g.hexes[0].ownerId = 1;
    g.players[0].capital = { q: g.hexes[0].q, r: g.hexes[0].r };
    for (let i = 1; i <= 10; i++) g.hexes[i].ownerId = ai.id;
    g.players[1].capital = { q: g.hexes[1].q, r: g.hexes[1].r };
    room.tick();
    expect(rules.relation(g, 1, ai.id)).toBe('war');
  });
  it('агрессия ИИ: не объявляет войну, если цель сильнее', () => {
    const room = new Room(1, 'Тест', 'normal', 6, true, 1, () => 0.5);
    room.addHuman('A', 1);
    room.start(1);
    const g = room.gameState!;
    const ai = g.players.find((p) => p.isAi)!;
    for (let i = 0; i < 10; i++) g.hexes[i].ownerId = 1;
    g.players[0].capital = { q: g.hexes[0].q, r: g.hexes[0].r };
    g.hexes[10].ownerId = ai.id;
    g.players[1].capital = { q: g.hexes[10].q, r: g.hexes[10].r };
    room.tick();
    expect(rules.relation(g, 1, ai.id)).toBe('peace');
  });
  it('разведка: кэш обновляется не чаще 30 секунд', () => {
    const room = new Room(1, 'Тест', 'normal', 6, true, 1, () => 0.5);
    room.addHuman('A', 1);
    room.start(1);
    const g = room.gameState!;
    const ai = g.players.find((p) => p.isAi)!;
    for (let i = 0; i < 10; i++) g.hexes[i].ownerId = 1;
    g.players[0].capital = { q: g.hexes[0].q, r: g.hexes[0].r };
    g.hexes[10].ownerId = ai.id;
    g.players[1].capital = { q: g.hexes[10].q, r: g.hexes[10].r };
    room.tick(); // первый тик — кэш создан
    const before = room['scoutCache'];
    expect(before).not.toBeNull();
    // у человека резко выросла территория, но кэш не обновился
    for (let i = 11; i < 40; i++) g.hexes[i].ownerId = 1;
    room.tick();
    expect(room['scoutCache']!.hexCount).toBe(before!.hexCount);
    // принудительно состарим кэш
    room['scoutCache']!.updatedAt = Date.now() - 31000;
    room.tick();
    expect(room['scoutCache']!.hexCount).toBeGreaterThan(before!.hexCount);
  });
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run test/rooms.test.ts -t "агрессия ИИ"` и `-t "разведка"`
Expected: FAIL — отношения остаются `peace`.

- [ ] **Step 3: Реализовать**

В `server/src/rooms.ts`:

1. Поле (рядом с `pendingProposals`):

```ts
  private scoutCache: { hexCount: number; points: number; updatedAt: number } | null = null;
```

2. В `tick()` — перед циклом ИИ-ответов на предложения добавить вызов обновления кэша и цикл агрессии (внутри цикла обработки каждого ИИ, перед `chooseAiAction`):

```ts
    this.updateScoutCache(state);
    ...
    for (const player of state.players) {
      if (!player.isAi || player.eliminated) continue;
      this.maybeDeclareWar(state, player.id);
      const last = this.aiLastActionAt.get(player.id) ?? 0;
      ...
```

3. Методы (рядом с `aiAcceptsProposal`):

```ts
  private updateScoutCache(state: GameState): void {
    const now = Date.now();
    if (this.scoutCache !== null && now - this.scoutCache.updatedAt < 30000) return;
    const human = state.players.find((p) => !p.isAi && !p.eliminated);
    if (!human) {
      this.scoutCache = null;
      return;
    }
    this.scoutCache = { hexCount: rules.hexCount(state, human.id), points: human.points, updatedAt: now };
  }

  private hasBorderWith(state: GameState, a: number, b: number): boolean {
    const offsets: [number, number][] = [
      [1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1],
    ];
    return state.hexes.some((hex) => {
      if (hex.ownerId !== a) return false;
      return offsets.some(([dq, dr]) => {
        const n = rules.findHex(state, hex.q + dq, hex.r + dr);
        return n !== undefined && n.ownerId === b;
      });
    });
  }

  private maybeDeclareWar(state: GameState, aiId: number): void {
    const sideStrength = (id: number) => {
      const side = [id, ...rules.alliesOf(state, id)];
      return {
        hexes: side.reduce((sum, pid) => sum + rules.hexCount(state, pid), 0),
        points: side.reduce((sum, pid) => sum + (state.players.find((p) => p.id === pid)?.points ?? 0), 0),
      };
    };
    const aiSide = sideStrength(aiId);
    for (const target of state.players) {
      if (target.id === aiId || target.eliminated) continue;
      const rel = rules.relation(state, aiId, target.id);
      if (rel === 'war' || rel === 'alliance') continue;
      if (!this.hasBorderWith(state, aiId, target.id)) continue;
      const targetSide = target.isAi ? sideStrength(target.id) : { hexes: this.scoutCache?.hexCount ?? 0, points: this.scoutCache?.points ?? 0 };
      if (aiSide.hexes > targetSide.hexes || aiSide.points > targetSide.points) {
        rules.declareWar(state, aiId, target.id);
        this.addLog(`${this.playerName(aiId)} объявил войну ${this.playerName(target.id)}`);
      }
    }
  }
```

4. В `restart()` — сброс кэша: `this.scoutCache = null;`

В `server/src/ai.ts`:

1. Импорт: добавить `hasPeacefulNeighbor` в импорт из `./rules.js`.

2. В фильтре `affordableNeutral` (строка с `.filter((hex) => hex.ownerId === null && ...`) добавить условие:

```ts
    .filter((hex) => !hasPeacefulNeighbor(state, hex.q, hex.r, aiId))
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run test/rooms.test.ts -t "агрессия ИИ"` → PASS; `-t "разведка"` → PASS. Затем `npx vitest run` — все зелёные.

- [ ] **Step 5: Коммит**

```bash
git add server/src/rooms.ts server/src/ai.ts server/test/rooms.test.ts
git commit -m "feat: агрессия ИИ по силе сторон и разведка раз в 30 секунд"
```

---

### Task 4: view() — фильтрация ресурсов по отношениям

**Files:**
- Modify: `server/src/rooms.ts`, `server/src/ws.ts`
- Test: `server/test/rooms.test.ts`

**Interfaces:**
- Consumes: `rules.relation` (Task 1).
- Produces: `Room.view(playerId: number | null = null)` — у врагов `points/limit/income: null`; у всех `relation: 'self' | 'ally' | 'enemy'`; `ViewGame.pendingProposals: { from: number; kind: 'peace' | 'alliance' }[]` (входящие для зрителя). `ws.ts` передаёт `viewerPlayerId(connId)`.

- [ ] **Step 1: Написать падающий тест**

В `server/test/rooms.test.ts` добавить:

```ts
  it('view: враг не видит очки/доход, союзник видит', () => {
    const room = new Room(1, 'Тест', 'normal', 6, true, 1, () => 0.5);
    room.addHuman('A', 1);
    room.start(1);
    const g = room.gameState!;
    const ai = g.players.find((p) => p.isAi)!;
    const enemy = room.view(1).game!.players.find((p) => p.id === ai.id)!;
    expect(enemy.points).toBeNull();
    expect(enemy.relation).toBe('enemy');
    const self = room.view(1).game!.players.find((p) => p.id === 1)!;
    expect(self.points).not.toBeNull();
    expect(self.relation).toBe('self');
    rules.makeAlliance(g, 1, ai.id);
    const ally = room.view(1).game!.players.find((p) => p.id === ai.id)!;
    expect(ally.points).not.toBeNull();
    expect(ally.relation).toBe('ally');
  });
  it('view: входящие предложения видны адресату', () => {
    const room = new Room(1, 'Тест', 'normal', 6, true, 1, () => 0.5);
    room.addHuman('A', 1);
    room.start(1);
    const ai = room.gameState!.players.find((p) => p.isAi)!;
    room['pendingProposals'] = [{ from: ai.id, to: 1, kind: 'alliance' }];
    const proposals = room.view(1).game!.pendingProposals;
    expect(proposals).toEqual([{ from: ai.id, kind: 'alliance' }]);
  });
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run test/rooms.test.ts -t "view: враг"` и `-t "view: входящие"`
Expected: FAIL — `ViewPlayer.points` число, нет `relation`.

- [ ] **Step 3: Реализовать**

В `server/src/rooms.ts`:

1. Интерфейс `ViewPlayer` заменить на:

```ts
export interface ViewPlayer {
  id: number;
  name: string;
  points: number | null;
  hexCount: number;
  income: number | null;
  limit: number | null;
  isAi: boolean;
  capital: { q: number; r: number } | null;
  eliminated: boolean;
  relation: 'self' | 'ally' | 'enemy';
}
```

2. `ViewGame` — добавить:

```ts
  pendingProposals: { from: number; kind: 'peace' | 'alliance' }[];
```

3. `view()` — новая сигнатура и фильтрация:

```ts
  view(playerId: number | null = null): RoomView {
    const state = this.state;
    return {
      ...
      game: state
        ? {
            players: state.players.map((p) => {
              const rel = p.id === playerId ? 'self' : playerId !== null && rules.relation(state, playerId, p.id) === 'alliance' ? 'ally' : 'enemy';
              const hidden = rel === 'enemy';
              return {
                id: p.id,
                name: p.name ?? `Игрок ${p.id}`,
                points: hidden ? null : p.points,
                hexCount: rules.hexCount(state, p.id),
                income: hidden ? null : rules.playerIncome(state, p.id),
                limit: hidden ? null : rules.pointLimit(rules.hexCount(state, p.id)),
                isAi: p.isAi ?? false,
                capital: p.capital ?? null,
                eliminated: p.eliminated ?? false,
                relation: rel,
              };
            }),
            hexes: state.hexes,
            winnerId: state.winnerId,
            captureTicks: rules.CAPTURE_TICKS,
            pendingProposals: playerId !== null ? this.pendingProposals.filter((p) => p.to === playerId).map((p) => ({ from: p.from, kind: p.kind })) : [],
          }
        : null,
      ...
    };
  }
```

В `server/src/ws.ts` — `statePayload`:

```ts
      room: manager.roomForConn(connId)?.view(manager.viewerPlayerId(connId)) ?? null,
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run test/rooms.test.ts -t "view:"` → PASS. Затем `npx vitest run` — все зелёные (в т.ч. старый тест `room.view()` без аргумента).

- [ ] **Step 5: Коммит**

```bash
git add server/src/rooms.ts server/src/ws.ts server/test/rooms.test.ts
git commit -m "feat: view по зрителю — враги не видят очки/доход, предложения адресату"
```

---

### Task 5: Web — типы, API, меню дипломатии, HUD

**Files:**
- Modify: `web/src/types.ts`, `web/src/api.ts`, `web/src/components/ContextMenu.vue`, `web/src/components/Hud.vue`, `web/src/App.vue`

**Interfaces:**
- Consumes: серверные `ViewPlayer.relation`, `ViewGame.pendingProposals` (Task 4).
- Produces: сообщения `declare-war`/`propose`/`respond-proposal`; активные пункты меню; HUD-фильтрация и подсветка союзников.

- [ ] **Step 1: Типы и API**

В `web/src/types.ts`:

1. `Player`:

```ts
export interface Player {
  id: number;
  name: string;
  points: number | null;
  hexCount: number;
  income: number | null;
  limit: number | null;
  isAi: boolean;
  capital: { q: number; r: number } | null;
  eliminated: boolean;
  relation: 'self' | 'ally' | 'enemy';
}
```

2. `GameState` — добавить:

```ts
  pendingProposals: { from: number; kind: 'peace' | 'alliance' }[];
```

3. `ClientMessage` — добавить:

```ts
  | { type: 'declare-war'; q: number; r: number }
  | { type: 'propose'; q: number; r: number; kind: 'peace' | 'alliance' }
  | { type: 'respond-proposal'; q: number; r: number; accept: boolean }
```

В `web/src/api.ts`:

```ts
  sendDeclareWar(q: number, r: number): void {
    this.send({ type: 'declare-war', q, r });
  }

  sendPropose(q: number, r: number, kind: 'peace' | 'alliance'): void {
    this.send({ type: 'propose', q, r, kind });
  }

  sendRespondProposal(q: number, r: number, accept: boolean): void {
    this.send({ type: 'respond-proposal', q, r, accept });
  }
```

- [ ] **Step 2: ContextMenu — активные пункты дипломатии**

В `web/src/components/ContextMenu.vue`:

1. Props и emits:

```ts
const props = defineProps<{
  hex: Hex;
  x: number;
  y: number;
  players: Player[];
  humanId: number | null;
  relation: 'peace' | 'war' | 'alliance';
  pendingFromOwner: { kind: 'peace' | 'alliance' } | null;
}>();

const emit = defineEmits<{
  close: [];
  declareWar: [];
  propose: [kind: 'peace' | 'alliance'];
  respond: [accept: boolean];
}>();
```

2. Пункты:

```ts
const isMine = computed(() => props.hex.ownerId !== null && props.hex.ownerId === props.humanId);
const isEnemy = computed(() => props.hex.ownerId !== null && props.hex.ownerId !== props.humanId);

const items = computed(() => {
  if (isMine.value) {
    return [{ label: 'Построить крепость', disabled: true, hint: 'будет доступно позже' }];
  }
  if (isEnemy.value) {
    if (props.pendingFromOwner) {
      return [
        { label: `Принять ${props.pendingFromOwner.kind === 'peace' ? 'мир' : 'союз'}`, disabled: false, hint: '', action: 'respond-true' },
        { label: 'Отклонить', disabled: false, hint: '', action: 'respond-false' },
      ];
    }
    if (props.relation === 'peace') {
      return [
        { label: 'Война', disabled: false, hint: '', action: 'war' },
        { label: 'Мир', disabled: true, hint: 'уже мир' },
        { label: 'Союз', disabled: false, hint: '', action: 'alliance' },
      ];
    }
    if (props.relation === 'war') {
      return [
        { label: 'Война', disabled: true, hint: 'уже война' },
        { label: 'Мир', disabled: false, hint: '', action: 'peace' },
        { label: 'Союз', disabled: true, hint: 'во время войны нельзя' },
      ];
    }
    return [
      { label: 'Война', disabled: false, hint: '', action: 'war' },
      { label: 'Мир', disabled: true, hint: 'вы союзники' },
      { label: 'Союз', disabled: true, hint: 'уже союз' },
    ];
  }
  return [];
});
```

3. Клик:

```ts
function pick(action: string): void {
  if (action === 'war') emit('declareWar');
  else if (action === 'peace' || action === 'alliance') emit('propose', action);
  else if (action === 'respond-true') emit('respond', true);
  else if (action === 'respond-false') emit('respond', false);
  emit('close');
}
```

Шаблон кнопок: `:disabled="item.disabled" @click="pick(item.action)"`, hint показывать только при `disabled`.

- [ ] **Step 3: App.vue — вычисление отношения и обработчики**

В `web/src/App.vue`:

1. В `onContextMenu` — вычислить отношение и входящее предложение и сохранить вместе:

```ts
const contextMenu = ref<{
  hex: Hex;
  x: number;
  y: number;
  relation: 'peace' | 'war' | 'alliance';
  pendingFromOwner: { kind: 'peace' | 'alliance' } | null;
} | null>(null);

function onContextMenu(payload: { hex: Hex; x: number; y: number }): void {
  if (payload.hex.ownerId === null) {
    closeContextMenu();
    return;
  }
  const g = game.value;
  if (!g) return;
  const owner = g.players.find((p) => p.id === payload.hex.ownerId);
  if (!owner) return;
  const relation = owner.id === playerId.value ? 'self' : owner.relation === 'ally' ? 'alliance' : 'war';
  const pendingFromOwner = g.pendingProposals.find((p) => p.from === owner.id) ?? null;
  contextMenu.value = { ...payload, relation, pendingFromOwner };
}
```

2. Обработчики:

```ts
function onMenuDeclareWar(): void {
  if (!contextMenu.value) return;
  client.sendDeclareWar(contextMenu.value.hex.q, contextMenu.value.hex.r);
  closeContextMenu();
}

function onMenuPropose(kind: 'peace' | 'alliance'): void {
  if (!contextMenu.value) return;
  client.sendPropose(contextMenu.value.hex.q, contextMenu.value.hex.r, kind);
  closeContextMenu();
}

function onMenuRespond(accept: boolean): void {
  if (!contextMenu.value) return;
  client.sendRespondProposal(contextMenu.value.hex.q, contextMenu.value.hex.r, accept);
  closeContextMenu();
}
```

3. Шаблон:

```html
        <ContextMenu
          v-if="contextMenu"
          :hex="contextMenu.hex"
          :x="contextMenu.x"
          :y="contextMenu.y"
          :players="game.players"
          :human-id="playerId"
          :relation="contextMenu.relation"
          :pending-from-owner="contextMenu.pendingFromOwner"
          @close="closeContextMenu"
          @declare-war="onMenuDeclareWar"
          @propose="onMenuPropose"
          @respond="onMenuRespond"
        />
```

- [ ] **Step 4: HUD — «?» у врагов, подсветка союзников**

В `web/src/components/Hud.vue`:

1. `pointsText`:

```ts
function pointsText(p: Player): string {
  if (p.points === null) return '?';
  if (p.id === props.humanId) {
    const reserve = Math.floor((p.points * props.army) / 100);
    return `${Math.max(0, p.points - reserve)}/${p.limit}`;
  }
  return `${p.points}/${p.limit}`;
}
```

2. `income` — у врагов не показывать:

```html
      <span v-if="p.income !== null" class="player-list__income">+{{ p.income }}/сек</span>
```

3. Подсветка союзника (в класс строки):

```html
      :class="{
        'player-list__row--me': p.id === humanId,
        'player-list__row--dead': p.eliminated,
        'player-list__row--ally': p.relation === 'ally',
      }"
```

CSS:

```css
.player-list__row--ally {
  border-color: #7cb342;
}
```

- [ ] **Step 5: Проверка сборки**

Run: `npm run build` (в `web/`)
Expected: сборка проходит.

- [ ] **Step 6: Коммит**

```bash
git add web/src/types.ts web/src/api.ts web/src/components/ContextMenu.vue web/src/components/Hud.vue web/src/App.vue
git commit -m "feat: web — дипломатия в меню и HUD"
```

---

### Task 6: Финальная проверка

**Files:**
- нет изменений

- [ ] **Step 1: Все тесты сервера**

Run: `npx vitest run` (в `server/`)
Expected: все зелёные (161 + новые ≈ 176).

- [ ] **Step 2: Сборка web**

Run: `npm run build` (в `web/`)
Expected: сборка проходит.

- [ ] **Step 3: Ручная проверка**

Run: dev-серверы, затем:
1. Старт соло — все в мире: ИИ не атакует, пока не сильнее.
2. ПКМ по своему гексу — «Построить крепость» (заглушка).
3. ПКМ по чужому гексу в мире — «Война» и «Союз» активны; война объявляется, союзники вступают.
4. ПКМ по врагу в войне — «Мир» активен; ИИ принимает/отклоняет по силе; у человека — «Принять/Отклонить».
5. HUD: у врагов «?» вместо очков, у союзников — полные данные и подсветка.
6. Игровой лог: события дипломатии, без захватов.

- [ ] **Step 4: Коммит (если были правки)**

```bash
git add -A
git commit -m "fix: правки по итогам ручной проверки"
```
