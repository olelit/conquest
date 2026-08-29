# Логин по паролю, фидбек, войны ИИ, карты в БД, дипломатия — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать 8 изменений из спеки `docs/superpowers/specs/2026-08-30-login-feedback-diplomacy-maps-design.md`: вход по логину/паролю вместо Google, доделать фидбек, починить войны ИИ, карта обучения 9×7, панель принятия союзов, доход по типу гекса, карты в БД + 3 новые карты.

**Architecture:** Сервер — Express/WS/TypeORM. Карты переезжают в таблицу `maps` с in-memory кэшем `MapCatalog` (тесты работают на `DEFAULT_MAPS` без БД). Вход — HMAC-токен сессии по образцу админки, регистрация/логин — публичные HTTP-роуты, WS `auth` проверяет токен. Фидбек — существующий код подключается в index.ts + админ-роуты. ИИ-дипломатия — «контактная зона» вместо строгой границы. Клиент — Vue 3, i18n en/ru.

**Tech Stack:** Node.js 22, Express, TypeORM (Postgres), ws, Vue 3, vitest, tsc/vue-tsc.

## Global Constraints

- Никаких новых npm-зависимостей.
- Доход по террейну: grass 2, desert 1, forest 3, water 1, mountain 4, mine 6 (env `CONQUEST_INCOME_*`).
- Логин: 3–32 символа, только `[a-z0-9_-]`, lowercase; пароль 6–128 символов.
- Токен сессии: `base64url(JSON{u,exp}).base64url(HMAC-SHA256(secret, body))`, TTL 24 ч.
- Новая таблица `maps` сидится из `DEFAULT_MAPS` (8 карт), при старте кэш заменяется из БД.
- Новые карты только сухопутные (без воды): continents, peninsula, ridge.
- Кнопки/панели на клиенте: i18n ключи en/ru обязательны.
- Тесты сервера: `npm test` (vitest run); сборка сервера: `npm run build`; сборка web: `npm run build` в `web/`.

---

### Task 1: Карты в БД — map.ts, MapEntity, кэш, проводка

**Files:**
- Rewrite: `server/src/map.ts`
- Modify: `server/src/db.ts`, `server/src/index.ts`, `server/src/rooms.ts`, `server/src/admin.ts`
- Rewrite: `server/test/map.test.ts`
- Modify: `server/test/rules.test.ts` (строки с `MAP_PRESETS`)

**Interfaces:**
- Produces: `MapShape`, `Blob`, `RidgeLine`, `MapParams`, `MapDefinition`, `MapType = string`, `DEFAULT_MAPS: MapDefinition[]` (8 карт), `generateMap(def: MapDefinition): Hex[]`, `setMapCatalog(defs)`, `getMap(key: string): MapDefinition | null`, `listMaps(): MapDefinition[]`, `MAP_COLUMNS`/`MAP_ROWS` (из normal), `MapEntity`, `MapsRepository { list(), ensureSeeded(defs) }`, `mapEntityToDefinition(e)`, `GET /api/admin/maps`.
- Consumes: `config` из `./config.js`; `MapType`/`MapDefinition` из `./map.js` (rooms.ts, db.ts).

- [ ] **Step 1: Переписать `server/src/map.ts` полностью**

```ts
import { config } from './config.js';

export const TERRAINS = ['grass', 'forest', 'mountain', 'water', 'desert', 'mine'] as const;
export type Terrain = (typeof TERRAINS)[number];

export type MapType = string;

export type MapShape = 'rect' | 'ellipse' | 'circle' | 'blobs' | 'ridge';

export interface Blob {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

export interface RidgeLine {
  a: { q: number; r: number };
  b: { q: number; r: number };
  width: number;
}

export interface MapParams {
  rx?: number;
  ry?: number;
  radius?: number;
  blobs?: Blob[];
  ridge?: RidgeLine;
}

export interface MapDefinition {
  key: string;
  name: string;
  shape: MapShape;
  columns: number;
  rows: number;
  minPlayers: number;
  maxPlayers: number;
  recommendedAi: number;
  qOffset: number;
  params: MapParams;
}

export const DEFAULT_MAPS: MapDefinition[] = [
  { key: 'normal', name: 'Normal', shape: 'rect', columns: 16, rows: 12, minPlayers: 2, maxPlayers: 5, recommendedAi: 1, qOffset: 0, params: {} },
  { key: 'long', name: 'Long', shape: 'rect', columns: 24, rows: 9, minPlayers: 2, maxPlayers: 4, recommendedAi: 1, qOffset: 0, params: {} },
  { key: 'island', name: 'Island', shape: 'ellipse', columns: 15, rows: 13, minPlayers: 2, maxPlayers: 4, recommendedAi: 1, qOffset: 0, params: { rx: 7, ry: 6 } },
  { key: 'round', name: 'Round', shape: 'circle', columns: 19, rows: 19, minPlayers: 2, maxPlayers: 6, recommendedAi: 1, qOffset: 0, params: { radius: 9 } },
  {
    key: 'continents',
    name: 'Continents',
    shape: 'blobs',
    columns: 22,
    rows: 14,
    minPlayers: 2,
    maxPlayers: 5,
    recommendedAi: 2,
    qOffset: 0,
    params: {
      blobs: [
        { x: 7, y: 7, rx: 5.5, ry: 6 },
        { x: 10, y: 3.5, rx: 2.8, ry: 2.5 },
        { x: 16.5, y: 8.5, rx: 4.5, ry: 4 },
        { x: 13, y: 7.5, rx: 2.2, ry: 1.2 },
      ],
    },
  },
  {
    key: 'peninsula',
    name: 'Peninsula',
    shape: 'blobs',
    columns: 18,
    rows: 14,
    minPlayers: 2,
    maxPlayers: 4,
    recommendedAi: 1,
    qOffset: 0,
    params: {
      blobs: [
        { x: 8, y: 4, rx: 7, ry: 4.5 },
        { x: 9.5, y: 8, rx: 2.5, ry: 1.5 },
        { x: 10, y: 10.5, rx: 1.6, ry: 3 },
      ],
    },
  },
  {
    key: 'ridge',
    name: 'Ridge',
    shape: 'ridge',
    columns: 18,
    rows: 12,
    minPlayers: 2,
    maxPlayers: 4,
    recommendedAi: 1,
    qOffset: 0,
    params: { ridge: { a: { q: 9, r: 0.5 }, b: { q: 9, r: 11.5 }, width: 1.4 } },
  },
  { key: 'tutorial', name: 'Tutorial', shape: 'rect', columns: 9, rows: 7, minPlayers: 2, maxPlayers: 2, recommendedAi: 1, qOffset: 0, params: {} },
];

export const MAP_COLUMNS = DEFAULT_MAPS[0].columns;
export const MAP_ROWS = DEFAULT_MAPS[0].rows;

export interface Hex {
  q: number;
  r: number;
  terrain: Terrain;
}

let catalog = new Map<string, MapDefinition>(DEFAULT_MAPS.map((m) => [m.key, m]));

export function setMapCatalog(defs: MapDefinition[]): void {
  catalog = new Map(defs.map((m) => [m.key, m]));
}

export function getMap(key: string): MapDefinition | null {
  return catalog.get(key) ?? null;
}

export function listMaps(): MapDefinition[] {
  return [...catalog.values()];
}

export function generateMap(def: MapDefinition): Hex[] {
  const hexes: Hex[] = [];
  const qMin = def.qOffset;
  for (let r = 0; r < def.rows; r++) {
    for (let q = qMin; q < qMin + def.columns; q++) {
      if (def.shape === 'circle' && !isInCircle(def, q, r)) continue;
      hexes.push({ q, r, terrain: terrainAt(def, q, r) });
    }
  }
  return hexes;
}

function isInCircle(def: MapDefinition, q: number, r: number): boolean {
  const radius = def.params.radius ?? 0;
  const cq = (def.columns - 1) / 2;
  const cr = (def.rows - 1) / 2;
  return hexDistance(q, r, cq, cr) <= radius;
}

function isLand(def: MapDefinition, q: number, r: number): boolean {
  switch (def.shape) {
    case 'rect':
    case 'ridge':
      return true;
    case 'ellipse':
      return inEllipse(q, r, (def.columns - 1) / 2, (def.rows - 1) / 2, def.params.rx ?? 0, def.params.ry ?? 0);
    case 'circle':
      return true;
    case 'blobs':
      return (def.params.blobs ?? []).some((b) => inEllipse(q, r, b.x, b.y, b.rx, b.ry));
  }
}

function inEllipse(q: number, r: number, cx: number, cy: number, rx: number, ry: number): boolean {
  const dq = q - cx;
  const dr = r - cy;
  return (dq * dq) / (rx * rx) + (dr * dr) / (ry * ry) <= 1;
}

function hexDistance(aq: number, ar: number, bq: number, br: number): number {
  const dq = aq - bq;
  const dr = ar - br;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

function terrainAt(def: MapDefinition, q: number, r: number): Terrain {
  if (!isLand(def, q, r)) return 'water';
  if (def.shape === 'ridge' && isNearRidge(def, q, r)) {
    return Math.random() < config.mineChance ? 'mine' : 'mountain';
  }
  return randomTerrain();
}

function isNearRidge(def: MapDefinition, q: number, r: number): boolean {
  const ridge = def.params.ridge;
  if (!ridge) return false;
  return distToSegment(q, r, ridge.a, ridge.b) <= ridge.width;
}

function distToSegment(q: number, r: number, a: { q: number; r: number }, b: { q: number; r: number }): number {
  const dx = b.q - a.q;
  const dy = b.r - a.r;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(q - a.q, r - a.r);
  let t = ((q - a.q) * dx + (r - a.r) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(q - (a.q + t * dx), r - (a.r + t * dy));
}

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

- [ ] **Step 2: Убедиться, что сборка сервера падает**

Run: `npm run build`
Expected: FAIL — `rooms.ts`, `db.ts`, тесты используют `MAP_PRESETS`/`generateMap(type)`, которых больше нет.

- [ ] **Step 3: Добавить `MapEntity` и `MapsRepository` в `server/src/db.ts`**

Импорты в шапку `db.ts`:

```ts
import { DEFAULT_MAPS, setMapCatalog, type MapDefinition, type MapParams, type MapShape } from './map.js';
```

После блока `UsersRepository` (перед `export const dataSource`) добавить:

```ts
@Entity('maps')
export class MapEntity {
  @PrimaryGeneratedColumn({ name: 'id', type: 'int' })
  id!: number;

  @Column({ name: 'key', type: 'text', unique: true })
  key!: string;

  @Column({ name: 'name', type: 'text' })
  name!: string;

  @Column({ name: 'shape', type: 'text' })
  shape!: string;

  @Column({ name: 'columns', type: 'int' })
  columns!: number;

  @Column({ name: 'rows', type: 'int' })
  rows!: number;

