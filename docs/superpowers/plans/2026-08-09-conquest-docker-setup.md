# Conquest: Docker-сборка (Postgres + Node TS + Vue TS) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Полноценная docker-сборка: Postgres + Node TS API + Vue 3 TS, единый URL без CORS, поле 16×12 pointy-top гексов с hover-обводкой.

**Architecture:** Три сервиса в одной docker-сети. Node сидирует карту гексов в Postgres при первом старте и отдаёт её по `GET /api/map`. Vue рендерит поле как SVG-полигоны. В dev Vite проксирует `/api` на Node (порт 5173), в prod nginx раздаёт собранный Vue и проксирует `/api` (порт 8080).

**Tech Stack:** Node 22, TypeScript, Express 4, pg, Vue 3, Vite 5, SVG, Docker Compose, Vitest.

## Global Constraints

- Карта: 16 колонок × 12 рядов, axial-координаты (q, r), q от 0 до 15, r от 0 до 11.
- Pointy-top гексы: вершина углом вверх; вершинный угол 30° (вершины на −30°, 30°, 90°, ...).
- Размер гекса (radius) = 30px.
- Террейн: только `grass`, `forest`, `mountain`, `water`, `desert` (без перевода в коде сервера).
- Единый URL: dev `http://localhost:5173`, prod `http://localhost:8080`. Прямых публикаций портов API наружу нет.
- Переменные окружения API: `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PORT` (по умолчанию 3000).
- Креды БД: user/password `conquest`, db `conquest_db`.
- Все файлы конфигурации в кодировке UTF-8. Комментарии в коде — только по делу, без лишних.
- Локальные версии: `package-lock.json` для server и web коммитятся в git.

---

### Task 1: Каркас репозитория и lock-файлы

**Files:**
- Create: `.gitignore`
- Create: `.dockerignore`
- Create: `server/package.json`
- Create: `web/package.json`
- Create: `server/package-lock.json` (генерируется)
- Create: `web/package-lock.json` (генерируется)

**Interfaces:**
- Consumes: ничего.
- Produces: корневые `.gitignore`/`.dockerignore`; package.json для server/web с полными списками зависимостей (нужны во всех docker-файлах и последующих задачах).

- [ ] **Step 1: Создать `.gitignore`**

```gitignore
node_modules/
dist/
*.log
.DS_Store
```

- [ ] **Step 2: Создать `.dockerignore`**

```
.git
docs
node_modules
dist
*.log
```

- [ ] **Step 3: Создать `server/package.json`**

```json
{
  "name": "conquest-server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "express": "^4.19.2",
    "pg": "^8.12.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^22.5.0",
    "@types/pg": "^8.11.6",
    "tsx": "^4.19.0",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 4: Создать `web/package.json`**

```json
{
  "name": "conquest-web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "vue": "^3.4.38"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.1.2",
    "typescript": "^5.5.4",
    "vite": "^5.4.2",
    "vue-tsc": "^2.0.29"
  }
}
```

- [ ] **Step 5: Сгенерировать lock-файлы**

Проверить наличие node на хосте: `node --version`. Если есть — `npm install` в `server/` и `web/`. Если нет — через docker:

```bash
docker run --rm -v "$PWD/server":/work -w /work node:22-alpine npm install
docker run --rm -v "$PWD/web":/work -w /work node:22-alpine npm install
```

Ожидаемый результат: в `server/` и `web/` появились `node_modules/` и `package-lock.json`. Проверка `ls server/package-lock.json web/package-lock.json`.

- [ ] **Step 6: Commit**

```bash
git add .gitignore .dockerignore server/package.json server/package-lock.json web/package.json web/package-lock.json
git commit -m "chore: каркас репозитория, package.json и lock-файлы"
```

---

### Task 2: Сервер — модуль карты (TDD)

**Files:**
- Create: `server/tsconfig.json`
- Create: `server/src/map.ts`
- Test: `server/test/map.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `TERRAINS: readonly Terrain[]` — `['grass', 'forest', 'mountain', 'water', 'desert']`.
  - `type Terrain` — объединение строк террейнов.
  - `interface Hex { q: number; r: number; terrain: Terrain }`.
  - `MAP_COLUMNS = 16`, `MAP_ROWS = 12`.
  - `generateMap(columns?: number, rows?: number): Hex[]` — массив гексов по рядам: r от 0 до rows−1, внутри q от 0 до columns−1, террейн случайный из `TERRAINS`.

