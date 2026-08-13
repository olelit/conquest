# Контекстное меню ПКМ + чистка лога — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Вертикальное контекстное меню по правой кнопке мыши (пункты-заглушки для дипломатии и крепости) и удаление сообщений о захватах из игрового лога.

**Architecture:** Новый компонент `ContextMenu.vue` рендерится в App.vue поверх игры; HexMap эмитит `contextmenu` с гексом и координатами курсора; App.vue хранит состояние меню и закрывает его по клику/ESC/blur. На сервере удаляются две строки лога о захватах.

**Tech Stack:** Vue 3 + Vite (web), Node.js + TypeScript + vitest (server).

## Global Constraints

- Тесты сервера: `npx vitest run` из `server/` (160 существующих тестов зелёные).
- Проверка web: `npm run build` из `web/`.
- Язык UI — русский.
- Спецификация: `docs/superpowers/specs/2026-08-13-context-menu-design.md`.
- Стиль UI: тёмная плашка, как у `.battle-tooltip` (rgba(20,20,26,0.94), border #555, radius 8px).

---

### Task 1: ContextMenu.vue — компонент меню

**Files:**
- Create: `web/src/components/ContextMenu.vue`

**Interfaces:**
- Produces: `ContextMenu` — props `{ hex: Hex; x: number; y: number; players: Player[]; humanId: number | null }`, emits `close`; пункты меню определяются владельцем гекса.

- [ ] **Step 1: Создать компонент**

`web/src/components/ContextMenu.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue';
import type { Hex, Player } from '../types';

const props = defineProps<{ hex: Hex; x: number; y: number; players: Player[]; humanId: number | null }>();

const emit = defineEmits<{ close: [] }>();

const isMine = computed(() => props.hex.ownerId !== null && props.hex.ownerId === props.humanId);
const isEnemy = computed(() => props.hex.ownerId !== null && props.hex.ownerId !== props.humanId);

const items = computed(() => {
  if (isMine.value) {
    return [{ label: 'Построить крепость', disabled: true, hint: 'будет доступно позже' }];
  }
  if (isEnemy.value) {
    return [
      { label: 'Война', disabled: true, hint: 'будет доступно позже' },
      { label: 'Мир', disabled: true, hint: 'будет доступно позже' },
      { label: 'Союз', disabled: true, hint: 'будет доступно позже' },
    ];
  }
  return [];
});

const style = computed(() => {
  const margin = 8;
  const left = Math.min(props.x, window.innerWidth - 220 - margin);
  const top = Math.min(props.y, window.innerHeight - items.value.length * 38 - 24 - margin);
  return { left: `${Math.max(margin, left)}px`, top: `${Math.max(margin, top)}px` };
});

function pick(): void {
  emit('close');
}
</script>

<template>
  <div class="context-menu" :style="style" @mousedown.stop @contextmenu.prevent="pick">
    <button
      v-for="item in items"
      :key="item.label"
      class="context-menu__item"
      :disabled="item.disabled"
      :title="item.disabled ? item.hint : undefined"
      @click="pick"
    >
      <span>{{ item.label }}</span>
      <span v-if="item.disabled" class="context-menu__hint">{{ item.hint }}</span>
    </button>
  </div>
</template>

<style scoped>
.context-menu {
  position: fixed;
  z-index: 70;
  display: flex;
  flex-direction: column;
  min-width: 210px;
  background: rgba(20, 20, 26, 0.96);
  border: 1px solid #555;
  border-radius: 8px;
  padding: 4px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.6);
}

.context-menu__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.context-menu__item:not(:disabled):hover {
  background: #3a3a44;
}

.context-menu__item:disabled {
  color: #777;
  cursor: default;
}

.context-menu__hint {
  font-size: 11px;
  font-weight: 400;
  color: #666;
  white-space: nowrap;
}
</style>
```

- [ ] **Step 2: Проверка сборки**

Run: `npm run build` (в `web/`)
Expected: сборка проходит.

- [ ] **Step 3: Коммит**

```bash
git add web/src/components/ContextMenu.vue
git commit -m "feat: компонент контекстного меню"
```

---

### Task 2: HexMap — событие contextmenu и скрытие тултипа

**Files:**
- Modify: `web/src/components/HexMap.vue`

**Interfaces:**
- Consumes: `ContextMenu` (Task 1).
- Produces: emit `contextmenu: [{ hex: Hex; x: number; y: number }]`; новый prop `menuOpen: boolean` — при открытом меню тултип скрыт.

- [ ] **Step 1: Эмит и prop**

В `web/src/components/HexMap.vue`:

1. Сигнатура props:

```ts
const props = defineProps<{ hexes: Hex[]; players: Player[]; captureTicks: number; menuOpen?: boolean }>();
```

2. Сигнатура emits:

```ts
const emit = defineEmits<{
  click: [hex: Hex];
  contextmenu: [payload: { hex: Hex; x: number; y: number }];
}>();
```

3. В шаблоне hex-group добавить обработчик (рядом с `@click`):

```html
        @contextmenu="onContextMenu(hex, $event)"
```

4. Функция (рядом с `onWheel`):

```ts
function onContextMenu(hex: Hex, e: MouseEvent): void {
  emit('contextmenu', { hex, x: e.clientX, y: e.clientY });
}
```

(заглушка от системного меню уже стоит на контейнере: `@contextmenu.prevent` — оставить.)

5. Тултип: скрыть при открытом меню — условие рендера тултипа:

```html
    <div
      v-if="!menuOpen && tooltipPos && hovered"
```

- [ ] **Step 2: Проверка сборки**

Run: `npm run build` (в `web/`)
Expected: сборка проходит.

- [ ] **Step 3: Коммит**

```bash
git add web/src/components/HexMap.vue
git commit -m "feat: HexMap — событие contextmenu, тултип скрыт при открытом меню"
```

---

### Task 3: App.vue — состояние меню и рендер

**Files:**
- Modify: `web/src/App.vue`

**Interfaces:**
- Consumes: `ContextMenu` (Task 1), emit HexMap `contextmenu` (Task 2).
- Produces: `contextMenu` ref; закрытие по клику/ESC/blur; `menuOpen` prop для HexMap.

- [ ] **Step 1: Состояние и обработчики**

В `web/src/App.vue`:

1. Импорт: `import ContextMenu from './components/ContextMenu.vue';` и тип `Hex` уже импортирован.

2. После `const army = ref(20);`:

```ts
const contextMenu = ref<{ hex: Hex; x: number; y: number } | null>(null);
```

3. Обработчики (после `onHexClick`):

```ts
function onContextMenu(payload: { hex: Hex; x: number; y: number }): void {
  contextMenu.value = payload;
}

function closeContextMenu(): void {
  contextMenu.value = null;
}
```

4. Закрытие по клику/ESC/blur — в `onMounted` добавить слушатели (и убрать в `onBeforeUnmount`):

```ts
onMounted(() => {
  client.connect();
  window.addEventListener('click', closeContextMenu);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') closeContextMenu();
  });
  window.addEventListener('blur', closeContextMenu);
  ...
});
```

внимание: `keydown`-обработчик должен быть отдельной именованной функцией, чтобы корректно сниматься:

```ts
function onMenuKeydown(e: KeyboardEvent): void {
  if (e.code === 'Escape') closeContextMenu();
}
```

и в `onMounted`/`onBeforeUnmount`:

```ts
  window.addEventListener('keydown', onMenuKeydown);
  ...
  window.removeEventListener('keydown', onMenuKeydown);
```

5. Шаблон — передать prop в HexMap и отрендерить меню:

```html
        <HexMap
          v-if="game"
          :hexes="game.hexes"
          :players="game.players"
          :capture-ticks="game.captureTicks"
          :menu-open="contextMenu !== null"
          @click="onHexClick"
          @contextmenu="onContextMenu"
        />
```

и после `</HexMap>` (внутри `.game-screen`):

```html
        <ContextMenu
          v-if="contextMenu"
          :hex="contextMenu.hex"
          :x="contextMenu.x"
          :y="contextMenu.y"
          :players="game.players"
          :human-id="playerId"
          @close="closeContextMenu"
        />
```

- [ ] **Step 2: Проверка сборки**

Run: `npm run build` (в `web/`)
Expected: сборка проходит.

- [ ] **Step 3: Коммит**

```bash
git add web/src/App.vue
git commit -m "feat: состояние и рендер контекстного меню"
```

---

### Task 4: Сервер — убрать логи захватов

**Files:**
- Modify: `server/src/rooms.ts`
- Test: `server/test/rooms.test.ts`

**Interfaces:**
- Consumes: —
- Produces: игровой лог без сообщений о захватах (битвы и прочие события остаются).

- [ ] **Step 1: Написать падающий тест**

В `server/test/rooms.test.ts` добавить в блок «Room: действия и тик»:

```ts
  it('лог не содержит сообщений о захватах', () => {
    const room = makeRoom(true, 1, 2);
    room.addHuman('A', 1);
    room.start(1);
    room.handleAction(1, 'capture', { q: 0, r: 0 });
    room.tick();
    const log = room.view().log;
    expect(log.some((entry) => entry.includes('захватил'))).toBe(false);
  });
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run test/rooms.test.ts -t "лог не содержит"`
Expected: FAIL — лог содержит «захватил».

- [ ] **Step 3: Реализовать**

В `server/src/rooms.ts`:

1. В `handleAction` case 'capture' удалить строку:

```ts
        this.addLog(`${this.playerName(playerId)} захватил (${msg.q}, ${msg.r}) за ${cost} очков`);
```

(переменная `cost` после этого не используется в этом case — проверить и удалить её вычисление, если компилятор жалуется; `hex` тоже может стать неиспользуемым — удалить при необходимости.)

2. В `applyAiAction` case 'capture' удалить строку:

```ts
          this.addLog(`${name} захватил (${action.q}, ${action.r}) за ${cost} очков`);
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run test/rooms.test.ts -t "лог не содержит"` → PASS. Затем `npx vitest run` — все зелёные.

- [ ] **Step 5: Коммит**

```bash
git add server/src/rooms.ts server/test/rooms.test.ts
git commit -m "feat: из лога убраны сообщения о захватах"
```

---

### Task 5: Финальная проверка

**Files:**
- нет изменений

- [ ] **Step 1: Все тесты сервера**

Run: `npx vitest run` (в `server/`)
Expected: все зелёные (160 + 1 новый).

- [ ] **Step 2: Сборка web**

Run: `npm run build` (в `web/`)
Expected: сборка проходит.

- [ ] **Step 3: Ручная проверка**

Run: dev-серверы, затем:
1. ПКМ по своему гексу — меню с «Построить крепость» (disabled).
2. ПКМ по чужому гексу — «Война/Мир/Союз» (disabled).
3. ПКМ по нейтральному/воде — меню нет.
4. Клик в сторону / ESC — меню закрывается.
5. Игровой лог — без «захватил», битвы на месте.

- [ ] **Step 4: Коммит (если были правки)**

```bash
git add -A
git commit -m "fix: правки по итогам ручной проверки"
```