  @Column({ name: 'min_players', type: 'int' })
  minPlayers!: number;

  @Column({ name: 'max_players', type: 'int' })
  maxPlayers!: number;

  @Column({ name: 'recommended_ai', type: 'int' })
  recommendedAi!: number;

  @Column({ name: 'q_offset', type: 'int', default: 0 })
  qOffset!: number;

  @Column({ name: 'params', type: 'jsonb', default: () => "'{}'::jsonb" })
  params!: MapParams;

  @Column({ name: 'enabled', type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;
}

export class MapsRepository {
  constructor(private readonly dataSource: DataSource) {}

  private repo(): Repository<MapEntity> {
    return this.dataSource.getRepository(MapEntity);
  }

  async list(): Promise<MapEntity[]> {
    return this.repo().find({ order: { id: 'ASC' } });
  }

  async ensureSeeded(defs: MapDefinition[]): Promise<void> {
    for (const def of defs) {
      await this.repo()
        .createQueryBuilder()
        .insert()
        .into(MapEntity)
        .values({
          key: def.key,
          name: def.name,
          shape: def.shape,
          columns: def.columns,
          rows: def.rows,
          minPlayers: def.minPlayers,
          maxPlayers: def.maxPlayers,
          recommendedAi: def.recommendedAi,
          qOffset: def.qOffset,
          params: def.params,
        })
        .orIgnore()
        .execute();
    }
  }
}

export function mapEntityToDefinition(e: MapEntity): MapDefinition {
  return {
    key: e.key,
    name: e.name,
    shape: e.shape as MapShape,
    columns: e.columns,
    rows: e.rows,
    minPlayers: e.minPlayers,
    maxPlayers: e.maxPlayers,
    recommendedAi: e.recommendedAi,
    qOffset: e.qOffset,
    params: e.params ?? {},
  };
}
```

В `dataSource` список сущностей: `entities: [PlayerEntity, GameDumpEntity, AdminCredentialsEntity, FeedbackEntity, UserEntity, MapEntity]`.

После `export const usersRepository = ...` добавить:

```ts
export const mapsRepository = new MapsRepository(dataSource);
```

В `initDb()` (после `ensureSeeded` админа) добавить:

```ts
  try {
    await mapsRepository.ensureSeeded(DEFAULT_MAPS);
    const maps = (await mapsRepository.list()).filter((m) => m.enabled).map(mapEntityToDefinition);
    setMapCatalog(maps);
  } catch (err) {
    console.error('maps seed failed:', err);
  }
```

- [ ] **Step 4: Обновить `server/src/rooms.ts` на `getMap`/`generateMap(def)`**

Строка 1: заменить импорт:

```ts
import { getMap, generateMap, type MapType } from './map.js';
```

Метод `start()` (строки 231-234): заменить

```ts
    const players = this.buildPlayers();
    const hexes = this.buildHexes();
    const preset = MAP_PRESETS[this.mapType];
    this.state = { players, hexes, columns: preset.columns, rows: preset.rows, winnerId: null, qOffset: preset.qOffset };
```

на

```ts
    const players = this.buildPlayers();
    const def = getMap(this.mapType);
    if (!def) return { ok: false, error: 'Unknown map type' };
    const hexes = this.buildHexes(def);
    this.state = { players, hexes, columns: def.columns, rows: def.rows, winnerId: null, qOffset: def.qOffset };
```

Метод `buildHexes()` (строки 269-282): заменить сигнатуру и тело:

```ts
  private buildHexes(def: MapDefinition): HexState[] {
    return generateMap(def).map((h) => ({
      q: h.q,
      r: h.r,
      terrain: h.terrain,
      ownerId: null,
      attackerId: null,
      defenderId: null,
      attackInvestment: 0,
      defenseInvestment: 0,
      battleProgress: 0,
      fortress: false,
    }));
  }
```

(добавить `type MapDefinition` в импорт `./map.js`).

Метод `restart()` (строки 288-290): заменить

```ts
    const players = this.buildPlayers();
    const preset = MAP_PRESETS[this.mapType];
    this.state = { players, hexes: this.buildHexes(), columns: preset.columns, rows: preset.rows, winnerId: null, qOffset: preset.qOffset };
```

на

```ts
    const players = this.buildPlayers();
    const def = getMap(this.mapType);
    if (!def) return { ok: false, error: 'Unknown map type' };
    this.state = { players, hexes: this.buildHexes(def), columns: def.columns, rows: def.rows, winnerId: null, qOffset: def.qOffset };
```

`createRoom` (строки 936-940): заменить

```ts
    const preset = MAP_PRESETS[mapType];
    if (!preset) return { ok: false, error: 'Unknown map type' };
    if (!Number.isInteger(maxPlayers) || maxPlayers < preset.minPlayers || maxPlayers > preset.maxPlayers) {
      return { ok: false, error: `Players must be between ${preset.minPlayers} and ${preset.maxPlayers}` };
    }
```

на

```ts
    const def = getMap(mapType);
    if (!def) return { ok: false, error: 'Unknown map type' };
    if (!Number.isInteger(maxPlayers) || maxPlayers < def.minPlayers || maxPlayers > def.maxPlayers) {
      return { ok: false, error: `Players must be between ${def.minPlayers} and ${def.maxPlayers}` };
    }
```

`createSolo` (строки 951-955): заменить

```ts
    const preset = MAP_PRESETS[mapType];
    if (!preset) return { ok: false, error: 'Unknown map type' };
    if (!Number.isInteger(aiCount) || aiCount < 1 || aiCount > preset.maxPlayers - 1) {
      return { ok: false, error: `Computer count must be between 1 and ${preset.maxPlayers - 1}` };
    }
```

на

```ts
    const def = getMap(mapType);
    if (!def) return { ok: false, error: 'Unknown map type' };
    if (!Number.isInteger(aiCount) || aiCount < 1 || aiCount > def.maxPlayers - 1) {
      return { ok: false, error: `Computer count must be between 1 and ${def.maxPlayers - 1}` };
    }
```

и строку 959 (`createSolo` создаёт Room) — заменить `preset.maxPlayers` на `def.maxPlayers`:

```ts
    const room = new Room(this.nextRoomId++, randomCountryName(), mapType, def.maxPlayers, true, aiCount, undefined, training ? 'easy' : difficulty, false, training);
```

- [ ] **Step 5: Добавить `GET /api/admin/maps` в `server/src/admin.ts`**

Импорт: `import { listMaps } from './map.js';`

В `protectedRouter` (рядом с `GET /status`) добавить:

```ts
  protectedRouter.get('/maps', (_req, res) => {
    res.json({ ok: true, maps: listMaps() });
  });
```

- [ ] **Step 6: Переписать `server/test/map.test.ts` полностью**

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_MAPS, generateMap, MAP_COLUMNS, MAP_ROWS, TERRAINS } from '../src/map.js';

function def(key: string) {
  const d = DEFAULT_MAPS.find((m) => m.key === key);
  if (!d) throw new Error(`no map ${key}`);
  return d;
}

function landHexes(key: string) {
  return generateMap(def(key)).filter((h) => h.terrain !== 'water');
}

function connectedLand(key: string): boolean {
  const land = landHexes(key);
  const seen = new Set<string>();
  const stack = [`${land[0].q},${land[0].r}`];
  seen.add(stack[0]);
  const offsets = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
  while (stack.length > 0) {
    const [q, r] = stack.pop()!.split(',').map(Number);
    for (const [dq, dr] of offsets) {
      const nq = q + dq;
      const nr = r + dr;
      const key2 = `${nq},${nr}`;
      if (seen.has(key2)) continue;
      if (land.some((h) => h.q === nq && h.r === nr)) {
        seen.add(key2);
        stack.push(key2);
      }
    }
  }
  return seen.size === land.length;
}

describe('generateMap', () => {
  it('обычная: ровно 16*12 = 192 гекса', () => {
    expect(generateMap(def('normal'))).toHaveLength(MAP_COLUMNS * MAP_ROWS);
  });
  it('возвращает уникальные координаты', () => {
    const hexes = generateMap(def('normal'));
    const keys = new Set(hexes.map((h) => `${h.q},${h.r}`));
    expect(keys.size).toBe(hexes.length);
  });
  it('использует только известные типы местности', () => {
    for (const hex of generateMap(def('normal'))) {
      expect(TERRAINS).toContain(hex.terrain);
    }
  });
  it('длинная: 24*9 = 216 гексов', () => {
    expect(generateMap(def('long'))).toHaveLength(216);
  });
  it('круглая: 271 гекс (круг радиусом 9)', () => {
    expect(generateMap(def('round'))).toHaveLength(271);
  });
  it('остров: суша 120–160 гексов, остальное — вода', () => {
    const hexes = generateMap(def('island'));
    expect(hexes).toHaveLength(15 * 13);
    const land = hexes.filter((h) => h.terrain !== 'water').length;
    expect(land).toBeGreaterThanOrEqual(120);
    expect(land).toBeLessThanOrEqual(160);
    expect(hexes.filter((h) => h.terrain === 'water').length).toBeGreaterThan(0);
  });
  it('гор меньше 15% и больше 5% на большой выборке', () => {
    const hexes = Array.from({ length: 50 }, () => generateMap(def('normal'))).flat();
    const mountains = hexes.filter((h) => h.terrain === 'mountain').length;
    expect(mountains / hexes.length).toBeLessThan(0.15);
    expect(mountains / hexes.length).toBeGreaterThan(0.05);
  });
  it('все гексы в границах определения карты', () => {
    for (const m of DEFAULT_MAPS) {
      for (const hex of generateMap(m)) {
        expect(hex.q).toBeGreaterThanOrEqual(m.qOffset);
        expect(hex.q).toBeLessThan(m.qOffset + m.columns);
        expect(hex.r).toBeGreaterThanOrEqual(0);
        expect(hex.r).toBeLessThan(m.rows);
      }
    }
  });
  it('материки: суша связна (перешеек соединяет два материка)', () => {
    const hexes = generateMap(def('continents'));
    const land = hexes.filter((h) => h.terrain !== 'water');
    expect(land.length).toBeGreaterThan(60);
    expect(connectedLand('continents')).toBe(true);
  });
  it('полуостров: суша связна, есть узкий южный «хвост»', () => {
    const hexes = generateMap(def('peninsula'));
    const land = hexes.filter((h) => h.terrain !== 'water');
    expect(land.length).toBeGreaterThan(60);
    expect(connectedLand('peninsula')).toBe(true);
    const bottom = land.filter((h) => h.r >= 11);
    expect(bottom.length).toBeGreaterThan(0);
    expect(bottom.length).toBeLessThan(8);
  });
  it('хребет: гряда гор по центру (колонка 9 — только горы/мины)', () => {
    const hexes = generateMap(def('ridge'));
    for (const hex of hexes) {
      if (hex.q === 9) {
        expect(['mountain', 'mine']).toContain(hex.terrain);
      }
    }
    expect(hexes.filter((h) => h.q === 9 && (h.terrain === 'mountain' || h.terrain === 'mine')).length).toBe(def('ridge').rows);
  });
  it('обучение: ровно 9*7 = 63 гекса, вся суша', () => {
    const hexes = generateMap(def('tutorial'));
    expect(hexes).toHaveLength(63);
    expect(hexes.every((h) => h.terrain !== 'water')).toBe(true);
  });
});
```

- [ ] **Step 7: Обновить `server/test/rules.test.ts` (использования `MAP_PRESETS`)**

Строка 2 — заменить импорт:

```ts
import { DEFAULT_MAPS, MAP_COLUMNS, MAP_ROWS, generateMap, type Terrain } from '../src/map.js';
```

Строки 478-483 (тест round): заменить

```ts
      columns: MAP_PRESETS.round.columns,
      rows: MAP_PRESETS.round.rows,
      winnerId: null,
    };
    const centerQ = (MAP_PRESETS.round.columns - 1) / 2;
    const centerR = (MAP_PRESETS.round.rows - 1) / 2;
```

на

```ts
      columns: DEFAULT_MAPS.find((m) => m.key === 'round')!.columns,
      rows: DEFAULT_MAPS.find((m) => m.key === 'round')!.rows,
      winnerId: null,
    };
    const centerQ = (DEFAULT_MAPS.find((m) => m.key === 'round')!.columns - 1) / 2;
    const centerR = (DEFAULT_MAPS.find((m) => m.key === 'round')!.rows - 1) / 2;
```

Строки 493-502 (тест long): заменить `MAP_PRESETS.long.columns` на `DEFAULT_MAPS.find((m) => m.key === 'long')!.columns` и `MAP_PRESETS.long.rows` на `DEFAULT_MAPS.find((m) => m.key === 'long')!.rows`.

- [ ] **Step 8: Обновить тест админки `server/test/admin-http.test.ts`**

В `beforeAll` после `registerAdminRoutes(...)` тесты уже ходят по `/api/admin/*`. Добавить в конец файла:

```ts
describe('GET /api/admin/maps', () => {
  it('возвращает список карт из каталога', async () => {
    const res = await fetch(`${base}/api/admin/maps`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; maps: { key: string }[] };
    expect(body.ok).toBe(true);
    expect(body.maps.map((m) => m.key)).toContain('normal');
    expect(body.maps.map((m) => m.key)).toContain('tutorial');
  });
});
```

- [ ] **Step 9: Прогнать тесты и сборку**

Run: `npm test`
Expected: PASS (все файлы, включая переписанный map.test.ts, rooms.test.ts — комнаты работают на DEFAULT_MAPS).
Run: `npm run build`
Expected: tsc без ошибок.

- [ ] **Step 10: Коммит**

```bash
git add server/src/map.ts server/src/db.ts server/src/rooms.ts server/src/admin.ts server/test/map.test.ts server/test/rules.test.ts server/test/admin-http.test.ts
git commit -m "feat: карты в БД — таблица maps, кэш каталога, generateMap по определению"
```

---

### Task 2: Доход по типу гекса

**Files:**
- Modify: `server/src/config.ts`, `server/src/rules.ts`, `server/test/rules.test.ts`

**Interfaces:**
- Consumes: Task 1 (не требуется).
- Produces: `config.terrainIncomes: Record<Terrain, number>` (grass 2, desert 1, forest 3, water 1, mountain 4, mine 6); `INCOME_BY_TERRAIN` в rules.js.

- [ ] **Step 1: Обновить `server/src/config.ts`**

Заменить строки 26-27:

```ts
  incomePerHex: number('CONQUEST_INCOME_PER_HEX', 2),
  mineIncomeBonus: number('CONQUEST_MINE_INCOME_BONUS', 3),
```

на:

```ts
  terrainIncomes: {
    grass: number('CONQUEST_INCOME_GRASS', 2),
    desert: number('CONQUEST_INCOME_DESERT', 1),
    forest: number('CONQUEST_INCOME_FOREST', 3),
    water: number('CONQUEST_INCOME_WATER', 1),
    mountain: number('CONQUEST_INCOME_MOUNTAIN', 4),
    mine: number('CONQUEST_INCOME_MINE', 6),
  } as Record<Terrain, number>,
```

- [ ] **Step 2: Обновить `server/src/rules.ts`**

Строки 8-9: заменить

```ts
export const INCOME_PER_HEX = config.incomePerHex;
export const MINE_INCOME_BONUS = config.mineIncomeBonus;
```

на

```ts
export const INCOME_BY_TERRAIN: Record<Terrain, number> = config.terrainIncomes;
```

`playerIncome` (строки 352-357): заменить тело:

```ts
export function playerIncome(state: GameState, playerId: number): number {
  return state.hexes.reduce((sum, hex) => {
    if (hex.ownerId !== playerId) return sum;
    return sum + INCOME_BY_TERRAIN[hex.terrain];
  }, 0);
}
```

- [ ] **Step 3: Обновить тесты дохода в `server/test/rules.test.ts`**

Тест «шахта даёт больше дохода» (строки ~381-386): заменить

```ts
  it('шахта даёт больше дохода', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: P }, { q: 6, r: 5, terrain: 'mine', ownerId: P }]);
    expect(playerIncome(s, P)).toBe(7);
    applyIncome(s);
    expect(s.players[0].points).toBe(1007);
  });
```

на

```ts
  it('шахта даёт больше дохода', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: P }, { q: 6, r: 5, terrain: 'mine', ownerId: P }]);
    expect(playerIncome(s, P)).toBe(8);
    applyIncome(s);
    expect(s.players[0].points).toBe(1008);
  });
  it('доход зависит от типа гекса', () => {
    const s = makeState([
      { q: 0, r: 0, terrain: 'grass', ownerId: P },
      { q: 1, r: 0, terrain: 'desert', ownerId: P },
      { q: 2, r: 0, terrain: 'forest', ownerId: P },
      { q: 3, r: 0, terrain: 'water', ownerId: P },
      { q: 4, r: 0, terrain: 'mountain', ownerId: P },
      { q: 5, r: 0, terrain: 'mine', ownerId: P },
    ]);
    expect(playerIncome(s, P)).toBe(2 + 1 + 3 + 1 + 4 + 6);
  });
```

Остальные тесты дохода используют grass (2 очка) — не меняются.

- [ ] **Step 4: Прогнать тесты и сборку**

Run: `npm test`
Expected: PASS.
Run: `npm run build`
Expected: tsc без ошибок (grep: `INCOME_PER_HEX|MINE_INCOME_BONUS` больше нигде не используются).

- [ ] **Step 5: Коммит**

```bash
git add server/src/config.ts server/src/rules.ts server/test/rules.test.ts
git commit -m "feat: доход по типу гекса (grass 2, desert 1, forest 3, water 1, mountain 4, mine 6)"
```

---

### Task 3: Войны ИИ через зазор в 1 гекс

**Files:**
- Modify: `server/src/ai.ts`, `server/test/ai.test.ts`, `server/test/rooms.test.ts`

**Interfaces:**
- Consumes: `NEIGHBOR_OFFSETS` (внутри ai.ts), `hasAdjacentOwner`, `findHex`, `terrainCost` из rules.js.
- Produces: приватная `inContactZone(state, hex, aiId): boolean` внутри `chooseDiplomacyAction`; поведение: война через зазор, союз не предлагается цели с 0 гексов.

- [ ] **Step 1: Добавить падающие тесты в `server/test/ai.test.ts`**

В конец `describe('chooseDiplomacyAction', ...)` добавить:

```ts
  it('объявляет войну через зазор в 1 нейтральный гекс', () => {
    const s = makeDiploState([
      { q: 7, r: 5, ownerId: AI },
      { q: 9, r: 5, ownerId: P },
    ]);
    expect(chooseDiplomacyAction(s, AI, { scout: { hexCount: 1, points: 100 } })).toEqual({ type: 'declare-war', targetId: P });
  });
  it('не объявляет войну, если между территориями 2+ нейтральных гекса', () => {
    const s = makeDiploState([
      { q: 7, r: 5, ownerId: AI },
      { q: 10, r: 5, ownerId: P },
    ], 2000, 100);
    expect(chooseDiplomacyAction(s, AI, { scout: { hexCount: 1, points: 100 } })).toBeNull();
  });
  it('не предлагает союз цели без территории', () => {
    const s = makeDiploState([
      { q: 7, r: 5, ownerId: AI },
      { q: 10, r: 10, ownerId: 3 },
      { q: 11, r: 10, ownerId: 3 },
    ], 1000, 1000, 1000);
    expect(chooseDiplomacyAction(s, AI, { scout: { hexCount: 0, points: 1000 } })).toBeNull();
  });
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run test/ai.test.ts`
Expected: FAIL — «объявляет войну через зазор» возвращает null.

- [ ] **Step 3: Реализовать `inContactZone` и правки в `server/src/ai.ts`**

В `chooseDiplomacyAction` заменить ветку войны (строки 206-223) на:

```ts
  for (const target of state.players) {
    if (target.id === aiId || target.eliminated) continue;
    if (relation(state, aiId, target.id) !== 'peace') continue;
    let border: HexState | null = null;
    for (const hex of state.hexes) {
      if (hex.ownerId !== target.id) continue;
      if (!inContactZone(state, hex, aiId)) continue;
      if (border === null || terrainCost(hex.terrain) < terrainCost(border.terrain)) border = hex;
    }
    if (!border) continue;
    const targetStr = target.isAi ? strength(target.id) : scoutStr;
    const aiStr = strength(aiId);
    const stronger =
      aiStr.hexes > targetStr.hexes || (aiStr.hexes === targetStr.hexes && aiStr.points >= targetStr.points);
    if (stronger && ai.points >= terrainCost(border.terrain)) {
      return { type: 'declare-war', targetId: target.id };
    }
  }
```

Ветку союза (строки 233-251) заменить на:

```ts
  const thirdStrongest = Math.max(
    0,
    ...state.players.filter((p) => p.id !== aiId && !p.eliminated).map((p) => hexCount(state, p.id)),
  );
  for (const target of state.players) {
    if (target.id === aiId || target.eliminated) continue;
    const rel = relation(state, aiId, target.id);
    if (rel === 'war' || rel === 'alliance') continue;
    const targetStr = target.isAi ? strength(target.id) : scoutStr;
    if (targetStr.hexes < 1) continue;
    const aiStr = strength(aiId);
    const targetAtWar = state.players.some(
      (p) => p.id !== target.id && p.id !== aiId && relation(state, target.id, p.id) === 'war',
    );
    const beneficial =
      targetAtWar || targetStr.hexes > aiStr.hexes || thirdStrongest > Math.max(aiStr.hexes, targetStr.hexes);
    if (beneficial) {
      return { type: 'propose-alliance', targetId: target.id };
    }
  }
```

После `chooseDiplomacyAction` (в конце файла) добавить хелпер:

```ts
// Контактная зона: гекс цели примыкает к территории ИИ напрямую либо
// отделён одним нейтральным гексом (правило зазора — мирные соседи не могут
// захватить пограничный гекс, поэтому прямой границы может не быть).
function inContactZone(state: GameState, hex: HexState, aiId: number): boolean {
  if (hasAdjacentOwner(state, hex.q, hex.r, aiId)) return true;
  for (const [dq, dr] of NEIGHBOR_OFFSETS) {
    const n = findHex(state, hex.q + dq, hex.r + dr);
    if (n === undefined || n.ownerId !== null) continue;
    if (hasAdjacentOwner(state, n.q, n.r, aiId)) return true;
  }
  return false;
}
```

- [ ] **Step 4: Прогнать тесты**

Run: `npx vitest run test/ai.test.ts`
Expected: PASS (28 + 3 новых).

- [ ] **Step 5: Добавить интеграционный тест в `server/test/rooms.test.ts`**

После теста «агрессия ИИ: не объявляет войну без общей границы» добавить:

```ts
  it('агрессия ИИ: объявляет войну через зазор в 1 нейтральный гекс', () => {
    const room = new Room(1, 'Тест', 'normal', 6, true, 1, () => 0.5);
    room.addHuman('A', 1);
    room.start(1);
    const g = room.gameState!;
    const ai = g.players.find((p) => p.isAi)!;
    const find = (q: number, r: number) => g.hexes.find((h) => h.q === q && h.r === r)!;
    find(6, 5).ownerId = 1;
    g.players[0].capital = { q: 6, r: 5 };
    find(8, 5).ownerId = ai.id;
    g.players[1].capital = { q: 8, r: 5 };
    room.tick();
    expect(rules.relation(g, 1, ai.id)).toBe('war');
  });
```

- [ ] **Step 6: Полный прогон и коммит**

Run: `npm test`
Expected: PASS (все файлы).
Run: `npm run build`
Expected: без ошибок.

```bash
git add server/src/ai.ts server/test/ai.test.ts server/test/rooms.test.ts
git commit -m "feat: ИИ объявляет войну через зазор в 1 гекс; союз не предлагается без территории"
```

---

### Task 4: Доходные подписи на гексах (клиент)

**Files:**
- Modify: `web/src/types.ts`, `web/src/components/HexMap.vue`

**Interfaces:**
- Consumes: Task 2 (серверный доход) — клиентская копия таблицы.
- Produces: `TERRAIN_INCOMES: Record<Terrain, number>` в types.js; подпись `+N` на каждом гексе.

- [ ] **Step 1: Добавить `TERRAIN_INCOMES` в `web/src/types.ts`**

После `TERRAIN_COSTS` (строка ~172) добавить:

```ts
export const TERRAIN_INCOMES: Record<Terrain, number> = {
  grass: 2,
  desert: 1,
  forest: 3,
  water: 1,
  mountain: 4,
  mine: 6,
};
```

- [ ] **Step 2: Добавить подпись дохода в `web/src/components/HexMap.vue`**

Импорт (строка 4): добавить `TERRAIN_INCOMES`:

```ts
import { playerPalette, isAdjacent, TERRAIN_COLORS, TERRAIN_COSTS, TERRAIN_INCOMES, TERRAIN_LABELS, type Hex, type Player } from '../types';
```

В шаблон, внутри `v-for` по гексам (после блока `hex-fortress`, перед `battleOverlay`-полигоном, строки ~394-395) добавить:

```html
        <text
          :x="hexCenter(hex.q, hex.r).x"
          :y="hexCenter(hex.q, hex.r).y + 12"
          text-anchor="middle"
          class="hex-income"
          :class="{ 'hex-income--rich': TERRAIN_INCOMES[hex.terrain] >= 4 }"
        >+{{ TERRAIN_INCOMES[hex.terrain] }}</text>
```

В `<style scoped>` добавить:

```css
.hex-income {
  font-size: 10px;
  font-weight: 700;
  fill: rgba(255, 255, 255, 0.75);
  stroke: rgba(0, 0, 0, 0.6);
  stroke-width: 0.8;
  paint-order: stroke;
  pointer-events: none;
}

.hex-income--rich {
  fill: #ffd54f;
}
```

- [ ] **Step 3: Собрать клиент**

Run (в `web/`): `npm run build`
Expected: vue-tsc + vite без ошибок.

- [ ] **Step 4: Коммит**

```bash
git add web/src/types.ts web/src/components/HexMap.vue
git commit -m "feat: подпись дохода +N на каждом гексе"
```

---

### Task 5: Новые карты и обучение 9×7 (клиент)

**Files:**
- Modify: `web/src/types.ts`, `web/src/App.vue`, `web/src/i18n.ts`

**Interfaces:**
- Consumes: Task 1 (ключи карт continents/peninsula/ridge/tutorial).
- Produces: `MapType` union с новыми ключами, `MAP_INFO` с `hidden`, `startTutorial` → `'tutorial'`, фильтр скрытых карт в селектах.

- [ ] **Step 1: Обновить `web/src/types.ts`**

`MapType` (строка 3):

```ts
export type MapType = 'normal' | 'long' | 'island' | 'round' | 'continents' | 'peninsula' | 'ridge' | 'tutorial';
```

`MapInfo` (строка 7): добавить `hidden?: boolean;`.

`MAP_INFO` (строки 15-20) заменить на:

```ts
export const MAP_INFO: Record<MapType, MapInfo> = {
  normal: { labelKey: 'map.normal', descriptionKey: 'map.normalDesc', minPlayers: 2, maxPlayers: 5, recommendedAi: 1 },
  long: { labelKey: 'map.long', descriptionKey: 'map.longDesc', minPlayers: 2, maxPlayers: 4, recommendedAi: 1 },
  island: { labelKey: 'map.island', descriptionKey: 'map.islandDesc', minPlayers: 2, maxPlayers: 4, recommendedAi: 1 },
  round: { labelKey: 'map.round', descriptionKey: 'map.roundDesc', minPlayers: 2, maxPlayers: 6, recommendedAi: 1 },
  continents: { labelKey: 'map.continents', descriptionKey: 'map.continentsDesc', minPlayers: 2, maxPlayers: 5, recommendedAi: 2 },
  peninsula: { labelKey: 'map.peninsula', descriptionKey: 'map.peninsulaDesc', minPlayers: 2, maxPlayers: 4, recommendedAi: 1 },
  ridge: { labelKey: 'map.ridge', descriptionKey: 'map.ridgeDesc', minPlayers: 2, maxPlayers: 4, recommendedAi: 1 },
  tutorial: { labelKey: 'map.tutorial', descriptionKey: 'map.tutorialDesc', minPlayers: 2, maxPlayers: 2, recommendedAi: 1, hidden: true },
};
```

- [ ] **Step 2: Добавить i18n-ключи в `web/src/i18n.ts`**

В блок `en` после `'map.roundDesc': 'circle radius 9',` добавить:

```ts
    'map.continents': 'Continents',
    'map.continentsDesc': 'two continents with an isthmus',
    'map.peninsula': 'Peninsula',
    'map.peninsulaDesc': 'mainland with a peninsula',
    'map.ridge': 'Ridge',
    'map.ridgeDesc': 'continent divided by a mountain ridge',
    'map.tutorial': 'Tutorial',
    'map.tutorialDesc': 'small 9×7 map',
```

В блок `ru` после `'map.roundDesc': 'круг радиусом 9',` добавить:

```ts
    'map.continents': 'Материки',
    'map.continentsDesc': 'два материка с перешейком',
    'map.peninsula': 'Полуостров',
    'map.peninsulaDesc': 'материк с полуостровом',
    'map.ridge': 'Хребет',
    'map.ridgeDesc': 'континент, разделённый горной грядой',
    'map.tutorial': 'Обучение',
    'map.tutorialDesc': 'маленькая карта 9×7',
```

- [ ] **Step 3: Обновить `web/src/App.vue`**

В `<script setup>` после `createOptions` добавить computed:

```ts
const mapOptions = computed(() => Object.entries(MAP_INFO).filter(([, info]) => !info.hidden) as [MapType, (typeof MAP_INFO)[MapType]][]);
```

Оба селекта карт в шаблоне (экран `ai`, строки ~518-522, и экран `lobby` create, строки ~556-560): заменить

```html
          <option v-for="(info, type) in MAP_INFO" :key="type" :value="type">
            {{ t(info.labelKey) }} — {{ t(info.descriptionKey) }}
          </option>
```

на

```html
          <option v-for="(type, info) in mapOptions" :key="type" :value="type">
            {{ t(info.labelKey) }} — {{ t(info.descriptionKey) }}
          </option>
```

(дважды — в `screen === 'ai'` и в `lobby__create`).

`startTutorial()` (строка ~420): заменить

```ts
  client.sendStartSolo('normal', 1, 'easy', true);
```

на

```ts
  client.sendStartSolo('tutorial', 1, 'easy', true);
```

- [ ] **Step 4: Собрать клиент**

Run (в `web/`): `npm run build`
Expected: без ошибок.

- [ ] **Step 5: Коммит**

```bash
git add web/src/types.ts web/src/App.vue web/src/i18n.ts
git commit -m "feat: новые карты (материки, полуостров, хребет) и карта обучения 9×7"
```

---

### Task 6: Вход по логину и паролю — сервер

**Files:**
- Rewrite: `server/src/auth.ts`
- Create: `server/src/auth-routes.ts`
- Modify: `server/src/db.ts`, `server/src/rooms.ts`, `server/src/ws.ts`, `server/src/config.ts`, `server/src/index.ts`
- Create: `server/test/auth-http.test.ts`

**Interfaces:**
- Consumes: `hashPassword`/`verifyPassword` из `./password.js`; `UsersRepository` из `./db.js`.
- Produces:
  - `auth.js`: `parseSessionToken(token): { u: string } | null`, `signSessionToken(login, secret): string`, `verifySessionToken(token, secret): { u: string } | null`;
  - `auth-routes.js`: `registerAuthRoutes(app, users: UsersRepository): void`;
  - `RoomManager.handleAuth(connId, token)` — по локальному токену; `RoomManager.logout(connId)`;
  - `ws.js`: case `'logout'`;
  - `POST /api/auth/register` и `POST /api/auth/login`.

- [ ] **Step 1: Добавить колонки и методы в `server/src/db.ts`**

В `UserEntity` (после `name`, строка ~207) добавить:

```ts
  @Column({ name: 'login', type: 'text', unique: true, nullable: true })
  login!: string | null;

  @Column({ name: 'password_hash', type: 'text', nullable: true })
  passwordHash!: string | null;

  @Column({ name: 'session_secret', type: 'text', nullable: true })
  sessionSecret!: string | null;
```

В `UsersRepository` (после `upsertBySub`) добавить:

```ts
  async findByLogin(login: string): Promise<UserEntity | null> {
    return this.repo().findOneBy({ login });
  }

  async createLocal(login: string, passwordHash: string, sessionSecret: string): Promise<UserEntity> {
    return this.repo().save({
      sub: `local:${login}`,
      login,
      email: '',
      name: login,
      passwordHash,
      sessionSecret,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    });
  }
```

- [ ] **Step 2: Переписать `server/src/auth.ts` полностью**

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function b64url(data: Buffer | string): string {
  return Buffer.from(data).toString('base64url');
}

export interface SessionProfile {
  sub: string;
  email: string;
  name: string;
}

export function parseSessionToken(token: string): { u: string } | null {
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  let payload: { u?: string };
  try {
    payload = JSON.parse(Buffer.from(token.slice(0, dot), 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload.u !== 'string' || payload.u === '') return null;
  return { u: payload.u };
}

export function signSessionToken(login: string, secret: string): string {
  const body = b64url(JSON.stringify({ u: login, exp: Date.now() + SESSION_TTL_MS }));
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifySessionToken(token: string, secret: string): { u: string } | null {
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload: { u?: string; exp?: number };
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload.u !== 'string' || payload.u === '' || typeof payload.exp !== 'number') return null;
  if (payload.exp < Date.now()) return null;
  return { u: payload.u };
}
```

- [ ] **Step 3: Создать `server/src/auth-routes.ts`**

```ts
import { randomBytes } from 'node:crypto';
import express from 'express';
import { hashPassword, verifyPassword } from './password.js';
import { signSessionToken } from './auth.js';
import type { UsersRepository } from './db.js';

const LOGIN_RE = /^[a-z0-9_-]+$/;

export function registerAuthRoutes(app: express.Express, users: UsersRepository): void {
  app.post('/api/auth/register', async (req, res) => {
    const raw = (req.body ?? {}) as { login?: unknown; password?: unknown };
    const login = typeof raw.login === 'string' ? raw.login.trim().toLowerCase() : '';
    if (login.length < 3 || login.length > 32 || !LOGIN_RE.test(login)) {
      res.status(400).json({ ok: false, error: 'invalid-login' });
      return;
    }
    if (typeof raw.password !== 'string' || raw.password.length < 6 || raw.password.length > 128) {
      res.status(400).json({ ok: false, error: 'invalid-password' });
      return;
    }
    try {
      if (await users.findByLogin(login)) {
        res.status(409).json({ ok: false, error: 'login-taken' });
        return;
      }
      const passwordHash = await hashPassword(raw.password);
      const sessionSecret = randomBytes(32).toString('base64url');
      await users.createLocal(login, passwordHash, sessionSecret);
      res.json({ ok: true, token: signSessionToken(login, sessionSecret), name: login });
    } catch (err) {
      console.error('register failed:', err);
      res.status(500).json({ ok: false, error: 'server' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    const raw = (req.body ?? {}) as { login?: unknown; password?: unknown };
    const login = typeof raw.login === 'string' ? raw.login.trim().toLowerCase() : '';
    if (login === '' || typeof raw.password !== 'string' || raw.password === '') {
      res.status(400).json({ ok: false, error: 'invalid-credentials' });
      return;
    }
    try {
      const user = await users.findByLogin(login);
      if (!user || !user.passwordHash || !user.sessionSecret || !(await verifyPassword(raw.password, user.passwordHash))) {
        res.status(401).json({ ok: false, error: 'invalid-credentials' });
        return;
      }
      await users.upsertBySub(user.sub, user.email ?? '', user.name ?? login);
      res.json({ ok: true, token: signSessionToken(login, user.sessionSecret), name: login });
    } catch (err) {
      console.error('login failed:', err);
      res.status(500).json({ ok: false, error: 'server' });
    }
  });
}
```

- [ ] **Step 4: Обновить `server/src/rooms.ts`**

Строки 5-6: заменить импорт:

```ts
import type { GoogleProfile } from './auth.js';
import { verifyGoogleIdToken } from './auth.js';
```

на

```ts
import { parseSessionToken, verifySessionToken, type SessionProfile } from './auth.js';
```

Строку 9: добавить `UsersRepository` в импорт db.js:

```ts
import { dumpsRepository, usersRepository, type UsersRepository } from './db.js';
```

`handleAuth` (строки 913-932) заменить на:

```ts
  async handleAuth(connId: number, token: string): Promise<{ ok: boolean; error?: string }> {
    if (!token) return { ok: false, error: 'Empty token' };
    const parsed = parseSessionToken(token);
    if (!parsed) return { ok: false, error: 'Invalid session token' };
    let user;
    try {
      user = await this.usersRepo.findByLogin(parsed.u);
    } catch (err) {
      console.error('user lookup failed:', err);
      return { ok: false, error: 'Login failed' };
    }
    if (!user || !user.sessionSecret || !verifySessionToken(token, user.sessionSecret)) {
      return { ok: false, error: 'Invalid session token' };
    }
    const profile: SessionProfile = { sub: user.sub, email: user.email ?? '', name: user.name ?? user.login ?? user.sub };
    this.authProfiles.set(connId, profile);
    this.roomForConn(connId)?.updateName(connId, profile.name);
    try {
      await this.usersRepo.upsertBySub(profile.sub, profile.email, profile.name);
    } catch (err) {
      console.error('user upsert failed:', err);
    }
    return { ok: true };
  }

  logout(connId: number): void {
    this.authProfiles.delete(connId);
  }
```

Строку 890: `private authProfiles = new Map<number, GoogleProfile>();` → `private authProfiles = new Map<number, SessionProfile>();`
Строку 909: `authProfileFor(connId: number): GoogleProfile | null` → `authProfileFor(connId: number): SessionProfile | null`

Конструктор `RoomManager` (строка 893) заменить на:

```ts
  constructor(
    private readonly finishedRoomGraceMs = 60_000,
    private readonly usersRepo: Pick<UsersRepository, 'findByLogin' | 'upsertBySub'> = usersRepository,
  ) {}
```

- [ ] **Step 5: Обновить `server/src/ws.ts`**

В `WsMessage` (после `training?: boolean;`, строка 21) добавить ничего не нужно — token уже есть. В `switch` (после case `'auth'`, строка ~81) добавить:

```ts
          case 'logout':
            manager.logout(connId);
            broadcast();
            return;
```

- [ ] **Step 6: Убрать Google из конфига и подключить auth-роуты**

`server/src/config.ts` строка 37: удалить `googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',`.

`server/src/index.ts`: строка 3 импорт:

```ts
import { closeDb, initDb, dumpsRepository, adminCredentialsRepository, usersRepository } from './db.js';
```

(без изменений — usersRepository уже импортируется). Добавить импорт:

```ts
import { registerAuthRoutes } from './auth-routes.js';
```

После `registerAdminRoutes(...)` (строка 40) добавить:

```ts
  registerAuthRoutes(app, usersRepository);
```

- [ ] **Step 7: Создать `server/test/auth-http.test.ts`**

```ts
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerAuthRoutes } from '../src/auth-routes.js';
import { verifySessionToken } from '../src/auth.js';

interface UserRow {
  id: number;
  sub: string;
  login: string;
  email: string;
  name: string;
  passwordHash: string;
  sessionSecret: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

function makeUsersStub() {
  const rows: UserRow[] = [];
  let nextId = 1;
  return {
    rows,
    async findByLogin(login: string): Promise<UserRow | null> {
      return rows.find((u) => u.login === login) ?? null;
    },
    async createLocal(login: string, passwordHash: string, sessionSecret: string): Promise<UserRow> {
      const row: UserRow = {
        id: nextId++,
        sub: `local:${login}`,
        login,
        email: '',
        name: login,
        passwordHash,
        sessionSecret,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      };
      rows.push(row);
      return row;
    },
    async upsertBySub(): Promise<void> {},
    async list(): Promise<UserRow[]> {
      return [...rows];
    },
  };
}

let server: ReturnType<typeof createServer>;
let base = '';
const stub = makeUsersStub();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerAuthRoutes(app, stub as never);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() =>
  new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  }),
);

async function register(login: unknown, password: unknown): Promise<Response> {
  return fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password }),
  });
}

async function login(login: unknown, password: unknown): Promise<Response> {
  return fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password }),
  });
}

describe('POST /api/auth/register', () => {
  it('регистрирует и сразу выдаёт токен', async () => {
    stub.rows.length = 0;
    const res = await register('TestUser', 'secret1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; token: string; name: string };
    expect(body.ok).toBe(true);
    expect(body.name).toBe('testuser');
    expect(stub.rows).toHaveLength(1);
    expect(stub.rows[0].sub).toBe('local:testuser');
    expect(stub.rows[0].passwordHash).not.toBe('secret1');
    expect(verifySessionToken(body.token, stub.rows[0].sessionSecret)).toEqual({ u: 'testuser' });
  });

  it('короткий логин → 400 invalid-login', async () => {
    stub.rows.length = 0;
    const res = await register('ab', 'secret1');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'invalid-login' });
  });

  it('недопустимые символы логина → 400 invalid-login', async () => {
    stub.rows.length = 0;
    const res = await register('bad login!', 'secret1');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'invalid-login' });
  });

  it('короткий пароль → 400 invalid-password', async () => {
    stub.rows.length = 0;
    const res = await register('user1', '123');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'invalid-password' });
  });

  it('занятый логин → 409 login-taken', async () => {
    stub.rows.length = 0;
    await register('taken1', 'secret1');
    const res = await register('Taken1', 'secret2');
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: 'login-taken' });
  });
});

describe('POST /api/auth/login', () => {
  it('вход с верным паролем → токен', async () => {
    stub.rows.length = 0;
    await register('user1', 'secret1');
    const res = await login('USER1', 'secret1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; token: string; name: string };
    expect(body.name).toBe('user1');
    const row = stub.rows.find((u) => u.login === 'user1')!;
    expect(verifySessionToken(body.token, row.sessionSecret)).toEqual({ u: 'user1' });
  });

  it('неверный пароль → 401 invalid-credentials', async () => {
    stub.rows.length = 0;
    await register('user1', 'secret1');
    const res = await login('user1', 'wrong1');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: 'invalid-credentials' });
  });

  it('неизвестный логин → 401 invalid-credentials', async () => {
    stub.rows.length = 0;
    const res = await login('nobody', 'secret1');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: 'invalid-credentials' });
  });
});

describe('handleAuth через RoomManager', () => {
  it('принимает валидный токен и отклоняет неверный', async () => {
    stub.rows.length = 0;
    await register('user1', 'secret1');
    const row = stub.rows.find((u) => u.login === 'user1')!;
    const { verifySessionToken: v, signSessionToken: s } = await import('../src/auth.js');
    const token = s('user1', row.sessionSecret);
    const { RoomManager } = await import('../src/rooms.js');
    const manager = new RoomManager(60_000, stub as never);
    const ok = await manager.handleAuth(1, token);
    expect(ok).toEqual({ ok: true });
    const bad = await manager.handleAuth(2, token + 'x');
    expect(bad.ok).toBe(false);
    expect(manager.authProfileFor(1)?.name).toBe('user1');
    manager.logout(1);
    expect(manager.authProfileFor(1)).toBeNull();
  });
});
```

- [ ] **Step 8: Прогнать тесты и сборку**

Run: `npm test`
Expected: PASS (все файлы; старые тесты Google-авторизации не существовали отдельно).
Run: `npm run build`
Expected: tsc без ошибок (`GoogleProfile`/`verifyGoogleIdToken` нигде не используются).

- [ ] **Step 9: Коммит**

```bash
git add server/src/auth.ts server/src/auth-routes.ts server/src/db.ts server/src/rooms.ts server/src/ws.ts server/src/config.ts server/src/index.ts server/test/auth-http.test.ts
git commit -m "feat: вход по логину и паролю — регистрация, логин, HMAC-токен сессии"
```

---

### Task 7: Вход по логину и паролю — клиент

**Files:**
- Modify: `web/src/App.vue`, `web/src/api.ts`, `web/src/i18n.ts`, `web/src/env.d.ts`

**Interfaces:**
- Consumes: Task 6 (эндпоинты `/api/auth/register|login`, WS `auth`/`logout`).
- Produces: `GameClient.setAuthToken(token: string | null)`, `GameClient.sendLogout()`, форма входа в меню.

- [ ] **Step 1: Обновить `web/src/api.ts`**

В класс `GameClient` (после `private closed = false;`, строка 18) добавить:

```ts
  private authToken: string | null = null;
```

После `close()` добавить:

```ts
  setAuthToken(token: string | null): void {
    this.authToken = token;
  }

  sendLogout(): void {
    this.send({ type: 'logout' });
  }
```

В `open()` в `ws.onopen` (после `this.onStatus(true);`, строка 119) добавить:

```ts
      if (this.authToken) {
        this.send({ type: 'auth', token: this.authToken });
      }
```

- [ ] **Step 2: Обновить `web/src/env.d.ts`**

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}
```

заменить на:

```ts
/// <reference types="vite/client" />
```

- [ ] **Step 3: Обновить `web/src/i18n.ts`**

Удалить ключи: `'menu.signInGoogle'` (en, строка 13; ru, строка 119) и `'menu.googleNotConfigured'` (en, строка 14; ru, строка 120).

В блок `en` после `'menu.loggedInAs': 'Signed in as {name}',` добавить:

```ts
    'menu.login': 'Login',
    'menu.password': 'Password',
    'menu.signIn': 'Sign in',
    'menu.register': 'Register',
    'menu.logout': 'Log out',
    'auth.errorInvalid': 'Invalid login or password',
    'auth.errorTaken': 'Login is already taken',
    'auth.errorValidation': 'Login 3–32 chars, password 6+ chars',
    'auth.errorNetwork': 'Network error. Please try again.',
```

В блок `ru` после `'menu.loggedInAs': 'Вы вошли как {name}',` добавить:

```ts
    'menu.login': 'Логин',
    'menu.password': 'Пароль',
    'menu.signIn': 'Войти',
    'menu.register': 'Регистрация',
    'menu.logout': 'Выйти',
    'auth.errorInvalid': 'Неверный логин или пароль',
    'auth.errorTaken': 'Логин уже занят',
    'auth.errorValidation': 'Логин 3–32 символа, пароль от 6 символов',
    'auth.errorNetwork': 'Ошибка сети. Попробуйте ещё раз.',
```

- [ ] **Step 4: Обновить `web/src/App.vue` — скрипт**

Удалить:
- блок `declare global { interface Window { google? ... } }` (строки 14-25);
- строку `const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;` (строка 27);
- ref `const googleMsg = ref<string | null>(null);` (строка 57);
- функции `onGoogleNotConfigured` (строки 447-452) и `initGoogleButton` (строки 454-463);
- в `onMounted` (строки 472-478) блок загрузки скрипта `if (GOOGLE_CLIENT_ID) { ... }`.

Добавить (рядом с `auth`):

```ts
const loginForm = ref({ login: '', password: '' });
const authError = ref<string | null>(null);
```

После `onGoogleNotConfigured` (на его место) добавить функции:

```ts
async function submitAuth(register: boolean): Promise<void> {
  const loginName = loginForm.value.login.trim();
  const password = loginForm.value.password;
  if (loginName === '' || password === '') {
    authError.value = t('auth.errorValidation');
    return;
  }
  authError.value = null;
  try {
    const res = await fetch(register ? '/api/auth/register' : '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: loginName, password }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; token?: string; error?: string };
    if (res.ok && data.ok && typeof data.token === 'string') {
      localStorage.setItem('conquest.authToken', data.token);
      client.setAuthToken(data.token);
      client.sendAuth(data.token);
      loginForm.value.password = '';
      return;
    }
    if (res.status === 401) authError.value = t('auth.errorInvalid');
    else if (res.status === 409) authError.value = t('auth.errorTaken');
    else if (res.status === 400) authError.value = t('auth.errorValidation');
    else authError.value = t('auth.errorNetwork');
  } catch {
    authError.value = t('auth.errorNetwork');
  }
}

function logout(): void {
  localStorage.removeItem('conquest.authToken');
  client.setAuthToken(null);
  client.sendLogout();
  auth.value = null;
}
```

Первый `onMounted` (строка 156-160): перед `client.connect();` (во втором `onMounted`, строка 466) добавить:

```ts
  const savedToken = localStorage.getItem('conquest.authToken');
  if (savedToken) client.setAuthToken(savedToken);
```

- [ ] **Step 5: Обновить `web/src/App.vue` — шаблон и стили**

Заменить блок `.menu__google` в главном меню (строки 501-506):

```html
        <div class="menu__google">
          <div v-if="auth" class="menu__auth">{{ t('menu.loggedInAs', { name: auth.name }) }}</div>
          <div v-else-if="GOOGLE_CLIENT_ID" id="google-btn"></div>
          <button v-else class="menu__btn menu__btn--ghost" @click="onGoogleNotConfigured">{{ t('menu.signInGoogle') }}</button>
          <div v-if="googleMsg" class="menu__google-err">{{ googleMsg }}</div>
        </div>
```

на:

```html
        <div class="menu__auth">
          <div v-if="auth" class="menu__auth-row">
            <span class="menu__auth">{{ t('menu.loggedInAs', { name: auth.name }) }}</span>
            <button class="menu__btn menu__btn--ghost menu__btn--small" @click="logout">{{ t('menu.logout') }}</button>
          </div>
          <div v-else class="menu__auth-form">
            <input v-model="loginForm.login" class="menu__input" :placeholder="t('menu.login')" autocomplete="username">
            <input
              v-model="loginForm.password"
              type="password"
              class="menu__input"
              :placeholder="t('menu.password')"
              autocomplete="current-password"
              @keydown.enter="submitAuth(false)"
            >
            <div class="menu__auth-btns">
              <button class="menu__btn menu__btn--small" @click="submitAuth(false)">{{ t('menu.signIn') }}</button>
              <button class="menu__btn menu__btn--ghost menu__btn--small" @click="submitAuth(true)">{{ t('menu.register') }}</button>
            </div>
            <div v-if="authError" class="menu__google-err">{{ authError }}</div>
          </div>
        </div>
```

В `<style scoped>` заменить блок `.menu__google` (строки 908-911) на:

```css
.menu__auth {
  color: #ce93d8;
  font-weight: 600;
}

.menu__auth-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.menu__auth-form {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.menu__auth-btns {
  display: flex;
  gap: 10px;
}

.menu__btn--small {
  min-width: 120px;
  padding: 8px 16px;
  font-size: 14px;
}

.menu__input {
  min-width: 260px;
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid #555;
  background: #2a2a31;
  color: #fff;
  font-size: 15px;
}
```

- [ ] **Step 6: Собрать клиент**

Run (в `web/`): `npm run build`
Expected: без ошибок.

- [ ] **Step 7: Коммит**

```bash
git add web/src/App.vue web/src/api.ts web/src/i18n.ts web/src/env.d.ts
git commit -m "feat: форма входа по логину и паролю вместо Google"
```

---

### Task 8: Фидбек — проводка на сервере

**Files:**
- Modify: `server/src/index.ts`, `server/src/admin.ts`, `server/test/admin-http.test.ts`, `server/test/feedback-http.test.ts`
- (уже есть, не меняются: `server/src/feedback.ts`, `server/src/rate-limit.ts`, `server/src/db.ts` — сущность/репозиторий)

**Interfaces:**
- Consumes: `registerFeedbackRoutes(app, repo, limiter, rateLimit)` из `feedback.js`; `SlidingWindowLimiter` из `rate-limit.js`; `feedbackRepository` из `db.js`; `config.feedbackRateLimit`.
- Produces: `registerAdminRoutes(app, manager, dumps, adminCreds, users, feedback)`; `POST /api/feedback` (публичный); `GET /api/admin/feedback`, `POST /api/admin/feedback/:id/read`, `DELETE /api/admin/feedback/:id`.

- [ ] **Step 1: Проводка в `server/src/index.ts`**

Импорты (после строки 7):

```ts
import { registerFeedbackRoutes } from './feedback.js';
import { SlidingWindowLimiter } from './rate-limit.js';
```

В `main()` после `const manager = new RoomManager();` (строка 39) добавить:

```ts
  const feedbackLimiter = new SlidingWindowLimiter(60000);
  registerFeedbackRoutes(app, feedbackRepository, feedbackLimiter, config.feedbackRateLimit);
```

(импорт `feedbackRepository` добавить в строку 3: `import { closeDb, initDb, dumpsRepository, adminCredentialsRepository, usersRepository, feedbackRepository } from './db.js';`)

Рядом с первым `setInterval` (строка 57) добавить:

```ts
  setInterval(() => feedbackLimiter.sweep(), 60000);
```

- [ ] **Step 2: Админ-роуты в `server/src/admin.ts`**

Строка 7: `import type { AdminCredentialsRepository, DumpsRepository, UsersRepository } from './db.js';` → добавить `FeedbackRepository`.

Строки 113-119: сигнатура

```ts
export function registerAdminRoutes(
  app: express.Express,
  manager: RoomManager,
  dumps: DumpsRepository,
  adminCreds: AdminCredentialsRepository,
  users: UsersRepository,
  feedback: FeedbackRepository,
): void {
```

Перед `app.use('/api/admin', publicRouter);` (строка 264) добавить:

```ts
  protectedRouter.get('/feedback', async (_req, res) => {
    try {
      res.json({ ok: true, feedback: await feedback.list() });
    } catch (err) {
      console.error('feedback list failed:', err);
      res.status(500).json({ ok: false, error: 'Failed to list feedback' });
    }
  });

  protectedRouter.post('/feedback/:id/read', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ ok: false, error: 'Invalid id' });
      return;
    }
    try {
      if (!(await feedback.markRead(id))) {
        res.status(404).json({ ok: false, error: 'Feedback not found' });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      console.error('feedback markRead failed:', err);
      res.status(500).json({ ok: false, error: 'Failed to update feedback' });
    }
  });

  protectedRouter.delete('/feedback/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ ok: false, error: 'Invalid id' });
      return;
    }
    try {
      if (!(await feedback.remove(id))) {
        res.status(404).json({ ok: false, error: 'Feedback not found' });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      console.error('feedback delete failed:', err);
      res.status(500).json({ ok: false, error: 'Failed to delete feedback' });
    }
  });
```

- [ ] **Step 3: Обновить `server/test/admin-http.test.ts`**

Строка 29: `registerAdminRoutes(app, {} as never, {} as never, adminCreds as never, usersStub as never);` → добавить 6-й стаб:

```ts
  registerAdminRoutes(app, {} as never, {} as never, adminCreds as never, usersStub as never, {} as never);
```

- [ ] **Step 4: Починить `server/test/feedback-http.test.ts` и добавить админ-тесты**

`afterAll` (строка 56) заменить:

```ts
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve)));
```

на

```ts
afterAll(() =>
  new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  }),
);
```

В шапку добавить импорт:

```ts
import { registerAdminRoutes } from '../src/admin.js';
import { hashPassword } from '../src/password.js';
```

В `beforeAll` (после `registerFeedbackRoutes(...)`, строка 50) добавить:

```ts
  const adminCreds = {
    get: async () => ({ id: 1, username: 'admin', passwordHash: await hashPassword('admin'), sessionSecret: 's' }),
    updateCredentials: async () => {},
  };
  registerAdminRoutes(app, {} as never, {} as never, adminCreds as never, {} as never, stub as never);