- [ ] **Step 1: Создать `server/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"]
}
```

- [ ] **Step 2: Написать падающий тест `server/test/map.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { generateMap, MAP_COLUMNS, MAP_ROWS, TERRAINS } from '../src/map.js';

describe('generateMap', () => {
  it('возвращает ровно 16*12 = 192 гекса', () => {
    expect(generateMap()).toHaveLength(MAP_COLUMNS * MAP_ROWS);
  });

  it('возвращает уникальные координаты', () => {
    const hexes = generateMap();
    const keys = new Set(hexes.map((h) => `${h.q},${h.r}`));
    expect(keys.size).toBe(hexes.length);
  });

  it('использует только известные типы местности', () => {
    for (const hex of generateMap()) {
      expect(TERRAINS).toContain(hex.terrain);
    }
  });

  it('учитывает переданный размер', () => {
    expect(generateMap(3, 2)).toHaveLength(6);
  });
});
```

- [ ] **Step 3: Запустить тест, убедиться что падает**

Run: `cd server && npm test`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` / модуль `../src/map.js` не найден.

- [ ] **Step 4: Реализовать `server/src/map.ts`**

```ts
export const TERRAINS = ['grass', 'forest', 'mountain', 'water', 'desert'] as const;

export type Terrain = (typeof TERRAINS)[number];

export interface Hex {
  q: number;
  r: number;
  terrain: Terrain;
}

export const MAP_COLUMNS = 16;
export const MAP_ROWS = 12;

export function generateMap(columns = MAP_COLUMNS, rows = MAP_ROWS): Hex[] {
  const hexes: Hex[] = [];
  for (let r = 0; r < rows; r++) {
    for (let q = 0; q < columns; q++) {
      hexes.push({
        q,
        r,
        terrain: TERRAINS[Math.floor(Math.random() * TERRAINS.length)],
      });
    }
  }
  return hexes;
}
```

- [ ] **Step 5: Запустить тесты, убедиться что проходят**

Run: `cd server && npm test`
Expected: PASS, 4 теста зелёные.

- [ ] **Step 6: Commit**

```bash
git add server/tsconfig.json server/src/map.ts server/test/map.test.ts
git commit -m "feat: генерация карты гексов с типами местности"
```

---

### Task 3: Сервер — слой БД и HTTP API

**Files:**
- Create: `server/src/db.ts`
- Create: `server/src/index.ts`

**Interfaces:**
- Consumes: из map.ts — `Hex`, `generateMap`, `MAP_COLUMNS`, `MAP_ROWS`.
- Produces:
  - `initDb(): Promise<void>` — создаёт таблицу `hexes(q int NOT NULL, r int NOT NULL, terrain text NOT NULL, PRIMARY KEY (q, r))` если её нет; ретраит подключение до 15 раз с паузой 2 с.
  - `countHexes(): Promise<number>`.
  - `insertHexes(hexes: { q: number; r: number; terrain: string }[]): Promise<void>`.
  - `fetchHexes(): Promise<{ q: number; r: number; terrain: string }[]>` — сортировка по r, q.
  - `closeDb(): Promise<void>`.
  - HTTP: `GET /health` → `{ status: "ok" }`; `GET /api/map` → `{ hexes: [...] }`; при ошибке БД → 500 `{ error: "Failed to fetch map" }`.
  - Старт: подключение с ретраями → сид если пусто → `app.listen(PORT)`.

- [ ] **Step 1: Создать `server/src/db.ts`**

```ts
import pg from 'pg';

const pool = new pg.Pool({
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? 'conquest',
  password: process.env.PGPASSWORD ?? 'conquest',
  database: process.env.PGDATABASE ?? 'conquest_db',
});

