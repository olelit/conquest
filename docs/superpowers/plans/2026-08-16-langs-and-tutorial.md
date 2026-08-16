# Языки EN/RU и режим обучения — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить переключатель языка EN/RU (клиент, по умолчанию EN) и режим «Обучение» (соло против лёгкого ИИ с машиной этапов на клиенте).

**Architecture:** Сервер минимально помечает учебную комнату (`Room.training`, передаётся в `view()`, принудительно легкий ИИ) и расширяет `pendingProposals` исходящими предложениями игрока. Клиент: свой i18n-модуль (`i18n.ts`), полный перевод UI, переключатель в главном меню; машина этапов (`training.ts`) на клиенте использует существующий серверный тоггл паузы (действия игрока работают на паузе — `handleAction` не блокируется). Серверные строки (лог, ошибки, имена стран) переводятся на английский навсегда.

**Tech Stack:** Vue 3 (`<script setup>`), TS, Vite (`vue-tsc -b && vite build`), Node+ws, vitest.

## Global Constraints

- Клиент по умолчанию — английский; переключатель EN/RU в главном меню.
- Сервер — ТОЛЬКО английский (лог, ошибки, имена стран, «Player N»); клиентских юнит-тестов нет.
- Ноль новых зависимостей (и клиент, и сервер).
- Имена тестов (`it('по-русски', ...)`) и кодовые комментарии НЕ переводить; только пользовательские строки и литералы, которые сравниваются в тестах.
- Проверка сервера: `cd server && npm test` (все PASS). Проверка веба: `cd web && npm run build` (чисто, vue-tsc не ругается).
- Сборка каждого задания должна быть зелёной: после каждого задания запускать свой чек.
- Пауза в обучении — существующий серверный тоггл: атом клиента `{ type: 'pause' }`. Игрок может действовать на паузе; ИИ стоит.

---
### Task 1: Сервер — флаг «обучение» и исходящие предложения

**Files:**
- Modify: `server/src/rooms.ts` (RoomView, ViewGame, Room-конструктор, view(), createSolo)
- Modify: `server/src/ws.ts` (WsMessage + case 'start-solo')
- Test: `server/test/rooms.test.ts`

**Interfaces:**
- Consumes: существующие `Room` конструктор и `createSolo`, `websocket case 'start-solo'`.
- Produces:
  - `Room` конструктор: `(id, name, mapType, maxPlayers, aiMode, aiCount, rng, difficulty, loadTest, training = false)` — `training` readonly public.
  - `createSolo(connId, mapType, aiCount, difficulty = 'medium', training = false)` — при `training` сложность принудительно `'easy'`.
  - `RoomView.training: boolean`; `ViewGame.pendingProposals: { from; to; kind }[]` (включает и исходящие предложения зрителя).
  - ws: `start-solo` принимает опциональный `training?: boolean`.

- [ ] **Step 1: Написать падающие тесты**

Добавить в конец `server/test/rooms.test.ts`:

```ts
describe('Room: обучение', () => {
  it('createSolo(training): лёгкий ИИ и флаг training в view', () => {
    const m = new RoomManager();
    const res = m.createSolo(1, 'normal', 1, 'hard', true);
    expect(res.ok).toBe(true);
    const room = m.roomForConn(1)!;
    expect(room.difficulty).toBe('easy');
    expect(room.view().training).toBe(true);
  });
  it('createSolo без training: сложность сохраняется', () => {
    const m = new RoomManager();
    expect(m.createSolo(1, 'normal', 1, 'hard').ok).toBe(true);
    expect(m.roomForConn(1)!.difficulty).toBe('hard');
    expect(m.roomForConn(1)!.view().training).toBe(false);
  });
  it('view().game.pendingProposals: включает исходящие предложения игрока', () => {
    const room = new Room(1, 'Тест', 'normal', 6, true, 1, () => 0.5);
    room.addHuman('A', 1);
    room.start(1);
    const g = room.gameState!;
    const ai = g.players.find((p) => p.isAi)!;
    g.hexes[0].ownerId = 1;
    g.players[0].capital = { q: g.hexes[0].q, r: g.hexes[0].r };
    g.hexes[1].ownerId = ai.id;
    g.players[1].capital = { q: g.hexes[1].q, r: g.hexes[1].r };
    const hex = g.hexes.find((h) => h.ownerId === ai.id)!;
    rules.declareWar(g, 1, ai.id);
    room.handleAction(1, 'propose', { q: hex.q, r: hex.r, kind: 'peace' });
    const proposal = room.view(1).game!.pendingProposals.find((p) => p.from === 1);
    expect(proposal).toBeDefined();
    expect(proposal!.to).toBe(ai.id);
  });
});
```

- [ ] **Step 2: Запустить тесты — убедиться, что падают**

Run: `cd server && npm test`
Expected: падания по `createSolo(1, 'normal', 1, 'hard', true)` (лишний аргумент TS) и `view().training` (нет такого поля). `proposal!.to` — поле `to` ещё не в типе.

- [ ] **Step 3: Реализовать**

`server/src/rooms.ts`:

1. В `interface RoomView` после `loadTest: boolean;` добавить строку:
```ts
  training: boolean;
```

2. В `interface ViewGame` заменить тип `pendingProposals`:
```ts
  pendingProposals: { from: number; to: number; kind: 'peace' | 'alliance' }[];
```

3. В конструктор `Room` добавить поле после `readonly loadTest = false,`:
```ts
    readonly training = false,
```

4. В `view()` после `loadTest: this.loadTest,` добавить:
```ts
      training: this.training,
```

5. В `view()` заменить строку с `pendingProposals`:
```ts
            pendingProposals: playerId !== null ? this.pendingProposals.filter((p) => p.to === playerId || p.from === playerId).map((p) => ({ from: p.from, to: p.to, kind: p.kind })) : [],
```

6. В `createSolo` изменить сигнатуру и создание комнаты:
```ts
  createSolo(connId: number, mapType: MapType, aiCount: number, difficulty: Difficulty = 'medium', training = false): { ok: true } | { ok: false; error: string } {
```
и строку создания комнаты:
```ts
    const room = new Room(this.nextRoomId++, randomCountryName(), mapType, preset.maxPlayers, true, aiCount, undefined, training ? 'easy' : difficulty, false, training);
```

`server/src/ws.ts`:

7. В `interface WsMessage` добавить поле:
```ts
  training?: boolean;
```

8. В `case 'start-solo':` передать флаг:
```ts
          case 'start-solo': {
            const result = manager.createSolo(connId, String(message.mapType ?? '') as MapType, Number(message.aiCount), (message.difficulty ?? 'medium') as Difficulty, Boolean(message.training));
```

- [ ] **Step 4: Запустить тесты — PASS**

Run: `cd server && npm test`
Expected: все PASS (включая 3 новых).

- [ ] **Step 5: Commit**

```bash
git add server/src/rooms.ts server/src/ws.ts server/test/rooms.test.ts
git commit -m "feat: сервер помечает учебную комнату (training, easy-ИИ) и отдаёт исходящие предложения"
```

---
### Task 2: Клиент — i18n-модуль, типы и api

**Files:**
- Create: `web/src/i18n.ts`
- Modify: `web/src/types.ts` (RoomView.training, GameState.pendingProposals → PendingProposal с `to`, ClientMessage training)
- Modify: `web/src/api.ts` (sendStartSolo)