```

В конец файла добавить:

```ts
describe('feedback: админ-роуты', () => {
  let cookie = '';

  beforeAll(async () => {
    const res = await fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin' }),
    });
    expect(res.status).toBe(200);
    cookie = res.headers.get('set-cookie')!.split(';')[0];
  });

  it('GET /api/admin/feedback возвращает список', async () => {
    stub.rows.length = 0;
    await post('Первый', '1.1.1.1');
    await post('Второй', '2.2.2.2');
    const res = await fetch(`${base}/api/admin/feedback`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; feedback: FeedbackRow[] };
    expect(body.ok).toBe(true);
    expect(body.feedback.map((f) => f.text)).toEqual(['Второй', 'Первый']);
  });

  it('POST /:id/read помечает прочитанным, 404 для неизвестного id', async () => {
    stub.rows.length = 0;
    const id = await stub.create('x', '1.1.1.1');
    const res = await fetch(`${base}/api/admin/feedback/${id}/read`, { method: 'POST', headers: { cookie } });
    expect(res.status).toBe(200);
    expect(stub.rows[0].read).toBe(true);
    const missing = await fetch(`${base}/api/admin/feedback/9999/read`, { method: 'POST', headers: { cookie } });
    expect(missing.status).toBe(404);
  });

  it('DELETE /:id удаляет, 404 для неизвестного id', async () => {
    stub.rows.length = 0;
    const id = await stub.create('y', '1.1.1.1');
    const res = await fetch(`${base}/api/admin/feedback/${id}`, { method: 'DELETE', headers: { cookie } });
    expect(res.status).toBe(200);
    expect(stub.rows).toHaveLength(0);
    const missing = await fetch(`${base}/api/admin/feedback/9999`, { method: 'DELETE', headers: { cookie } });
    expect(missing.status).toBe(404);
  });

  it('неавторизованный запрос → 401', async () => {
    const res = await fetch(`${base}/api/admin/feedback`);
    expect(res.status).toBe(401);
  });
});
```

(`FeedbackRow` и `post()` уже определены в файле; `stub` уже есть.)

- [ ] **Step 5: Прогнать тесты и сборку**

Run: `npm test`
Expected: PASS (включая feedback-http.test.ts — без зависания).
Run: `npm run build`
Expected: без ошибок.

- [ ] **Step 6: Коммит (включая ранее не закоммиченные файлы фидбека)**

```bash
git add server/src/index.ts server/src/admin.ts server/test/admin-http.test.ts server/test/feedback-http.test.ts server/src/feedback.ts
git commit -m "feat: фидбек — проводка на сервере и админ-роуты"
```

---

### Task 9: Фидбек — клиент и админка

**Files:**
- Modify: `web/src/App.vue`, `web/src/i18n.ts`, `server/public/admin.html`

**Interfaces:**
- Consumes: Task 8 (эндпоинты `POST /api/feedback`, админ-роуты).
- Produces: кнопка «Фидбек» + модалка; вкладка «Отзывы» в админке.

- [ ] **Step 1: i18n-ключи в `web/src/i18n.ts`**

В блок `en` после `'dump.failed': 'Dump failed: {error}',` добавить:

```ts
    'menu.feedback': 'Feedback',
    'feedback.title': 'Feedback',
    'feedback.placeholder': 'Write your feedback…',
    'feedback.send': 'Send',
    'feedback.cancel': 'Cancel',
    'feedback.sent': 'Thank you! Your feedback has been sent.',
    'feedback.error': 'Could not send. Please try again.',
    'feedback.rateLimited': 'Too many attempts. Please wait a minute.',
    'feedback.tooLong': 'Feedback is too long (max 2000 characters).',