export async function initDb(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hexes (
      q integer NOT NULL,
      r integer NOT NULL,
      terrain text NOT NULL,
      PRIMARY KEY (q, r)
    )
  `);
}

export async function countHexes(): Promise<number> {
  const result = await pool.query<{ count: string }>('SELECT COUNT(*) AS count FROM hexes');
  return Number(result.rows[0].count);
}

export async function insertHexes(
  hexes: { q: number; r: number; terrain: string }[],
): Promise<void> {
  for (const hex of hexes) {
    await pool.query('INSERT INTO hexes (q, r, terrain) VALUES ($1, $2, $3)', [
      hex.q,
      hex.r,
      hex.terrain,
    ]);
  }
}

export async function fetchHexes(): Promise<{ q: number; r: number; terrain: string }[]> {
  const result = await pool.query('SELECT q, r, terrain FROM hexes ORDER BY r, q');
  return result.rows;
}

export async function closeDb(): Promise<void> {
  await pool.end();
}
```

- [ ] **Step 2: Создать `server/src/index.ts`**

```ts
import express from 'express';
import { closeDb, countHexes, fetchHexes, initDb, insertHexes } from './db.js';
import { generateMap, MAP_COLUMNS, MAP_ROWS } from './map.js';

const PORT = Number(process.env.PORT ?? 3000);
const MAX_DB_RETRIES = 15;
const DB_RETRY_DELAY_MS = 2000;

async function connectWithRetry(): Promise<void> {
  for (let attempt = 1; attempt <= MAX_DB_RETRIES; attempt++) {
    try {
      await initDb();
      return;
    } catch (err) {
      if (attempt === MAX_DB_RETRIES) throw err;
      console.error(
        `DB not ready (attempt ${attempt}/${MAX_DB_RETRIES}), retrying in ${DB_RETRY_DELAY_MS}ms...`,
      );
      await new Promise((resolve) => setTimeout(resolve, DB_RETRY_DELAY_MS));
    }
  }
}

async function seedIfEmpty(): Promise<void> {
  const count = await countHexes();
  if (count === 0) {
    const hexes = generateMap(MAP_COLUMNS, MAP_ROWS);
    await insertHexes(hexes);
    console.log(`Seeded map with ${hexes.length} hexes`);
  } else {
    console.log(`Map already seeded (${count} hexes)`);
  }
}

async function main(): Promise<void> {
  const app = express();

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/map', async (_req, res) => {
    try {
      const hexes = await fetchHexes();
      res.json({ hexes });
    } catch (err) {
      console.error('Failed to fetch map:', err);
      res.status(500).json({ error: 'Failed to fetch map' });
    }
  });

  await connectWithRetry();
  await seedIfEmpty();
  app.listen(PORT, () => console.log(`API listening on port ${PORT}`));
}

main().catch(async (err) => {
  console.error('API failed to start:', err);
  await closeDb();
  process.exit(1);
});
```

- [ ] **Step 3: Проверить типы**

Run: `cd server && npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 4: Commit**

```bash
git add server/src/db.ts server/src/index.ts
git commit -m "feat: слой БД (hexes) и HTTP API /api/map"
```

---

### Task 4: Dockerfile API (multi-stage)

**Files:**
- Create: `docker/app/Dockerfile`

**Interfaces:**
- Consumes: `server/` (package.json, lock, src).
- Produces: цели `dev` (tsx watch, используется в dev-compose) и `prod` (tsc-сборка, node dist).

- [ ] **Step 1: Создать `docker/app/Dockerfile`**

```dockerfile
FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY server/package.json server/package-lock.json ./
RUN npm install

FROM deps AS dev
COPY server/ ./
EXPOSE 3000
CMD ["npm", "run", "dev"]

FROM deps AS build
COPY server/ ./
RUN npm run build

FROM base AS prod
ENV NODE_ENV=production
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Проверить сборку dev-цели**

Run: `docker build -f docker/app/Dockerfile --target dev -t conquest-api-dev .`
Expected: образ собирается без ошибок.

- [ ] **Step 3: Проверить сборку prod-цели**

Run: `docker build -f docker/app/Dockerfile --target prod -t conquest-api-prod .`
Expected: образ собирается без ошибок.

- [ ] **Step 4: Commit**

```bash
git add docker/app/Dockerfile
git commit -m "build: multi-stage Dockerfile для API (dev/prod)"
```

---

### Task 5: Web — скаффолд Vue 3 + TS

**Files:**
- Create: `web/tsconfig.json`
- Create: `web/tsconfig.app.json`
- Create: `web/tsconfig.node.json`
- Create: `web/vite.config.ts`
- Create: `web/index.html`
- Create: `web/src/env.d.ts`
- Create: `web/src/main.ts`
- Create: `web/src/style.css`
- Create: `web/src/types.ts`

**Interfaces:**
- Consumes: `web/package.json` (зависимости уже установлены в Task 1).
- Produces:
  - `web/src/types.ts` — `type Terrain = 'grass' | 'forest' | 'mountain' | 'water' | 'desert'`; `interface Hex { q: number; r: number; terrain: Terrain }`; `TERRAIN_COLORS: Record<Terrain, string>` (grass `#7cb342`, forest `#2e7d32`, mountain `#9e9e9e`, water `#42a5f5`, desert `#ffcc80`); `TERRAIN_LABELS: Record<Terrain, string>` (grass «Равнина», forest «Лес», mountain «Горы», water «Вода», desert «Пустыня»).
  - Vite dev server на 5173 с прокси `/api → http://api:3000`.

- [ ] **Step 1: Создать `web/tsconfig.json`**

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

- [ ] **Step 2: Создать `web/tsconfig.app.json`**

```json
{
  "compilerOptions": {
    "composite": true,
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
    "target": "ES2020",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "preserve",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src/**/*.ts", "src/**/*.d.ts", "src/**/*.tsx", "src/**/*.vue"]
}
```

- [ ] **Step 3: Создать `web/tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "composite": true,
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.node.tsbuildinfo",
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 4: Создать `web/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://api:3000',
        changeOrigin: true,
      },
    },
  },
});
```

- [ ] **Step 5: Создать `web/index.html`**

```html
<!DOCTYPE html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Conquest</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 6: Создать `web/src/env.d.ts`**