**Interfaces:**
- Consumes: ничего нового.
- Produces:
  - `web/src/i18n.ts`: `t(key, vars?)`, `lang: Ref<'en'|'ru'>`, `setLang(lang)`, `useI18n()`.
  - `web/src/types.ts`: `RoomView.training: boolean`; `PendingProposal { from; to; kind }`; `GameState.pendingProposals: PendingProposal[]`; `ClientMessage['start-solo']` с опциональным `training`.
  - `web/src/api.ts`: `sendStartSolo(mapType, aiCount, difficulty, training = false)`.

- [ ] **Step 1: Создать «Создать тест» — для клиента нет юнит-тестов**

Клиентские проверки — только `npm run build`. На этом шаге создаём модуль.

Создать `web/src/i18n.ts` (полный файл):

```ts
import { ref, type Ref } from 'vue';

export type Lang = 'en' | 'ru';

const messages: Record<Lang, Record<string, string>> = {
  en: {
    'menu.subtitle': 'Choose a game mode',
    'menu.playVsAi': 'Play vs Computer',
    'menu.playVsHumans': 'Play vs Humans',
    'menu.loadTest': 'Load test',
    'menu.tutorial': 'Tutorial',
    'menu.loggedInAs': 'Signed in as {name}',
    'menu.aiSubtitle': 'Play vs Computer',
    'menu.aiCount': 'Computers:',
    'menu.difficulty': 'Difficulty:',
    'difficulty.easy': 'Easy',
    'difficulty.medium': 'Medium',
    'difficulty.hard': 'Hard',
    'menu.startGame': 'Start game',
    'menu.back': 'Menu',
    'menu.lobbySubtitle': 'Play vs humans — open rooms',
    'menu.noRooms': 'No open rooms',
    'menu.createRoom': 'Create room',
    'menu.create': 'Create',
    'menu.playersN': '{n} players',
    'menu.loadTestSubtitle': 'Load test — N players on the Round map',
    'menu.players': 'Players:',
    'menu.runTest': 'Run test',
    'menu.mapNPlayers': 'Map: {map} · {slots}/{max} players',
    'menu.host': 'host',
    'menu.freeSlots': 'Free slots: {n}',
    'menu.waitingHost': 'Waiting for the host to start…',
    'menu.leaveRoom': 'Leave room',
    'menu.resume': 'Resume',
    'menu.pause': 'Pause',
    'banner.paused': 'Paused',
    'banner.defeat': 'Defeat: {name}!',
    'banner.victory': 'Victory: {name}!',
    'banner.connecting': 'Connecting…',
    'hotkeys.hint': '1–9/0 — army · Tab — map · Space — pause',
    'burger.restart': 'Restart game',
    'burger.toMenu': 'Exit to menu',
    'confirm.restart': 'Restart the game?',
    'confirm.leave': 'Leave the room? The game will continue with the computer instead of you.',
    'map.normal': 'Normal',
    'map.normalDesc': 'rectangle 16×12',
    'map.long': 'Long',
    'map.longDesc': 'strip 24×9',
    'map.island': 'Island',
    'map.islandDesc': 'oval with water edges',
    'map.round': 'Round',
    'map.roundDesc': 'circle radius 9',
    'terrain.grass': 'Plain',
    'terrain.forest': 'Forest',
    'terrain.mountain': 'Mountains',
    'terrain.water': 'Water',
    'terrain.desert': 'Desert',
    'terrain.mine': 'Mine',
    'hex.owner': 'Owner: {name}',
    'hex.capital': ' ★ capital',
    'hex.fortress': 'Fortress',
    'hex.capture': 'Capture: {name}',
    'player.name': 'Player {id}',
    'army.label': 'Army',
    'army.hint': '% of points · available {available}/{limit}',
    'hud.eliminated': 'out',
    'fps.hideSummary': 'Hide summary',
    'fps.summary': 'Summary',
    'fps.avg': 'Average: {fps}',
    'fps.time': 'Time: {s} s',
    'cm.removeFortress': 'Remove fortress',
    'cm.buildFortress': 'Build fortress',
    'cm.fortressHint': 'Need 15+ hexes and limit headroom',
    'cm.acceptPeace': 'Accept peace',
    'cm.acceptAlliance': 'Accept alliance',
    'cm.decline': 'Decline',
    'cm.war': 'War',
    'cm.peace': 'Peace',
    'cm.alliance': 'Alliance',
    'cm.alreadyPeace': 'already peace',
    'cm.alreadyWar': 'already at war',
    'cm.notInWar': 'not possible during war',
    'cm.allies': 'you are allies',
    'cm.alreadyAlliance': 'already allied',
    'training.badge': 'Training',
    'training.stageN': 'Stage {n} of 6: {name}',
    'training.captureTitle': 'Capture',
    'training.attackTitle': 'Attack',
    'training.defendTitle': 'Defend',
    'training.fortressTitle': 'Fortress',
    'training.diplomacyTitle': 'Diplomacy',
    'training.doneTitle': 'Complete',
    'training.captureHint': 'Capture a neutral hex (click it)',
    'training.attackHint': 'Attack an enemy hex. If war is not declared: right-click an enemy hex → War, then attack',
    'training.defendHint': 'Defend the hex being attacked (click it)',
    'training.fortressHint': 'Build a fortress on one of your hexes (right-click → Build fortress)',
    'training.diplomacyHint': 'Right-click an enemy hex and propose peace or alliance, or declare war',
    'training.doneHint': 'Tutorial complete! The game continues.',
    'training.ok': 'OK',
  },
  ru: {
    'menu.subtitle': 'Выбери режим игры',
    'menu.playVsAi': 'Играть с компьютером',
    'menu.playVsHumans': 'Играть с людьми',
    'menu.loadTest': 'Нагрузочный тест',
    'menu.tutorial': 'Обучение',
    'menu.loggedInAs': 'Вы вошли как {name}',
    'menu.aiSubtitle': 'Игра с компьютером',
    'menu.aiCount': 'Компьютеров:',
    'menu.difficulty': 'Сложность:',
    'difficulty.easy': 'Лёгкая',
    'difficulty.medium': 'Средняя',
    'difficulty.hard': 'Сложная',
    'menu.startGame': 'Начать игру',
    'menu.back': 'В меню',
    'menu.lobbySubtitle': 'Игра с людьми — открытые комнаты',
    'menu.noRooms': 'Открытых комнат нет',
    'menu.createRoom': 'Создать комнату',
    'menu.create': 'Создать',
    'menu.playersN': '{n} игроков',
    'menu.loadTestSubtitle': 'Нагрузочный тест — N игроков на карте «Круглая»',
    'menu.players': 'Игроков:',
    'menu.runTest': 'Запустить тест',
    'menu.mapNPlayers': 'Карта: {map} · {slots}/{max} игроков',
    'menu.host': 'хозяин',
    'menu.freeSlots': 'Свободно мест: {n}',
    'menu.waitingHost': 'Ожидание начала игры хозяином…',
    'menu.leaveRoom': 'Покинуть комнату',
    'menu.resume': 'Продолжить',
    'menu.pause': 'Пауза',
    'banner.paused': 'Пауза',
    'banner.defeat': 'Поражение: {name}!',
    'banner.victory': 'Победа: {name}!',
    'banner.connecting': 'Подключение…',
    'hotkeys.hint': '1–9/0 — армия · Tab — карта · Пробел — пауза',
    'burger.restart': 'Перезапустить игру',
    'burger.toMenu': 'Выйти в меню',
    'confirm.restart': 'Перезапустить игру?',
    'confirm.leave': 'Выйти из комнаты? Игра продолжится с компьютером вместо вас.',
    'map.normal': 'Обычная',
    'map.normalDesc': 'прямоугольник 16×12',
    'map.long': 'Длинная',
    'map.longDesc': 'полоса 24×9',
    'map.island': 'Остров',
    'map.islandDesc': 'овал с водой по краям',
    'map.round': 'Круглая',
    'map.roundDesc': 'круг радиусом 9',
    'terrain.grass': 'Равнина',
    'terrain.forest': 'Лес',
    'terrain.mountain': 'Горы',
    'terrain.water': 'Вода',
    'terrain.desert': 'Пустыня',
    'terrain.mine': 'Шахта',
    'hex.owner': 'Владелец: {name}',
    'hex.capital': ' ★ столица',
    'hex.fortress': 'Крепость',
    'hex.capture': 'Захват: {name}',
    'player.name': 'Игрок {id}',
    'army.label': 'Армия',
    'army.hint': '% от очков · доступно {available}/{limit}',
    'hud.eliminated': 'выбыл',
    'fps.hideSummary': 'Скрыть итог',
    'fps.summary': 'Итог',
    'fps.avg': 'Средний: {fps}',
    'fps.time': 'Время: {s} с',
    'cm.removeFortress': 'Снести крепость',
    'cm.buildFortress': 'Построить крепость',
    'cm.fortressHint': 'нужно 15+ клеток и запас лимита',
    'cm.acceptPeace': 'Принять мир',
    'cm.acceptAlliance': 'Принять союз',
    'cm.decline': 'Отклонить',
    'cm.war': 'Война',
    'cm.peace': 'Мир',
    'cm.alliance': 'Союз',
    'cm.alreadyPeace': 'уже мир',
    'cm.alreadyWar': 'уже война',
    'cm.notInWar': 'во время войны нельзя',
    'cm.allies': 'вы союзники',
    'cm.alreadyAlliance': 'уже союз',
    'training.badge': 'Обучение',
    'training.stageN': 'Этап {n} из 6: {name}',
    'training.captureTitle': 'Захват',
    'training.attackTitle': 'Атака',
    'training.defendTitle': 'Защита',
    'training.fortressTitle': 'Крепость',
    'training.diplomacyTitle': 'Дипломатия',
    'training.doneTitle': 'Завершено',
    'training.captureHint': 'Захвати нейтральный гекс (клик по нему)',
    'training.attackHint': 'Атакуй вражеский гекс. Если война не объявлена: ПКМ по вражескому гексу → Война, затем атакуй',
    'training.defendHint': 'Защити атакуемый гекс (клик по нему)',
    'training.fortressHint': 'Построй крепость на своём гексе (ПКМ → Построить крепость)',
    'training.diplomacyHint': 'ПКМ по вражескому гексу: предложи мир или союз, либо объяви войну',
    'training.doneHint': 'Обучение завершено! Игра продолжается.',
    'training.ok': 'Ок',
  },
};

const STORAGE_KEY = 'conquest.lang';

function loadLang(): Lang {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'ru' ? 'ru' : 'en';
}

export const lang = ref<Lang>(loadLang());

export function setLang(next: Lang): void {
  lang.value = next;
  localStorage.setItem(STORAGE_KEY, next);
}

export function t(key: string, vars?: Record<string, string | number>): string {
  let text = messages[lang.value][key] ?? messages['en'][key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}

export function useI18n(): { t: typeof t; lang: Ref<Lang>; setLang: typeof setLang } {
  return { t, lang, setLang };
}
```