```

В блок `ru` после `'dump.failed': 'Ошибка дампа: {error}',` добавить:

```ts
    'menu.feedback': 'Отзыв',
    'feedback.title': 'Обратная связь',
    'feedback.placeholder': 'Напишите отзыв…',
    'feedback.send': 'Отправить',
    'feedback.cancel': 'Отмена',
    'feedback.sent': 'Спасибо! Ваш отзыв отправлен.',
    'feedback.error': 'Не удалось отправить. Попробуйте ещё раз.',
    'feedback.rateLimited': 'Слишком много попыток. Подождите минуту.',
    'feedback.tooLong': 'Отзыв слишком длинный (макс. 2000 символов).',
```

- [ ] **Step 2: Состояние и отправка в `web/src/App.vue`**

Рядом с `const burgerOpen = ref(false);` добавить:

```ts
const feedbackOpen = ref(false);
const feedbackText = ref('');
const feedbackStatus = ref<'' | 'sent' | 'error' | 'rateLimited' | 'tooLong'>('');
```

После `closeContextMenu` добавить:

```ts
function openFeedback(): void {
  feedbackText.value = '';
  feedbackStatus.value = '';
  feedbackOpen.value = true;
}

function closeFeedback(): void {
  feedbackOpen.value = false;
  feedbackStatus.value = '';
}