```ts
/// <reference types="vite/client" />
```

- [ ] **Step 7: Создать `web/src/main.ts`**

```ts
import { createApp } from 'vue';
import App from './App.vue';
import './style.css';

createApp(App).mount('#app');
```

- [ ] **Step 8: Создать `web/src/style.css`**

```css
:root {
  color-scheme: dark;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: system-ui, -apple-system, sans-serif;
  background: #1e1e24;
  color: #eee;
}
```

- [ ] **Step 9: Создать `web/src/types.ts`**

```ts
export type Terrain = 'grass' | 'forest' | 'mountain' | 'water' | 'desert';

export interface Hex {
  q: number;
  r: number;
  terrain: Terrain;
}

export const TERRAIN_COLORS: Record<Terrain, string> = {
  grass: '#7cb342',
  forest: '#2e7d32',
  mountain: '#9e9e9e',
  water: '#42a5f5',
  desert: '#ffcc80',
};

export const TERRAIN_LABELS: Record<Terrain, string> = {
  grass: 'Равнина',
  forest: 'Лес',
  mountain: 'Горы',
  water: 'Вода',
  desert: 'Пустыня',
};
```

- [ ] **Step 10: Проверить сборку**

Run: `cd web && npm run build`
Expected: `vue-tsc` без ошибок, `vite build` завершается успешно (App.vue ещё нет — на этом шаге должен быть создан заглушечный `App.vue` из следующей задачи, либо сначала выполнить Task 6. Если `App.vue` отсутствует — создать минимальный `web/src/App.vue` с пустым `<template><main /></template>`).

- [ ] **Step 11: Commit**