- [ ] **Step 2: Проверить сборку**

Run: `cd web && npm run build`
Expected: чисто.

- [ ] **Step 3: types.ts — типы**

В `web/src/types.ts`:

1. Добавить тип и поменять `GameState.pendingProposals`:
```ts
export interface PendingProposal {
  from: number;
  to: number;
  kind: 'peace' | 'alliance';
}
```
и в `GameState`:
```ts
  pendingProposals: PendingProposal[];
```

2. В `RoomView` после `loadTest: boolean;`:
```ts
  training: boolean;
```

3. В `ClientMessage` заменить `start-solo`:
```ts
  | { type: 'start-solo'; mapType: MapType; aiCount: number; difficulty: Difficulty; training?: boolean }
```

- [ ] **Step 4: api.ts — sendStartSolo**

В `web/src/api.ts` заменить метод:
```ts
  sendStartSolo(mapType: MapType, aiCount: number, difficulty: Difficulty, training = false): void {
    this.send({ type: 'start-solo', mapType, aiCount, difficulty, training });
  }
```

- [ ] **Step 5: Проверить сборку (зелёная)**

Run: `cd web && npm run build`
Expected: чисто (новые поля типов пока никем не читаются — не мешает).

- [ ] **Step 6: Commit**

```bash
git add web/src/i18n.ts web/src/types.ts web/src/api.ts
git commit -m "feat: i18n-модуль (EN/RU) + типы training и PendingProposal.to"
```

---
### Task 3: Перевод App.vue + переключатель языка

**Files:**
- Modify: `web/src/App.vue` (весь шаблон + импорт + 2 confirm)
- Modify: `web/src/types.ts` (MAP_INFO → labelKey/descriptionKey)

**Interfaces:**
- Consumes: `t`, `lang`, `setLang` из `web/src/i18n.ts` (Task 2).
- Produces: главное меню с переключателем EN/RU; все строки App.vue через `t()`; `MAP_INFO` c `labelKey`/`descriptionKey`.

- [ ] **Step 1: types.ts — MAP_INFO → ключи**

В `web/src/types.ts` заменить `MapInfo` и `MAP_INFO`:
```ts
export interface MapInfo {
  labelKey: string;
  descriptionKey: string;
  minPlayers: number;
  maxPlayers: number;
  recommendedAi: number;
}

export const MAP_INFO: Record<MapType, MapInfo> = {
  normal: { labelKey: 'map.normal', descriptionKey: 'map.normalDesc', minPlayers: 2, maxPlayers: 5, recommendedAi: 1 },
  long: { labelKey: 'map.long', descriptionKey: 'map.longDesc', minPlayers: 2, maxPlayers: 4, recommendedAi: 1 },
  island: { labelKey: 'map.island', descriptionKey: 'map.islandDesc', minPlayers: 2, maxPlayers: 4, recommendedAi: 1 },
  round: { labelKey: 'map.round', descriptionKey: 'map.roundDesc', minPlayers: 2, maxPlayers: 6, recommendedAi: 1 },
};
```

- [ ] **Step 2: App.vue — скрипт**

1. В импортах добавить:
```ts
import { t, lang, setLang } from './i18n';
```

2. В `function onRestart()` заменить confirm:
```ts
  if (!window.confirm(t('confirm.restart'))) return;
```

3. В `function onToMenu()` заменить confirm:
```ts
  if (!window.confirm(t('confirm.leave'))) return;
```

- [ ] **Step 3: App.vue — шаблон**

Полностью заменить блок `<template>...</template>` (от `<template>` до `</template>` перед `<style scoped>`) на:

```html
<template>
  <main class="app">
    <template v-if="screen === 'menu' && !room">
      <div class="menu">
        <h1 class="menu__title">Conquest</h1>
        <p class="menu__subtitle">{{ t('menu.subtitle') }}</p>
        <button class="menu__btn" :disabled="!connected" @click="goToAi">{{ t('menu.playVsAi') }}</button>
        <button class="menu__btn" :disabled="!connected" @click="goToLobby">{{ t('menu.playVsHumans') }}</button>
        <button class="menu__btn" :disabled="!connected" @click="goToLoadTest">{{ t('menu.loadTest') }}</button>
        <div v-if="GOOGLE_CLIENT_ID" class="menu__google">
          <div v-if="auth" class="menu__auth">{{ t('menu.loggedInAs', { name: auth.name }) }}</div>
          <div v-else id="google-btn"></div>
        </div>
        <div class="menu__lang">
          <button class="menu__lang-btn" :class="{ 'is-active': lang === 'en' }" @click="setLang('en')">EN</button>
          <button class="menu__lang-btn" :class="{ 'is-active': lang === 'ru' }" @click="setLang('ru')">RU</button>
        </div>
      </div>
    </template>

    <template v-else-if="screen === 'ai' && !room">
      <div class="menu">
        <h1 class="menu__title">Conquest</h1>
        <p class="menu__subtitle">{{ t('menu.aiSubtitle') }}</p>
        <select v-model="aiMapType" class="menu__select">
          <option v-for="(info, type) in MAP_INFO" :key="type" :value="type">
            {{ t(info.labelKey) }} — {{ t(info.descriptionKey) }}
          </option>
        </select>
        <div class="menu__row">
          <span class="menu__label">{{ t('menu.aiCount') }}</span>
          <select v-model.number="aiCount" class="menu__select">
            <option v-for="n in aiMax" :key="n" :value="n">{{ n }}</option>
          </select>
        </div>
        <div class="menu__row">
          <span class="menu__label">{{ t('menu.difficulty') }}</span>
          <select v-model="aiDifficulty" class="menu__select">
            <option value="easy">{{ t('difficulty.easy') }}</option>
            <option value="medium">{{ t('difficulty.medium') }}</option>
            <option value="hard">{{ t('difficulty.hard') }}</option>
          </select>
        </div>
        <button class="menu__btn" :disabled="!connected" @click="startSolo">{{ t('menu.startGame') }}</button>
        <button class="menu__btn menu__btn--ghost" @click="goToMenu">{{ t('menu.back') }}</button>
      </div>
    </template>

    <template v-else-if="screen === 'lobby' && !room">
      <div class="menu">
        <h1 class="menu__title">Conquest</h1>
        <p class="menu__subtitle">{{ t('menu.lobbySubtitle') }}</p>
        <div class="lobby">
          <div v-for="r in rooms" :key="r.id" class="lobby__room" @click="joinRoom(r.id)">
            <span class="lobby__name">{{ r.name }}</span>
            <span class="lobby__map">{{ t(MAP_INFO[r.mapType].labelKey) }}</span>
            <span class="lobby__players">{{ r.humans }}/{{ r.maxPlayers }}</span>
          </div>
          <div v-if="rooms.length === 0" class="lobby__empty">{{ t('menu.noRooms') }}</div>
        </div>
        <div class="lobby__create">
          <h3 class="lobby__create-title">{{ t('menu.createRoom') }}</h3>
          <select v-model="createMapType" class="menu__select">
            <option v-for="(info, type) in MAP_INFO" :key="type" :value="type">
              {{ t(info.labelKey) }} — {{ t(info.descriptionKey) }}
            </option>
          </select>
          <select v-model.number="createMaxPlayers" class="menu__select">
            <option v-for="n in createOptions" :key="n" :value="n">{{ t('menu.playersN', { n }) }}</option>
          </select>
          <button class="menu__btn" :disabled="!connected" @click="createRoom">{{ t('menu.create') }}</button>
        </div>
        <button class="menu__btn menu__btn--ghost" @click="goToMenu">{{ t('menu.back') }}</button>
      </div>
    </template>

    <template v-else-if="screen === 'loadtest' && !room">
      <div class="menu">
        <h1 class="menu__title">Conquest</h1>
        <p class="menu__subtitle">{{ t('menu.loadTestSubtitle') }}</p>
        <div class="menu__row">
          <span class="menu__label">{{ t('menu.players') }}</span>
          <select v-model.number="loadTestPlayers" class="menu__select">
            <option :value="5">5</option>
            <option :value="10">10</option>
            <option :value="20">20</option>
            <option :value="30">30</option>
          </select>
        </div>
        <button class="menu__btn" :disabled="!connected" @click="startLoadTest">{{ t('menu.runTest') }}</button>
        <button class="menu__btn menu__btn--ghost" @click="goToMenu">{{ t('menu.back') }}</button>
      </div>
    </template>

    <template v-else-if="room && room.status === 'waiting'">
      <div class="menu">
        <h1 class="menu__title">{{ room.name }}</h1>
        <p class="menu__subtitle">
          {{ t('menu.mapNPlayers', { map: t(MAP_INFO[room.mapType].labelKey), slots: room.slots.length, max: room.maxPlayers }) }}
        </p>
        <div class="lobby">
          <div v-for="s in room.slots" :key="s.id" class="lobby__room">
            <span class="lobby__name">{{ s.name }}</span>
            <span v-if="s.id === room.hostPlayerId" class="lobby__host">{{ t('menu.host') }}</span>
          </div>
          <div v-if="room.maxPlayers - room.slots.length > 0" class="lobby__empty">
            {{ t('menu.freeSlots', { n: room.maxPlayers - room.slots.length }) }}
          </div>
        </div>
        <button v-if="isHost" class="menu__btn" :disabled="!connected" @click="startRoom">{{ t('menu.startGame') }}</button>
        <p v-else class="menu__waiting">{{ t('menu.waitingHost') }}</p>
        <button class="menu__btn menu__btn--ghost" @click="leaveRoom">{{ t('menu.leaveRoom') }}</button>
      </div>
    </template>

    <template v-else-if="room && game">
      <div class="game-screen">
        <div class="app__header">
          <h1>{{ room.name }}</h1>
          <div class="app__controls">
            <button v-if="showPause" class="app__btn" :disabled="!connected" @click="onPause">
              {{ room.paused ? t('menu.resume') : t('menu.pause') }}
            </button>
            <button class="app__btn app__burger" @click="burgerOpen = !burgerOpen">☰</button>
          </div>
        </div>
        <div v-if="room.paused && !winner" class="banner banner--pause">{{ t('banner.paused') }}</div>
        <div v-if="winner && defeated" class="banner banner--error banner--center">{{ t('banner.defeat', { name: winner }) }}</div>
        <div v-else-if="winner" class="banner banner--win banner--center">{{ t('banner.victory', { name: winner }) }}</div>
        <div v-else-if="!connected" class="banner banner--warn">{{ t('banner.connecting') }}</div>
        <div v-if="error" class="banner banner--error">{{ error }}</div>
        <Hud v-if="game && !room.loadTest" :game="game" :human-id="playerId" :army="army" />
        <FpsOverlay v-if="room.loadTest" />
        <div v-if="room && game && !room.loadTest" class="hotkeys-hint">{{ t('hotkeys.hint') }}</div>
        <HexMap
          ref="hexMapRef"
          v-if="game"
          :hexes="game.hexes"
          :players="game.players"
          :capture-ticks="game.captureTicks"
          :menu-open="contextMenu !== null"
          @click="onHexClick"
          @contextmenu="onContextMenu"
        />
        <ContextMenu
          v-if="contextMenu"
          :hex="contextMenu.hex"
          :x="contextMenu.x"
          :y="contextMenu.y"
          :players="game.players"
          :human-id="playerId"
          :relation="contextMenu.relation"
          :pending-from-owner="contextMenu.pendingFromOwner"
          :hex-count="myPlayer?.hexCount ?? 0"
          :fortress-count="fortressCountOf(myPlayer?.id ?? null)"
          :points="myPlayer?.points ?? 0"
          @close="closeContextMenu"
          @declare-war="onMenuDeclareWar"
          @propose="onMenuPropose"
          @respond="onMenuRespond"
          @build-fortress="onMenuBuildFortress"
          @remove-fortress="onMenuRemoveFortress"
        />
        <ArmyBar v-if="game && !room.loadTest" :game="game" :human-id="playerId" :army="army" @army-change="onArmyChange" />
        <div v-if="room.log?.length && !room.loadTest" class="log-panel">
          <div v-for="(entry, i) in room.log" :key="i" class="log-panel__entry">{{ entry }}</div>
        </div>
      </div>
    </template>

    <div v-if="burgerOpen" class="burger-overlay" @click.self="burgerOpen = false">
      <div class="burger-menu">
        <button v-if="room?.aiMode" class="burger-menu__item" @click="onRestart">{{ t('burger.restart') }}</button>
        <button class="burger-menu__item" @click="onToMenu">{{ t('burger.toMenu') }}</button>
      </div>
    </div>
  </main>
</template>
```