async function sendFeedback(): Promise<void> {
  const text = feedbackText.value.trim();
  if (text === '') {
    feedbackStatus.value = 'error';
    return;
  }
  feedbackStatus.value = '';
  try {
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (res.status === 429) {
      feedbackStatus.value = 'rateLimited';
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (res.ok && data.ok) {
      feedbackText.value = '';
      feedbackStatus.value = 'sent';
      return;
    }
    feedbackStatus.value = data.error === 'too-long' ? 'tooLong' : 'error';
  } catch {
    feedbackStatus.value = 'error';
  }
}
```

- [ ] **Step 3: Кнопка и модалка в шаблоне `web/src/App.vue`**

В главном меню после кнопки лоад-теста (`@click="goToLoadTest"`) добавить:

```html
        <button class="menu__btn" @click="openFeedback">{{ t('menu.feedback') }}</button>
```

В конец `<template>` (после блока `burger-menu`) добавить:

```html
    <div v-if="feedbackOpen" class="feedback-overlay" @click.self="closeFeedback">
      <div class="feedback-modal">
        <h2 class="feedback-modal__title">{{ t('feedback.title') }}</h2>
        <textarea
          v-model="feedbackText"
          class="feedback-modal__input"
          :placeholder="t('feedback.placeholder')"
          maxlength="2000"
          rows="4"
        ></textarea>
        <p v-if="feedbackStatus === 'sent'" class="feedback-modal__msg feedback-modal__msg--ok">{{ t('feedback.sent') }}</p>
        <p v-else-if="feedbackStatus === 'rateLimited'" class="feedback-modal__msg feedback-modal__msg--err">{{ t('feedback.rateLimited') }}</p>
        <p v-else-if="feedbackStatus === 'tooLong'" class="feedback-modal__msg feedback-modal__msg--err">{{ t('feedback.tooLong') }}</p>
        <p v-else-if="feedbackStatus === 'error'" class="feedback-modal__msg feedback-modal__msg--err">{{ t('feedback.error') }}</p>
        <div class="feedback-modal__row">
          <button class="feedback-modal__btn" :disabled="feedbackStatus === 'sent'" @click="sendFeedback">{{ t('feedback.send') }}</button>
          <button class="feedback-modal__btn feedback-modal__btn--ghost" @click="closeFeedback">{{ t('feedback.cancel') }}</button>
        </div>
      </div>
    </div>
```

В `<style scoped>` добавить:

```css
.feedback-overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
}
.feedback-modal {
  width: min(420px, 90vw);
  background: #1e1e24;
  border: 1px solid #444;
  border-radius: 10px;
  padding: 18px;
}
.feedback-modal__title {
  margin: 0 0 12px;
  font-size: 18px;
}
.feedback-modal__input {
  width: 100%;
  box-sizing: border-box;
  background: #14141a;
  color: #fff;
  border: 1px solid #555;
  border-radius: 6px;
  padding: 8px;
  font: inherit;
  resize: vertical;
}
.feedback-modal__msg {
  font-size: 13px;
  margin: 8px 0 0;
}
.feedback-modal__msg--ok {
  color: #69db7c;
}
.feedback-modal__msg--err {
  color: #ff6b6b;
}
.feedback-modal__row {
  display: flex;
  gap: 10px;
  margin-top: 12px;
}
.feedback-modal__btn {
  background: #2196f3;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 8px 14px;
  cursor: pointer;
  font-size: 13px;
}
.feedback-modal__btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.feedback-modal__btn--ghost {
  background: #2a2a31;
  border: 1px solid #555;
}
```

- [ ] **Step 4: Вкладка «Отзывы» в `server/public/admin.html`**

В панель вкладок (после `data-tab="account"`) добавить:

```html
    <button class="tab" data-tab="feedback">Отзывы</button>