```bash
git add web/tsconfig.json web/tsconfig.app.json web/tsconfig.node.json web/vite.config.ts web/index.html web/src/env.d.ts web/src/main.ts web/src/style.css web/src/types.ts web/src/App.vue
git commit -m "feat: скаффолд Vue 3 + TS (Vite, прокси /api)"
```

---

### Task 6: Web — SVG-поле гексов с hover

**Files:**
- Create: `web/src/App.vue`
- Create: `web/src/components/HexMap.vue`
- Create: `web/src/components/HexCoordinates.vue`

**Interfaces:**
- Consumes: из types.ts — `Hex`, `TERRAIN_COLORS`, `TERRAIN_LABELS`.
- Produces:
  - `App.vue` — грузит `/api/map` при монтировании; состояния: `hexes: Ref<Hex[]>`, `loading`, `error`; рендерит заголовок «Conquest», сообщение об ошибке или `HexMap`.
  - `HexMap.vue` — props `{ hexes: Hex[] }`; событие наведения на полигон обновляет внутренний `hovered: Ref<Hex | null>`; рисует `<svg>` с `<polygon>` на каждый гекс; показывает `HexCoordinates` при наведении.

- [ ] **Step 1: Создать `web/src/App.vue`**

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import HexMap from './components/HexMap.vue';
import type { Hex } from './types';

const hexes = ref<Hex[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    const res = await fetch('/api/map');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    hexes.value = data.hexes;
  } catch (err) {
    error.value = `Не удалось загрузить карту: ${
      err instanceof Error ? err.message : String(err)
    }`;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <main class="app">
    <h1>Conquest</h1>
    <p v-if="loading" class="status">Загрузка карты…</p>
    <p v-else-if="error" class="status error">{{ error }}</p>
    <HexMap v-else :hexes="hexes" />
  </main>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px;
}

.status {
  color: #aaa;
}

.error {
  color: #ff6b6b;
}
</style>
```

- [ ] **Step 2: Создать `web/src/components/HexMap.vue`**

```vue
<script setup lang="ts">
import { computed, ref } from 'vue';
import HexCoordinates from './HexCoordinates.vue';
import { TERRAIN_COLORS, type Hex } from '../types';

const props = defineProps<{ hexes: Hex[] }>();

const HEX_SIZE = 30;
const SQRT3 = Math.sqrt(3);
const PADDING = 20;

const hovered = ref<Hex | null>(null);

function hexCenter(q: number, r: number): { x: number; y: number } {
  return {
    x: HEX_SIZE * SQRT3 * (q + r / 2),
    y: HEX_SIZE * (3 / 2) * r,
  };
}

function hexPoints(q: number, r: number): string {
  const { x, y } = hexCenter(q, r);
  const points: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    points.push(`${(x + HEX_SIZE * Math.cos(angle)).toFixed(2)},${(y + HEX_SIZE * Math.sin(angle)).toFixed(2)}`);
  }
  return points.join(' ');
}