- [ ] **Step 4: App.vue — стили переключателя**

Добавить в `<style scoped>` (рядом с `.menu__waiting`, в конце блока меню-стилей):

```css
.menu__lang {
  display: flex;
  gap: 8px;
  margin-top: 20px;
}
.menu__lang-btn {
  padding: 6px 14px;
  border: 1px solid #888;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 14px;
}
.menu__lang-btn.is-active {
  background: #888;
  color: #fff;
}
```

- [ ] **Step 5: Проверить сборку**

Run: `cd web && npm run build`
Expected: чисто.

- [ ] **Step 6: Commit**

```bash
git add web/src/App.vue web/src/types.ts
git commit -m "feat: перевод UI и переключатель языка EN/RU"
```

---
### Task 4: Перевод остальных клиентских компонентов

**Files:**
- Modify: `web/src/components/ContextMenu.vue`
- Modify: `web/src/components/HexMap.vue`
- Modify: `web/src/components/Hud.vue`
- Modify: `web/src/components/ArmyBar.vue`
- Modify: `web/src/components/FpsOverlay.vue`
- Modify: `web/src/types.ts` (TERRAIN_LABELS → ключи)

**Interfaces:**
- Consumes: `t` из `web/src/i18n.ts`.
- Produces: все строки компонентов через `t()`; `TERRAIN_LABELS` со значениями-ключами.

- [ ] **Step 1: types.ts — TERRAIN_LABELS → ключи**

В `web/src/types.ts` заменить `TERRAIN_LABELS`:
```ts
export const TERRAIN_LABELS: Record<Terrain, string> = {
  grass: 'terrain.grass',
  forest: 'terrain.forest',
  mountain: 'terrain.mountain',
  water: 'terrain.water',
  desert: 'terrain.desert',
  mine: 'terrain.mine',
};
```

- [ ] **Step 2: ContextMenu.vue**

1. В `<script setup>` добавить импорт:
```ts
import { t } from '../i18n';
```

2. В `items` computed заменить все литералы `label`/`hint`:
```ts
    return [{ label: t('cm.removeFortress'), disabled: false, hint: '', action: 'remove-fortress' }];
```
```ts
    return [
      { label: t('cm.buildFortress'), disabled: !canBuildFortress.value, hint: canBuildFortress.value ? '' : t('cm.fortressHint'), action: 'build-fortress' },
    ];
```
```ts
    if (props.pendingFromOwner) {
      return [
        { label: props.pendingFromOwner.kind === 'peace' ? t('cm.acceptPeace') : t('cm.acceptAlliance'), disabled: false, hint: '', action: 'respond-true' },
        { label: t('cm.decline'), disabled: false, hint: '', action: 'respond-false' },
      ];
    }
    if (props.relation === 'peace') {
      return [
        { label: t('cm.war'), disabled: false, hint: '', action: 'war' },
        { label: t('cm.peace'), disabled: true, hint: t('cm.alreadyPeace'), action: '' },
        { label: t('cm.alliance'), disabled: false, hint: '', action: 'alliance' },
      ];
    }
```
и в остальных ветках:
```ts
        { label: t('cm.peace'), disabled: false, hint: '', action: 'peace' },
        { label: t('cm.war'), disabled: true, hint: t('cm.alreadyWar'), action: '' },
        { label: t('cm.alliance'), disabled: true, hint: t('cm.notInWar'), action: '' },
```
```ts
        { label: t('cm.war'), disabled: false, hint: '', action: 'war' },
        { label: t('cm.peace'), disabled: true, hint: t('cm.allies'), action: '' },
        { label: t('cm.alliance'), disabled: true, hint: t('cm.alreadyAlliance'), action: '' },
```
(точные строки-литералы `'Война'`, `'Мир'`, `'Союз'`, `'уже война'`, `'во время войны нельзя'`, `'вы союзники'`, `'уже союз'`, `'Отклонить'`, `Принять ...` — заменить по таблице в i18n: `cm.war`, `cm.peace`, `cm.alliance`, `cm.alreadyWar`, `cm.notInWar`, `cm.allies`, `cm.alreadyAlliance`, `cm.decline`, `cm.acceptPeace`/`cm.acceptAlliance`.)

- [ ] **Step 3: HexMap.vue**

1. В `<script setup>` добавить импорт:
```ts
import { t } from '../i18n';
```

2. `playerName` fallback (строка ~248):
```ts
  return props.players.find((p) => p.id === id)?.name ?? t('player.name', { id });
```

3. В шаблоне:
```ts
        <span>{{ t(TERRAIN_LABELS[hovered.terrain]) }}</span>
```
```ts
        <span>{{ t('hex.owner', { name: playerName(hovered.ownerId) }) }}{{ capitalPlayer(hovered) ? t('hex.capital') : '' }}</span>
```
```ts
        <span>{{ t('hex.fortress') }}</span>
```
```ts
            {{ t('hex.capture', { name: playerName(captureState(hovered)!.byId) }) }}
```

- [ ] **Step 4: Hud.vue**

1. Импорт: `import { t } from '../i18n';`
2. `<span v-if="p.eliminated" class="player-list__dead">выбыл</span>` → `<span v-if="p.eliminated" class="player-list__dead">{{ t('hud.eliminated') }}</span>`

- [ ] **Step 5: ArmyBar.vue**

1. Импорт: `import { t } from '../i18n';`
2. `Армия` → `{{ t('army.label') }}`
3. `% от очков · доступно {{ available }}/{{ limit }}` → `{{ t('army.hint', { available, limit }) }}`

- [ ] **Step 6: FpsOverlay.vue**

1. Импорт: `import { t } from '../i18n';`
2. `{{ showSummary ? 'Скрыть итог' : 'Итог' }}` → `{{ showSummary ? t('fps.hideSummary') : t('fps.summary') }}`
3. `Средний:` → `{{ t('fps.avg', { fps: avgFps() }) }}`; `Время: {{ duration() }} с` → `{{ t('fps.time', { s: duration() }) }}`

- [ ] **Step 7: Проверить сборку**

Run: `cd web && npm run build`
Expected: чисто. Дополнительно убедиться, что в `web/src` не осталось пользовательских кириллических строк (комментарии не считаем):
`rg -P "[\p{Cyrillic}]{4,}" web/src --include` — в .vue/.ts должны остаться только комментарии и словари i18n (или ничего критичного).

- [ ] **Step 8: Commit**

```bash
git add web/src/components web/src/types.ts
git commit -m "feat: перевод компонентов и террейнов"
```

---
### Task 5: Сервер — английский навсегда + тесты

**Files:**
- Modify: `server/src/rules.ts`, `server/src/rooms.ts`, `server/src/ws.ts`, `server/src/ai.ts` (комментарии не трогать), `server/src/config.ts`, `server/src/stats.ts`, `server/src/auth.ts`
- Modify: `server/test/rules.test.ts`, `server/test/rooms.test.ts` (только сравниваемые литералы)
- Test: `cd server && npm test`