```

`switchTab` заменить:

```js
function switchTab(tab) {
  currentTab = tab;
  stopPoll();
  showTabs();
  if (tab === 'account') renderAccount();
  else if (tab === 'feedback') renderFeedback();
  else renderDashboard();
}
```

После `renderAccount` добавить:

```js
async function renderFeedback() {
  $('#view').innerHTML = `
    <div class="row" style="justify-content:space-between">
      <h2>Отзывы</h2>
      <button class="ghost" id="fb-refresh">Обновить</button>
    </div>
    <div class="card"><table>
      <thead><tr><th>#</th><th>Когда</th><th>IP</th><th>Текст</th><th></th><th></th></tr></thead>
      <tbody id="fb-rows"></tbody>
    </table></div>
    <div id="fb-msg" class="note"></div>`;
  $('#fb-refresh').onclick = () => loadFeedback();
  await loadFeedback();
}

async function loadFeedback() {
  const tbody = $('#fb-rows');
  const msg = $('#fb-msg');
  if (!tbody) return;
  msg.className = 'note';
  msg.textContent = 'Загрузка…';
  try {
    const r = await api('/api/admin/feedback');
    const list = (r && Array.isArray(r.feedback) ? r.feedback : []);
    msg.textContent = '';
    tbody.innerHTML = list.map((f) => `
      <tr class="${f.read ? '' : 'fb-unread'}">
        <td>#${f.id}</td>
        <td>${new Date(f.createdAt).toLocaleString()}</td>
        <td>${esc(f.ip)}</td>
        <td>${esc(f.text)}</td>
        <td>${f.read ? '<span class="note">прочитано</span>' : ''}</td>
        <td style="white-space:nowrap">
          ${f.read ? '' : `<button class="ghost" data-read="${f.id}">Прочитано</button>`}
          <button class="ghost" data-del="${f.id}">Удалить</button>
        </td>
      </tr>`).join('') || '<tr><td colspan="6" class="note">Отзывов нет</td></tr>';
    tbody.querySelectorAll('[data-read]').forEach((btn) => {
      btn.onclick = async () => {
        await api('/api/admin/feedback/' + btn.dataset.read + '/read', { method: 'POST' });
        await loadFeedback();
      };
    });
    tbody.querySelectorAll('[data-del]').forEach((btn) => {
      btn.onclick = async () => {
        await api('/api/admin/feedback/' + btn.dataset.del, { method: 'DELETE' });
        await loadFeedback();
      };
    });
  } catch (e) {
    if (e.message === 'UNAUTHORIZED') { boot(); return; }
    msg.className = 'err';
    msg.textContent = 'Ошибка загрузки';
  }
}
```

В `<style>` добавить:

```css
  .fb-unread { font-weight: 600; }