const viewBox = computed(() => {
  const xs = props.hexes.map((h) => hexCenter(h.q, h.r).x);
  const ys = props.hexes.map((h) => hexCenter(h.q, h.r).y);
  const minX = Math.min(...xs) - HEX_SIZE - PADDING;
  const maxX = Math.max(...xs) + HEX_SIZE + PADDING;
  const minY = Math.min(...ys) - HEX_SIZE - PADDING;
  const maxY = Math.max(...ys) + HEX_SIZE + PADDING;
  return `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
});
</script>

<template>
  <div class="hex-map">
    <svg :viewBox="viewBox" class="hex-map__svg">
      <polygon
        v-for="hex in props.hexes"
        :key="`${hex.q},${hex.r}`"
        :points="hexPoints(hex.q, hex.r)"
        :fill="TERRAIN_COLORS[hex.terrain]"
        class="hex"
        @mousemove="hovered = hex"
        @mouseleave="hovered = null"
      />
    </svg>
    <HexCoordinates v-if="hovered" :hex="hovered" />
  </div>
</template>

<style scoped>
.hex-map {
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

.hex:hover {
  stroke: #ffd54f;
  stroke-width: 3.5;
  filter: brightness(1.18);
}
</style>
```

- [ ] **Step 3: Создать `web/src/components/HexCoordinates.vue`**

```vue
<script setup lang="ts">
import { TERRAIN_LABELS, type Hex } from '../types';

defineProps<{ hex: Hex }>();
</script>

<template>
  <div class="hex-coordinates">
    q: {{ hex.q }}, r: {{ hex.r }} — {{ TERRAIN_LABELS[hex.terrain] }}
  </div>
</template>

<style scoped>
.hex-coordinates {
  position: fixed;
  bottom: 16px;
  left: 16px;
  z-index: 10;
  padding: 8px 12px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.75);
  color: #fff;
  font-family: monospace;
  font-size: 14px;
}
</style>
```

- [ ] **Step 4: Проверить сборку**

Run: `cd web && npm run build`
Expected: `vue-tsc` без ошибок, `vite build` завершается успешно.

- [ ] **Step 5: Commit**

```bash
git add web/src/App.vue web/src/components/HexMap.vue web/src/components/HexCoordinates.vue
git commit -m "feat: SVG-поле pointy-top гексов с hover-обводкой"
```

---

### Task 7: Dev-профиль docker-compose

**Files:**
- Create: `docker-compose.yml`

**Interfaces:**
- Consumes: образы из Task 4 (цель dev), web dev-режим (Vite + прокси из Task 5).
- Produces: три сервиса `postgres`, `api`, `web`; volume `pgdata`; сеть `conquest_network`; единый URL `http://localhost:5173`.

- [ ] **Step 1: Создать `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: conquest
      POSTGRES_PASSWORD: conquest
      POSTGRES_DB: conquest_db
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U conquest -d conquest_db"]
      interval: 3s
      timeout: 3s
      retries: 20
    networks:
      - conquest_network

  api:
    build:
      context: .
      dockerfile: docker/app/Dockerfile
      target: dev
    environment:
      PGHOST: postgres
      PGPORT: 5432
      PGUSER: conquest
      PGPASSWORD: conquest
      PGDATABASE: conquest_db
    volumes:
      - ./server:/app
      - /app/node_modules
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - conquest_network

  web:
    build:
      context: .
      dockerfile: docker/web/Dockerfile
      target: dev
    ports:
      - "5173:5173"
    volumes:
      - ./web:/app
      - /app/node_modules
    depends_on:
      - api
    networks:
      - conquest_network

volumes:
  pgdata:

networks:
  conquest_network:
    driver: bridge
```

- [ ] **Step 2: Создать dev-цель в `docker/web/Dockerfile`**

```dockerfile
FROM node:22-alpine AS dev
WORKDIR /app
COPY web/package.json web/package-lock.json ./
RUN npm install
COPY web/ ./
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
```

- [ ] **Step 3: Проверить сборку web dev-цели**

Run: `docker build -f docker/web/Dockerfile --target dev -t conquest-web-dev .`
Expected: образ собирается без ошибок.

- [ ] **Step 4: Проверить полный стек**

Run: `docker compose up -d --build`
Expected: контейнеры стартуют; в логах `api` — `Seeded map with 192 hexes`. Затем `sleep 5 && curl -s localhost:5173/api/map | head -c 300` — JSON с `hexes`. `curl -s localhost:5173/` содержит `id="app"`.

- [ ] **Step 5: Проверить сид идемпотентен**

Run: `docker compose restart api && sleep 5 && docker compose logs api --tail 20`
Expected: в логах `Map already seeded (192 hexes)`.

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml docker/web/Dockerfile
git commit -m "build: dev-профиль docker-compose (postgres + api + web)"
```

---

### Task 8: Prod-профиль (nginx)

**Files:**
- Create: `docker/web/nginx.conf`
- Create: `docker-compose.prod.yml`

**Interfaces:**
- Consumes: API prod-цель (Task 4), web prod-сборка (`npm run build` в Docker).
- Produces: единый URL `http://localhost:8080`; nginx раздаёт статику и проксирует `/api/ → http://api:3000`.

- [ ] **Step 1: Добавить prod-цель в `docker/web/Dockerfile`**

Дополнить существующий файл (оставив dev-цель сверху):

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM nginx:1.27-alpine AS prod
COPY docker/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
```

- [ ] **Step 2: Создать `docker/web/nginx.conf`**

```nginx
server {
    listen 80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    location /api/ {
        proxy_pass http://api:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

- [ ] **Step 3: Создать `docker-compose.prod.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: conquest
      POSTGRES_PASSWORD: conquest
      POSTGRES_DB: conquest_db
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U conquest -d conquest_db"]
      interval: 3s
      timeout: 3s
      retries: 20
    networks:
      - conquest_network

  api:
    build:
      context: .
      dockerfile: docker/app/Dockerfile
      target: prod
    environment:
      PGHOST: postgres
      PGPORT: 5432
      PGUSER: conquest
      PGPASSWORD: conquest
      PGDATABASE: conquest_db
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - conquest_network

  web:
    build:
      context: .
      dockerfile: docker/web/Dockerfile
      target: prod
    ports:
      - "8080:80"
    depends_on:
      - api
    networks:
      - conquest_network

volumes:
  pgdata:

networks:
  conquest_network:
    driver: bridge
```

- [ ] **Step 4: Проверить prod-стек**

Run: `docker compose -f docker-compose.prod.yml up -d --build`
Expected: сборка и старт без ошибок. Затем `sleep 5` и:
- `curl -s localhost:8080/api/map | head -c 300` — JSON с hexes;
- `curl -s localhost:8080/ | head -c 200` — HTML с `id="app"` (обрати внимание: prod-том же volume `pgdata` — поле уже сидировано dev-профилем, в логах api `Map already seeded`).

- [ ] **Step 5: Commit**

```bash
git add docker/web/nginx.conf docker-compose.prod.yml docker/web/Dockerfile
git commit -m "build: prod-профиль docker-compose (nginx + собранный Vue)"
```

---

### Task 9: Итоговая приёмка

**Files:** нет (только проверки).

- [ ] **Step 1: Проверить api/map целиком**

Run: `curl -s localhost:5173/api/map | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d['hexes']), d['hexes'][0], d['hexes'][-1])"`
Expected: `192 {'q': 0, 'r': 0, 'terrain': '...'} {'q': 15, 'r': 11, 'terrain': '...'}`.

- [ ] **Step 2: Проверить данные в Postgres напрямую**

Run:
```bash
docker compose exec postgres psql -U conquest -d conquest_db -c "SELECT count(*) FROM hexes;"
docker compose exec postgres psql -U conquest -d conquest_db -c "SELECT DISTINCT terrain FROM hexes;"
```
Expected: `192`; все 5 типов местности.

- [ ] **Step 3: Проверить hover-рендер (SVG присутствует)**

Run: `curl -s localhost:5173/src/components/HexMap.vue | grep -c "polygon"`
Expected: `1` и более (исходник модуля с полигоном отдаётся Vite).

- [ ] **Step 4: Остановить dev-стек**

Run: `docker compose down`
Expected: контейнеры остановлены, volume `pgdata` сохранён.

- [ ] **Step 5: Финальный коммит (если есть незакоммиченные изменения)**

Run: `git status --short` и `git add -A && git commit -m "chore: финальные правки"` при необходимости.

## Self-Review

**Покрытие спеки:**
- Три сервиса + общая сеть → Task 7, 8. ✓
- Единый URL dev/prod → Task 7 (5173), Task 8 (8080). ✓
- Таблица hexes, сид при пустой таблице, без дублей → Task 3, проверка в Task 7 Step 5. ✓
- `GET /api/map` → Task 3. ✓
- Ретрай подключения к БД → Task 3 (`connectWithRetry`). ✓
- 16×12 pointy-top, 30px, hover-обводка, координаты в углу, ошибка загрузки → Task 2, Task 6. ✓
- Террейн-цвета → Task 5 (types.ts), Task 6 (рендер). ✓
- Критерии приёмки → Task 9. ✓