**Interfaces:**
- Consumes: всё существующее.
- Produces: сервер без пользовательских кириллических строк; тесты PASS.

- [ ] **Step 1: Прочитать текущие литералы**

Каждая строка ниже — точный текущий русский литерал в коде сервера. Заменить его на английский в указанном файле (во всех вхождениях). Имена тестов (`it('...')`) и комментарии не менять.

**rules.ts:**

| Старое (RU) | Новое (EN) |
|---|---|
| `'Игра окончена'` | `'Game over'` |
| `'Вложение должно быть целым числом ≥ 1'` | `'Investment must be an integer ≥ 1'` |
| `'Гекс не найден'` | `'Hex not found'` |
| `'Нельзя атаковать свой гекс'` | `'Cannot attack your own hex'` |
| `'Нужно объявить войну'` | `'Declare war first'` |
| `'Нейтральный гекс захватывается, а не атакуется'` | `'Neutral hexes are captured, not attacked'` |
| `'Битву уже ведёт соперник'` | `'The opponent is already fighting for this hex'` |
| `'Гекс не соседний'` | `'Hex is not adjacent'` |
| `'Минимальное вложение в атаку — стоимость гекса'` | `'Minimum investment in an attack is the hex cost'` |
| `'Игрок не найден'` | `'Player not found'` |
| `'Вы выбыли из игры'` | `'You are out of the game'` |
| `'Не хватает очков'` | `'Not enough points'` |
| `'Не хватает очков (часть занята армией)'` | `'Not enough points (part is reserved by the army)'` |
| `'Не хватает очков для битвы у границы врага'` | `'Not enough points for a battle at the enemy border'` |
| `'Битвы нет'` | `'There is no battle here'` |
| `'Нельзя защищать свою же атаку'` | `'Cannot defend your own attack'` |
| `'Гекс принадлежит другому'` | `'Hex belongs to someone else'` |
| `'Это не ваш гекс'` | `'This is not your hex'` |
| `'За гекс идёт битва'` | `'There is a battle for this hex'` |
| `'За гекс уже идёт борьба'` | `'There is already a fight for this hex'` |
| `'Здесь уже есть крепость'` | `'A fortress already exists here'` |
| `'Здесь нет вашей крепости'` | `'There is no fortress of yours here'` |
| `'Достигнут лимит крепостей'` | `'Fortress limit reached'` |
| `'Сначала потратьте очки: крепость уменьшает лимит'` | `'Spend points first: a fortress lowers the limit'` |
| `'Гекс уже занят'` | `'Hex is already occupied'` |
| `'Нужно объявить войну соседнему игроку'` | `'Declare war on the neighboring player first'` |
| `'Первый гекс не может быть на воде'` | `'The first hex cannot be on water'` |

**rooms.ts:**

| Старое (RU) | Новое (EN) |
|---|---|
| `'Игра уже началась'` | `'The game has already started'` |
| `'Нет хозяина'` | `'There is no host'` |
| `'Только хозяин может начать игру'` | `'Only the host can start the game'` |
| `'Вы не в этой комнате'` | `"You're not in this room"` |
| `'Игра ещё не началась'` | `'The game has not started yet'` |
| `'Некорректные координаты'` | `'Invalid coordinates'` |
| `'В игре с людьми пауза недоступна'` | `'Pause is not available in human games'` |
| `'Владелец гекса не найден'` | `'Hex owner not found'` |
| `'Уже в войне'` | `'Already at war'` |
| `'Неизвестный тип предложения'` | `'Unknown proposal type'` |
| `'Мир можно предложить только во время войны'` | `'Peace can only be proposed during a war'` |
| `'Союз невозможен при текущих отношениях'` | `'Alliance is not possible with current relations'` |
| `'Предложение уже отправлено'` | `'Proposal already sent'` |
| `'Нет предложения от этого игрока'` | `'There is no proposal from this player'` |
| `'Игра перезапущена'` | `'Game restarted'` |
| `'Перезапуск доступен только в игре с компьютером'` | `'Restart is only available in games with the computer'` |
| `'Новая игра началась'` | `'New game started'` |
| `'Вы уже в комнате'` | `"You're already in a room"` |
| `'Неизвестный тип карты'` | `'Unknown map type'` |
| `'Неизвестная сложность'` | `'Unknown difficulty'` |
| `'Комната заполнена'` | `'The room is full'` |
| `'Компьютеров должно быть от 1 до '` (в шаблон-строке) | `'Computer count must be between 1 and '` |
| `'Количество игроков должно быть 5, 10, 20 или 30'` | `'Player count must be 5, 10, 20, or 30'` |
| `` `Неизвестный тип сообщения: ${type}` `` | `` `Unknown message type: ${type}` `` |

Лог-сообщения (шаблон-строки `addLog`/`playerName`) — новые английские формы, сохраняя плейсхолдеры:

| Старое | Новое |
|---|---|
| `` `${name} присоединился к комнате` `` | `` `${name} joined the room` `` |
| `` `${name} вышел из комнаты` `` | `` `${name} left the room` `` |
| `` `Битва за (${q}, ${r}) окончена — ничья` `` | `` `Battle for (${q}, ${r}) ended — draw` `` |
| `` `Битва за (${q}, ${r}) окончена — победил ${name}` `` | `` `Battle for (${q}, ${r}) ended — ${name} won` `` |
| `` `${name} окружил и захватил ${n} клеток` `` | `` `${name} surrounded and captured ${n} hexes` `` |
| `` `${name} потерял столицу и выбыл из игры` `` | `` `${name} lost the capital and left the game` `` |
| `` `Территория ${name} стала нейтральной` `` | `` `${name}'s territory became neutral` `` |
| `` `Территория ${name} разделена между: ${names}` `` | `` `${name}'s territory is divided between: ${names}` `` |
| `` `${name} отрезан: ${n} клеток стали нейтральными` `` | `` `${name} was cut off: ${n} hexes became neutral` `` |
| `` `${name} вложил ${points} очков в атаку на (${q}, ${r})` `` | `` `${name} invested ${points} points in an attack on (${q}, ${r})` `` |
| `` `${name} защищает (${q}, ${r}): +${points}` `` | `` `${name} is defending (${q}, ${r}): +${points}` `` |
| `` `${name} построил крепость на (${q}, ${r})` `` | `` `${name} built a fortress on (${q}, ${r})` `` |
| `` `${name} снёс крепость на (${q}, ${r})` `` | `` `${name} removed a fortress on (${q}, ${r})` `` |
| `` `${name} объявил войну ${target}` `` | `` `${name} declared war on ${target}` `` |
| `` `${name} предлагает мир ${target}` `` | `` `${name} proposes peace to ${target}` `` |
| `` `${name} предлагает союз ${target}` `` | `` `${name} proposes an alliance to ${target}` `` |
| `` `${name} и ${target} заключили мир` `` | `` `${name} and ${target} made peace` `` |
| `` `${name} и ${target} заключили союз` `` | `` `${name} and ${target} formed an alliance` `` |
| `` `${name} отклонил предложение ${target}` `` | `` `${name} declined ${target}'s proposal` `` |
| `` `${name} покинул игру — его место занял компьютер` `` | `` `${name} left the game — the computer took over` `` |
| `` `Игрок ${id}` `` | `` `Player ${id}` `` |
| `` `Игрок` `` | `` `Player` `` |