```

- [ ] **Step 5: Собрать клиент**

Run (в `web/`): `npm run build`
Expected: без ошибок.

- [ ] **Step 6: Коммит**

```bash
git add web/src/App.vue web/src/i18n.ts server/public/admin.html
git commit -m "feat: форма фидбека на главном меню и вкладка «Отзывы» в админке"
```

---

### Task 10: Панель дипломатии — принять/отклонить

**Files:**
- Modify: `server/src/rooms.ts`, `server/src/ws.ts`, `server/test/rooms.test.ts`
- Modify: `web/src/types.ts`, `web/src/api.ts`, `web/src/App.vue`, `web/src/i18n.ts`

**Interfaces:**
- Consumes: `pendingProposals` в view (уже есть); `respond-proposal` с `q/r` (уже есть).
- Produces: `respond-proposal` с `playerId`; `GameClient.sendRespondProposalTo(playerId, accept)`; панель входящих предложений.

- [ ] **Step 1: Сервер — `respond-proposal` по `playerId` в `server/src/rooms.ts`**

Сигнатура `handleAction` (строка 555): в тип msg добавить `playerId?: number`:

```ts
  handleAction(connId: number, type: string, msg: { q?: number; r?: number; points?: number; army?: number; kind?: string; accept?: boolean; playerId?: number }): ActionResult {
```

Case `'respond-proposal'` (строки 643-657): заменить первую строку

```ts
        const proposer = this.targetPlayerId(playerId, msg);
```

на

```ts
        const proposer = typeof msg.playerId === 'number' ? msg.playerId : this.targetPlayerId(playerId, msg);
```

- [ ] **Step 2: `server/src/ws.ts` — `playerId` в сообщении**

`WsMessage` (строка 8): добавить поле

```ts
  playerId?: number;
```

- [ ] **Step 3: Тест в `server/test/rooms.test.ts`**

После теста «ИИ proposes an alliance...» (строки ~597-605) добавить:

```ts
  it('respond-proposal по playerId: принимает предложение без координат гекса', () => {
    const room = new Room(1, 'Тест', 'normal', 6, true, 1, () => 0.5);
    room.addHuman('A', 1);
    room.start(1);
    const g = room.gameState!;
    const ai = g.players.find((p) => p.isAi)!;
    g.hexes[0].ownerId = 1;
    g.players[0].capital = { q: g.hexes[0].q, r: g.hexes[0].r };
    g.hexes[1].ownerId = ai.id;
    g.players[1].capital = { q: g.hexes[1].q, r: g.hexes[1].r };
    room['pendingProposals'] = [{ from: ai.id, to: 1, kind: 'alliance' }];
    const result = room.handleAction(1, 'respond-proposal', { playerId: ai.id, accept: true });
    expect(result.type).toBe('state');
    expect(rules.relation(g, 1, ai.id)).toBe('alliance');
  });
```

- [ ] **Step 4: Клиент — типы и api**

`web/src/types.ts`, `ClientMessage` (после варианта `respond-proposal` с q/r) добавить:

```ts
  | { type: 'respond-proposal'; playerId: number; accept: boolean }
```

`web/src/api.ts` (после `sendRespondProposal`):

```ts
  sendRespondProposalTo(playerId: number, accept: boolean): void {
    this.send({ type: 'respond-proposal', playerId, accept });
  }
```

- [ ] **Step 5: i18n-ключи в `web/src/i18n.ts`**

В блок `en` после `'cm.alreadyAlliance': 'already allied',` добавить:

```ts
    'diplomacy.proposes': '{name} proposes {kind}',
    'diplomacy.peace': 'peace',
    'diplomacy.alliance': 'alliance',
    'diplomacy.accept': 'Accept',
    'diplomacy.decline': 'Decline',
```

В блок `ru` после `'cm.alreadyAlliance': 'уже союз',` добавить:

```ts
    'diplomacy.proposes': '{name} предлагает {kind}',
    'diplomacy.peace': 'мир',
    'diplomacy.alliance': 'союз',
    'diplomacy.accept': 'Принять',
    'diplomacy.decline': 'Отклонить',
```

- [ ] **Step 6: Панель в `web/src/App.vue`**

В `<script setup>` (после `incomingProposals`-логики нет — добавить после `incomingProposals` рядом с другими computed, например после `createOptions`):

```ts
const incomingProposals = computed(() => {
  const g = game.value;
  if (!g || playerId.value === null) return [];
  return g.pendingProposals.filter((p) => p.to === playerId.value);
});

function proposalName(id: number): string {
  return game.value?.players.find((p) => p.id === id)?.name ?? `#${id}`;
}

function respondProposal(from: number, accept: boolean): void {
  client.sendRespondProposalTo(from, accept);
}
```

В шаблоне, внутри `game-screen` (после `<Hud .../>`, строка ~645) добавить:

```html
        <div v-if="incomingProposals.length && !room.loadTest" class="diplomacy-panel">
          <div v-for="p in incomingProposals" :key="p.from" class="diplomacy-panel__row">
            <span class="diplomacy-panel__text">
              {{ t('diplomacy.proposes', { name: proposalName(p.from), kind: p.kind === 'peace' ? t('diplomacy.peace') : t('diplomacy.alliance') }) }}
            </span>
            <button class="diplomacy-panel__btn" @click="respondProposal(p.from, true)">{{ t('diplomacy.accept') }}</button>
            <button class="diplomacy-panel__btn diplomacy-panel__btn--ghost" @click="respondProposal(p.from, false)">{{ t('diplomacy.decline') }}</button>
          </div>
        </div>
```

В `<style scoped>` добавить:

```css
.diplomacy-panel {
  position: fixed;
  top: 130px;
  left: 16px;
  z-index: 25;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 420px;
}

.diplomacy-panel__row {
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(0, 0, 0, 0.78);
  border: 1px solid #7cb342;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 14px;
  color: #fff;
}

.diplomacy-panel__text {
  flex: 1;
}

.diplomacy-panel__btn {
  padding: 5px 12px;
  border: none;
  border-radius: 6px;
  background: #2e7d32;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.diplomacy-panel__btn--ghost {
  background: #2a2a31;
  border: 1px solid #555;
}

.diplomacy-panel__btn:hover {
  filter: brightness(1.15);
}
```

- [ ] **Step 7: Прогнать тесты сервера и сборку клиента**

Run (в `server/`): `npm test`
Expected: PASS.
Run (в `web/`): `npm run build`
Expected: без ошибок.

- [ ] **Step 8: Коммит**

```bash
git add server/src/rooms.ts server/src/ws.ts server/test/rooms.test.ts web/src/types.ts web/src/api.ts web/src/App.vue web/src/i18n.ts
git commit -m "feat: панель дипломатии — принять/отклонить союз и мир"
```

---

## Self-Review

**Spec coverage:**
- Логин по паролю, Google убран → Task 6 (сервер) + Task 7 (клиент).
- Фидбек (проводка, админ-роуты, модалка, вкладка, фикс теста) → Task 8 + Task 9.
- Войны ИИ через зазор + союз без территории → Task 3.
- Карта обучения 9×7 → Task 1 (DEFAULT_MAPS) + Task 5 (клиент).
- Панель дипломатии → Task 10.
- Доход по террейну → Task 2 (сервер) + Task 4 (клиентские подписи).
- Карты в БД (таблица, кэш, сид, GET /api/admin/maps) → Task 1.
- 3 новые карты → Task 1 (определения) + Task 5 (клиентские подписи/переводы).

**Placeholder scan:** весь код приведён; нет TBD/TODO.

**Type consistency:**
- `generateMap(def: MapDefinition)` — Task 1 определяет, Task 1 же обновляет всех вызывающих (rooms.ts, тесты).
- `getMap(key)/setMapCatalog/listMaps` — Task 1, используются в rooms.ts/admin.ts.
- `parseSessionToken/signSessionToken/verifySessionToken` — Task 6 определяет, auth-routes и rooms.ts используют те же имена.
- `registerAuthRoutes(app, users)` — Task 6.
- `registerAdminRoutes(app, manager, dumps, adminCreds, users, feedback)` — Task 8 меняет сигнатуру, admin-http.test.ts обновляется там же.
- `INCOME_BY_TERRAIN` / `TERRAIN_INCOMES` — Task 2 / Task 4 (сервер/клиент раздельно, как TERRAIN_COSTS).
- `respond-proposal` с `playerId` — Task 10: rooms.ts принимает, ws.ts прокидывает, api.ts отправляет, types.ts описывает.
- `MapType` на сервере — `string`; на клиенте — union 8 ключей (Task 5).