Имена стран (`COUNTRY_PREFIXES` / `COUNTRY_SUFFIXES`) — заменить массивами на английский фэнтези-сет:
```ts
const COUNTRY_PREFIXES = [
  'Nord', 'Silv', 'Vald', 'Dorn', 'Karl', 'Torv', 'Eld', 'Mork', 'Brein', 'Ost',
  'Drag', 'Kel', 'Gard', 'Hal', 'Vant', 'Zorn', 'Quir', 'Grau', 'Ald', 'Fast',
];
const COUNTRY_SUFFIXES = [
  'ia', 'land', 'mark', 'dor', 'nia', 'via', 'gon', 'ar', 'tia', 'shire',
  'ley', 'mor', 'heim', 'stan',
];
```

**ws.ts:**

| Старое | Новое |
|---|---|
| `'Некорректный JSON'` | `'Invalid JSON'` |
| `'Некорректное сообщение'` | `'Invalid message'` |
| `'Ошибка входа'` | `'Login error'` |
| `'Ошибка сервера'` | `'Server error'` |

**config.ts:**

| Старое | Новое |
|---|---|
| `` `Некорректный конфиг ${name}=${raw}, использую ${fallback}` `` | `` `Invalid config ${name}=${raw}, using ${fallback}` `` |

**stats.ts:**

| Старое | Новое |
|---|---|
| `` `Игрок ${sp.id}` `` | `` `Player ${sp.id}` `` |

**auth.ts:**

| Старое | Новое |
|---|---|
| `'Игрок'` | `'Player'` |
| `'Пустой токен'` | `'Empty token'` |
| `'Ошибка проверки токена'` | `'Token verification error'` |
| `'Google-вход не настроен на сервере'` | `'Google sign-in is not configured on the server'` |
| `'Не удалось проверить токен Google'` | `'Failed to verify Google token'` |

- [ ] **Step 2: Обновить тесты**

В `server/test/rules.test.ts` и `server/test/rooms.test.ts` заменить ВСЕ литералы, которые сравниваются с сообщениями выше/логами, на новые английские (по таблице). Имена `describe`/`it` по-русски не трогать. Примеры: `expect(result.error).toBe('Не хватает очков')` → `'Not enough points'`; `expect(room.view().log.join()).toContain('Game restarted')` и т.п.

- [ ] **Step 3: Проверить сервер: тесты + проверить отсутствие строк**

Run: `cd server && npm test`
Expected: все PASS.

Проверка остатка (только комментарии допустимы):
`rg -n -P "[\p{Cyrillic}]{4,}" server/src`
Expected: остаются только строки в комментариях (`//`). Если есть кириллица в строковых литералах — перевести.

- [ ] **Step 4: Commit**

```bash
git add server/src server/test
git commit -m "feat: сервер на английском (лог, ошибки, имена стран)"
```

---
### Task 6: Обучение — машина этапов на клиенте

**Files:**
- Create: `web/src/training.ts`
- Modify: `web/src/App.vue` (кнопка «Обучение», watch, оверлей, бейдж, рестарт)

**Interfaces:**
- Consumes: `t` из i18n; `client.sendStartSolo(..., training)`; `RoomView.training`, `GameState.pendingProposals[].from/to`; `playerId`, `room`, `game`, `winner` refs в App.vue; пауза `client.sendPause()`.
- Produces:
  - `web/src/training.ts`: `trainingStage: Ref<TrainingStage|null>`, `taskDone: Ref<boolean>`, `STAGE_ORDER: TrainingStage[]`, `initTraining({sendPause,isPaused})`, `stopTraining()`, `observeTraining(state, playerId)`, `continueTutorial()`.
  - В App.vue: `startTutorial()`; оверлей-подсказка с кнопкой «Ок»; бейдж «Обучение»; сброс машины при рестарте и остановка при выходе/окончании игры.

- [ ] **Step 1: Создать `web/src/training.ts`**

```ts
import { ref, type Ref } from 'vue';
import { isAdjacent, type GameState, type Hex } from './types';

export type TrainingStage = 'capture' | 'attack' | 'defend' | 'fortress' | 'diplomacy' | 'done';

export const STAGE_ORDER: TrainingStage[] = ['capture', 'attack', 'defend', 'fortress', 'diplomacy', 'done'];

const NEXT_STAGE: Record<TrainingStage, TrainingStage | null> = {
  capture: 'attack',
  attack: 'defend',
  defend: 'fortress',
  fortress: 'diplomacy',
  diplomacy: 'done',
  done: null,
};

export const trainingStage = ref<TrainingStage | null>(null);
export const taskDone = ref(false);

let sendPause: () => void = () => {};
let isPaused: () => boolean = () => false;
let wePaused = false;
let awaiting = false;
let prevRelations = new Map<number, string>();

function pauseIfNeeded(): void {
  if (!isPaused()) {
    sendPause();
    wePaused = true;
  } else {
    wePaused = false;
  }
}

function unpauseIfNeeded(): void {
  if (wePaused && isPaused()) {
    sendPause();
  }
  wePaused = false;
}

export function initTraining(opts: { sendPause: () => void; isPaused: () => boolean }): void {
  sendPause = opts.sendPause;
  isPaused = opts.isPaused;
  prevRelations = new Map();
  trainingStage.value = 'capture';
  taskDone.value = false;
  awaiting = false;
  wePaused = false;
  pauseIfNeeded();
}

export function stopTraining(): void {
  trainingStage.value = null;
  taskDone.value = false;
  awaiting = false;
  wePaused = false;
}

function myHexCount(state: GameState, playerId: number): number {
  return state.players.find((p) => p.id === playerId)?.hexCount ?? 0;
}

function myHexes(state: GameState, playerId: number): Hex[] {
  return state.hexes.filter((h) => h.ownerId === playerId);
}

export function fortressReady(state: GameState, playerId: number): boolean {
  const hexCount = myHexCount(state, playerId);
  const fortressCount = state.hexes.filter((h) => h.ownerId === playerId && h.fortress).length;
  const points = state.players.find((p) => p.id === playerId)?.points ?? 0;
  if (Math.floor(hexCount / 15) <= fortressCount) return false;
  const nextLimit = 1000 + hexCount * 50 - 100 * (fortressCount + 1);
  return points <= nextLimit;
}

export function observeTraining(state: GameState, playerId: number): void {
  if (trainingStage.value === null) return;
  const stage = trainingStage.value;

  switch (stage) {
    case 'capture':
      if (myHexCount(state, playerId) > 0) taskDone.value = true;
      break;
    case 'attack':
      if (awaiting) {
        const mine = myHexes(state, playerId);
        const adjacentEnemy = state.hexes.some(
          (h) => h.ownerId !== null && h.ownerId !== playerId && mine.some((m) => isAdjacent(m, h)),
        );
        if (adjacentEnemy) {
          awaiting = false;
          pauseIfNeeded();
        }
      } else if (state.hexes.some((h) => h.attackerId === playerId)) {
        taskDone.value = true;
      }
      break;
    case 'defend':
      if (awaiting) {
        const attackedMine = state.hexes.some(
          (h) => h.ownerId === playerId && h.attackerId !== null && h.attackerId !== playerId,
        );
        if (attackedMine) {
          awaiting = false;
          pauseIfNeeded();
        }
      } else if (state.hexes.some((h) => h.defenderId === playerId)) {
        taskDone.value = true;
      }
      break;
    case 'fortress':
      if (awaiting) {
        if (fortressReady(state, playerId)) {
          awaiting = false;
          pauseIfNeeded();
        }
      } else if (state.hexes.some((h) => h.ownerId === playerId && h.fortress === true)) {
        taskDone.value = true;
      }
      break;
    case 'diplomacy': {
      const relationsChanged = state.players.some((p) => {
        if (p.id === playerId) return false;
        const prev = prevRelations.get(p.id);
        if (prev === undefined) {
          prevRelations.set(p.id, p.relation);
          return false;
        }
        return prev !== p.relation;
      });
      const proposalSent = state.pendingProposals.some((p) => p.from === playerId);
      if (relationsChanged || proposalSent) taskDone.value = true;
      for (const p of state.players) prevRelations.set(p.id, p.relation);
      break;
    }
    case 'done':
      taskDone.value = true;
      break;
  }
}

export function continueTutorial(): void {
  const cur = trainingStage.value;
  if (cur === null) return;
  const next = NEXT_STAGE[cur];
  if (next === null) {
    unpauseIfNeeded();
    stopTraining();
    return;
  }
  trainingStage.value = next;
  taskDone.value = false;
  awaiting = false;
  prevRelations = new Map();
  if (next === 'done') {
    wePaused = false;
    pauseIfNeeded();
    taskDone.value = true;
  } else if (next === 'attack' || next === 'defend' || next === 'fortress') {
    awaiting = true;
    unpauseIfNeeded();
  } else {
    wePaused = false;
    pauseIfNeeded();
  }
}
```

- [ ] **Step 2: App.vue — импорты и скрипт**

1. В импортах добавить:
```ts
import { STAGE_ORDER, continueTutorial, initTraining, observeTraining, stopTraining, taskDone, trainingStage, type TrainingStage } from './training';
```

2. Добавить computed метаданных шага (после `showPause`):
```ts
const STAGE_META: Record<TrainingStage, { titleKey: string; hintKey: string }> = {
  capture: { titleKey: 'training.captureTitle', hintKey: 'training.captureHint' },
  attack: { titleKey: 'training.attackTitle', hintKey: 'training.attackHint' },
  defend: { titleKey: 'training.defendTitle', hintKey: 'training.defendHint' },
  fortress: { titleKey: 'training.fortressTitle', hintKey: 'training.fortressHint' },
  diplomacy: { titleKey: 'training.diplomacyTitle', hintKey: 'training.diplomacyHint' },
  done: { titleKey: 'training.doneTitle', hintKey: 'training.doneHint' },
};
const trainingIndex = computed(() => (trainingStage.value === null ? 0 : STAGE_ORDER.indexOf(trainingStage.value) + 1));
const trainingTitleKey = computed(() => (trainingStage.value ? STAGE_META[trainingStage.value].titleKey : ''));
const trainingHintKey = computed(() => (trainingStage.value ? STAGE_META[trainingStage.value].hintKey : ''));
```

3. Добавить watch (после существующего `watch(() => room.value, () => closeContextMenu())`). Обучение инициализируется ТОЛЬКО если игрок стартовал его в этой вкладке (маркер в `sessionStorage`): при перезагрузке страницы маркер уже израсходован, и игра идёт как обычная соло (по спека-решению, этап «перезагрузка»).
```ts
watch(
  () => room.value,
  (r) => {
    if (!r || !r.training) {
      stopTraining();
      return;
    }
    if (r.training && r.status === 'playing' && r.game && trainingStage.value === null && sessionStorage.getItem('conquest.training') === '1') {
      sessionStorage.removeItem('conquest.training');
      initTraining({ sendPause: () => client.sendPause(), isPaused: () => room.value?.paused ?? false });
    }
  },
);

watch(
  () => room.value?.game,
  (g) => {
    if (!g) return;
    if (trainingStage.value !== null && playerId.value !== null) {
      observeTraining(g, playerId.value);
      if (g.winnerId !== null || (g.players.find((p) => p.id === playerId.value)?.eliminated ?? false)) {
        stopTraining();
      }
    }
  },
);
```

4. Функция старта обучения (рядом с `startSolo`):
```ts
function startTutorial(): void {
  sessionStorage.setItem('conquest.training', '1');
  client.sendStartSolo('normal', 1, 'easy', true);
}
```

5. В `onRestart()` после `client.sendRestart();`:
```ts
  if (room.value?.training) {
    initTraining({ sendPause: () => client.sendPause(), isPaused: () => room.value?.paused ?? false });
  }
```

- [ ] **Step 3: App.vue — шаблон**

1. В главном меню после кнопки «Играть с людьми» добавить кнопку «Обучение»:
```html
        <button class="menu__btn" :disabled="!connected" @click="startTutorial">{{ t('menu.tutorial') }}</button>
```
(между `menu.playVsAi` и `menu.playVsHumans`).

2. В `app__controls` перед кнопкой паузы добавить бейдж (только в обучающей игре):
```html
            <span v-if="room?.training" class="training-badge">{{ t('training.badge') }}</span>
```

3. Внутри `game-screen`, сразу после блока баннеров (после `<div v-if="error" ...>`) добавить оверлей обучения:
```html
        <div v-if="trainingStage && !winner && !defeated" class="training-overlay">
          <div class="training-card">
            <div class="training-card__title">{{ t('training.stageN', { n: trainingIndex, name: t(trainingTitleKey) }) }}</div>
            <div class="training-card__hint">{{ t(trainingHintKey) }}</div>
            <button v-if="taskDone" class="training-card__ok" @click="continueTutorial">{{ t('training.ok') }}</button>
          </div>
        </div>
```

- [ ] **Step 4: App.vue — стили оверлея/бейджа**

Добавить в `<style scoped>`:

```css
.training-badge {
  padding: 4px 10px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.9);
  color: #333;
  font-size: 12px;
  font-weight: 600;
}
.training-overlay {
  position: fixed;
  top: 90px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 30;
  padding: 14px 20px;
  background: rgba(30, 30, 30, 0.92);
  color: #fff;
  border-radius: 10px;
  border: 1px solid #888;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  max-width: 480px;
  text-align: center;
}
.training-card__title {
  font-weight: 700;
  margin-bottom: 6px;
}
.training-card__hint {
  font-size: 14px;
  line-height: 1.4;
  margin-bottom: 10px;
}
.training-card__ok {
  padding: 6px 24px;
  border: none;
  border-radius: 6px;
  background: #4caf50;
  color: #fff;
  font-size: 15px;
  cursor: pointer;
}
.training-card__ok:hover {
  background: #43a047;
}
```

- [ ] **Step 5: Проверить сборку**

Run: `cd web && npm run build`
Expected: чисто.

- [ ] **Step 6: Ручной smoke-тест (обязательно)**

Поднять сервер и веб (`cd server && npm run dev` в одном терминале, `cd web && npm run dev` в другом), открыть браузер:

1. Главное меню: переключатель языка EN/RU меняет текст меню; по умолчанию EN.
2. «Tutorial/Обучение»: стартует игра против 1 лёгкого ИИ; игра заморожена; подсказка «Захвати нейтральный гекс»; после клика по нейтральному гексу появляется «Ок»; нажатие «Ок» → этап «Атакуй вражеский гекс», игра идёт.
3. Довести до конца все 6 этапов; после финального «Ок» игра идёт свободно, подсказок нет.
4. Бургер → «Перезапустить игру»: обучение начинается с этапа 1.
5. Переключение языка во время игры меняет тексты подсказок сразу.
6. Перезагрузка страницы во время обучения: подсказки исчезают, бейдж «Обучение» остаётся, игра идёт как обычная соло.

- [ ] **Step 7: Commit**

```bash
git add web/src/training.ts web/src/App.vue
git commit -m "feat: режим обучения — машина этапов и подсказки"
```
