# Память ассистента (agent-driven графовая память) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Постоянная графовая память ассистента на Neo4j: агент пишет/ищет факты через MCP-инструменты (LLM не нужен — извлечение и поиск делает сам агент на подписке opencode), пользователь изучает граф в Neo4j Browser по `http://localhost:7474`.

**Architecture:** Neo4j Community (docker compose) — хранилище графа; маленький MCP-сервер (`memory/mcp-server`, Node/TS) с инструментами `memory_add` / `memory_search` / `memory_related`, подключается в `opencode.json`; скрипт сида `memory/mcp-server/src/seed.ts` наполняет граф фактами о проекте conquest. Векторных эмбеддингов на сервере нет — семантику даёт агент.

**Tech Stack:** Node 26, TypeScript (NodeNext), `@modelcontextprotocol/sdk@^1`, `neo4j-driver@^6`, `zod`, vitest; Neo4j 5 Community.

## Global Constraints

- Node >= 20 (среда: v26.7.0).
- Новые npm-зависимости только в `memory/mcp-server`: `neo4j-driver`, `@modelcontextprotocol/sdk`, `zod`; dev: `typescript`, `@types/node`, `vitest`. В `web/` и `server/` ничего не добавляем.
- Нео4j только локально; креды `neo4j/memorydev123` — локальные, не публиковать; настройки портов `7474` (http/Browser) и `7687` (bolt).
- Проверка памяти: `cd memory/mcp-server && npm test`; регрессия проекта: `cd server && npm test` и `cd web && npm run build`.
- Имена тестов (`it('по-русски', ...)`) и комментарии — по русски; конфиг и код — по-английски/нейтрально.
- После каждого таска — коммит.

---

### Task 1: Neo4j через docker compose + .gitignore

**Files:**
- Create: `memory/docker-compose.yml`
- Modify: `.gitignore` (корень репо)

**Interfaces:**
- Consumes: ничего.
- Produces: Neo4j, доступный по `bolt://localhost:7687` (креды `neo4j/memorydev123`) и Browser по `http://localhost:7474`.

- [ ] **Step 1: Создать `memory/docker-compose.yml`**

```yaml
services:
  neo4j:
    image: neo4j:5-community
    container_name: conquest-memory-neo4j
    ports:
      - "127.0.0.1:7474:7474"
      - "127.0.0.1:7687:7687"
    environment:
      NEO4J_AUTH: neo4j/memorydev123
      NEO4J_server_memory_heap_max__size: "512m"
    volumes:
      - ./neo4j-data:/data
      - ./neo4j-logs:/logs
    restart: unless-stopped
```

- [ ] **Step 2: Добавить пути в `.gitignore`**

В конец `.gitignore` добавить:

```
memory/neo4j-data/
memory/neo4j-logs/
```

(`node_modules/` и `dist/` уже игнорируются глобально.)

- [ ] **Step 3: Поднять и проверить**

```bash
docker compose -f memory/docker-compose.yml up -d
docker compose -f memory/docker-compose.yml ps
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:7474
```

Expected: контейнер `STATUS Up`, curl возвращает `200`.

- [ ] **Step 4: Commit**

```bash
git add memory/docker-compose.yml .gitignore
git commit -m "feat: Neo4j для графовой памяти (docker compose + gitignore)"
```

---

### Task 2: MCP-сервер — graph-модуль (TDD)

**Files:**
- Create: `memory/mcp-server/package.json`
- Create: `memory/mcp-server/tsconfig.json`
- Create: `memory/mcp-server/src/graph.ts`
- Create: `memory/mcp-server/test/graph.test.ts`

**Interfaces:**
- Consumes: Neo4j из Task 1.
- Produces: `GraphStore` с методами `init()`, `addMemory(input): Promise<string>`, `search(query, project?, limit?): Promise<MemoryRecord[]>`, `related(name): Promise<RelatedResult>`; типы `MemoryInput`, `MemoryRecord`, `RelatedResult`, `Runner`, `Row`.

- [ ] **Step 1: Создать `memory/mcp-server/package.json`**

```json
{
  "name": "agent-memory-mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.30.0",
    "neo4j-driver": "^6.2.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "typescript": "^5.5.4",
    "vitest": "^2.1.9"
  }
}
```

- [ ] **Step 2: Создать `memory/mcp-server/tsconfig.json`**

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
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Написать падающие тесты `memory/mcp-server/test/graph.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { GraphStore, type Row, type Runner } from '../src/graph.js';

function fakeStore(
  handler: (q: string, p: Record<string, unknown>) => Row | Row[],
): { store: GraphStore; calls: { q: string; p: Record<string, unknown> }[] } {
  const calls: { q: string; p: Record<string, unknown> }[] = [];
  const runner: Runner = async (q, p) => {
    calls.push({ q, p });
    const out = handler(q, p);
    return Array.isArray(out) ? out : [out];
  };
  return { store: new GraphStore(runner), calls };
}

describe('GraphStore', () => {
  it('init создаёт constraint и fulltext индекс', async () => {
    const { store, calls } = fakeStore(() => []);
    await store.init();
    expect(calls).toHaveLength(2);
    expect(calls[0].q).toContain('CREATE CONSTRAINT entity_name');
    expect(calls[1].q).toContain('CREATE FULLTEXT INDEX fts_memory');
  });

  it('addMemory возвращает созданный id и передаёт текст/сущности', async () => {
    const { store, calls } = fakeStore((q, p) => (q.includes('RETURN m.id') ? [{ id: p['id'] }] : []));
    const id = await store.addMemory({
      text: 'Проект на Vue 3',
      entities: ['Conquest', 'Vue 3'],
      kind: 'fact',
      project: 'conquest',
      relations: [{ type: 'depends_on', from: 'Conquest', to: 'Vue 3' }],
    });
    expect(id).toBeTruthy();
    const call = calls.find((c) => c.q.includes('RETURN m.id'))!;
    expect(call.p['text']).toBe('Проект на Vue 3');
    expect(call.p['entities']).toEqual(['Conquest', 'Vue 3']);
    expect(call.p['kind']).toBe('fact');
    expect(call.p['project']).toBe('conquest');
  });

  it('addMemory использует переданный id для идемпотентного сида', async () => {
    const { store, calls } = fakeStore((q, p) => [{ id: p['id'] }]);
    const id = await store.addMemory({ text: 'x', id: 'seed-1' });
    expect(id).toBe('seed-1');
    const call = calls.find((c) => c.q.includes('RETURN m.id'))!;
    expect(call.p['id']).toBe('seed-1');
  });

  it('search маппит строки; проект и лимит передаются', async () => {
    const rows: Row[] = [
      { text: 'Крепость защищает гекс', kind: 'fact', project: 'conquest', createdAt: '2026-08-17', score: 1.2 },
      { text: 'Вторая', kind: 'note', project: null, createdAt: null, score: 0.4 },
    ];
    const { store } = fakeStore(() => rows);
    const out = await store.search('крепость');
    expect(out).toHaveLength(2);
    expect(out[0].text).toBe('Крепость защищает гекс');
    expect(out[0].score).toBe(1.2);
    expect(out[1].project).toBeNull();
  });

  it('related возвращает сущность, связи и воспоминания', async () => {
    const { store } = fakeStore(() => [
      { entity: 'Conquest', relations: [{ peer: 'Vue 3', rel: 'depends_on' }], memories: ['Проект на Vue 3'] },
    ]);
    const out = await store.related('Conquest');
    expect(out.entity).toBe('Conquest');
    expect(out.relations).toEqual([{ peer: 'Vue 3', rel: 'depends_on' }]);
    expect(out.memories).toEqual(['Проект на Vue 3']);
  });
});
```

- [ ] **Step 4: Запустить тесты — убедиться, что падают**

Run: `cd memory/mcp-server && npm install && npm test`
Expected: FAIL «Cannot find module '../src/graph.js'» (ещё нет модуля). Это правильное падение.

- [ ] **Step 5: Реализовать `memory/mcp-server/src/graph.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { Driver, Session } from 'neo4j-driver';

export interface MemoryInput {
  text: string;
  entities?: string[];
  kind?: 'fact' | 'decision' | 'preference' | 'note';
  project?: string;
  source?: string;
  relations?: { type: string; from: string; to: string }[];
  id?: string;
}

export interface MemoryRecord {
  text: string;
  kind: string | null;
  project: string | null;
  createdAt: string | null;
  score?: number;
}

export interface RelatedResult {
  entity: string;
  relations: { peer: string | null; rel: string | null }[];
  memories: string[];
}

export type Row = Record<string, unknown>;
export type Runner = (query: string, params: Record<string, unknown>) => Promise<Row[]>;

export class GraphStore {
  constructor(private readonly run: Runner) {}

  static fromDriver(driver: Driver): GraphStore {
    let session: Session | null = null;
    return new GraphStore(async (query, params) => {
      if (!session) session = driver.session();
      const result = await session.run(query, params);
      return result.records.map((record) => record.toObject());
    });
  }

  async init(): Promise<void> {
    await this.run(
      'CREATE CONSTRAINT entity_name IF NOT EXISTS FOR (e:Entity) REQUIRE e.name IS UNIQUE',
      {},
    );
    await this.run(
      'CREATE FULLTEXT INDEX fts_memory IF NOT EXISTS FOR (m:Memory) ON EACH [m.text]',
      {},
    );
  }

  async addMemory(input: MemoryInput): Promise<string> {
    const id = input.id ?? randomUUID();
    await this.run(
      `MERGE (m:Memory {id: $id})
       SET m.text = $text,
           m.kind = $kind,
           m.project = $project,
           m.source = $source,
           m.createdAt = $createdAt
       WITH m
       UNWIND $entities AS en
       WITH m, en WHERE en IS NOT NULL
       MERGE (e:Entity {name: en})
       SET e.type = 'concept'
       MERGE (e)-[:RECALLS]->(m)
       MERGE (m)-[:ABOUT]->(e)
       WITH m
       UNWIND $relations AS rel
       WITH m, rel WHERE rel.from IS NOT NULL AND rel.to IS NOT NULL
       MATCH (a:Entity {name: rel.from}), (b:Entity {name: rel.to})
       MERGE (a)-[r:REL {type: rel.type}]->(b)
       RETURN m.id`,
      {
        id,
        text: input.text,
        kind: input.kind ?? 'note',
        project: input.project ?? null,
        source: input.source ?? null,
        createdAt: new Date().toISOString(),
        entities: input.entities ?? [],
        relations: input.relations ?? [],
      },
    );
    return id;
  }

  async search(query: string, project?: string | null, limit = 8): Promise<MemoryRecord[]> {
    const rows = await this.run(
      `CALL db.index.fulltext.queryNodes('fts_memory', $q) YIELD node, score
       WHERE $project IS NULL OR node.project = $project
       RETURN node.text AS text, node.kind AS kind, node.project AS project,
              node.createdAt AS createdAt, score
       ORDER BY score DESC
       LIMIT $limit`,
      { q: query, project: project ?? null, limit },
    );
    return rows.map((r) => ({
      text: String(r.text),
      kind: r.kind == null ? null : String(r.kind),
      project: r.project == null ? null : String(r.project),
      createdAt: r.createdAt == null ? null : String(r.createdAt),
      score: typeof r.score === 'number' ? r.score : undefined,
    }));
  }

  async related(name: string): Promise<RelatedResult> {
    const rows = await this.run(
      `MATCH (e:Entity {name: $name})
       OPTIONAL MATCH (e)-[rel]-(peer)
       OPTIONAL MATCH (e)-[:ABOUT]->(m:Memory)
       RETURN e.name AS entity,
              collect(DISTINCT {peer: peer.name, rel: type(rel)}) AS relations,
              collect(DISTINCT m.text) AS memories`,
      { name },
    );
    const row = rows[0];
    if (!row) return { entity: name, relations: [], memories: [] };
    const relations = Array.isArray(row.relations)
      ? (row.relations as unknown[]).map((r) => {
          const item = r as { peer?: unknown; rel?: unknown };
          return { peer: item.peer == null ? null : String(item.peer), rel: item.rel == null ? null : String(item.rel) };
        })
      : [];
    const memories = Array.isArray(row.memories) ? (row.memories as unknown[]).map((m) => String(m)) : [];
    return { entity: String(row.entity), relations, memories };
  }
}
```

- [ ] **Step 6: Запустить тесты — PASS**

Run: `cd memory/mcp-server && npm test`
Expected: 5 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add memory/mcp-server
git commit -m "feat: память — graph-модуль (GraphStore: addMemory/search/related на Neo4j)"
```

---

### Task 3: MCP-сервер — инструменты и точка входа

**Files:**
- Create: `memory/mcp-server/src/tools.ts`
- Create: `memory/mcp-server/src/index.ts`
- Create: `memory/mcp-server/test/tools.test.ts`

**Interfaces:**
- Consumes: `GraphStore`, `MemoryInput` из Task 2.
- Produces: `memoryAdd(store, args): Promise<{id:string}>`, `memorySearch(store, args): Promise<{query:string; results:MemoryRecord[]}>`, `memoryRelated(store, args): Promise<RelatedResult>`; MCP-сервер с инструментами `memory_add`/`memory_search`/`memory_related` по stdio.

- [ ] **Step 1: Написать падающие тесты `memory/mcp-server/test/tools.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import type { GraphStore } from '../src/graph.js';
import { memoryAdd, memoryRelated, memorySearch } from '../src/tools.js';

function stubStore(methods: Partial<GraphStore>): GraphStore {
  return methods as unknown as GraphStore;
}

describe('tools', () => {
  it('memoryAdd возвращает id', async () => {
    const store = stubStore({ addMemory: async () => 'abc' });
    const out = await memoryAdd(store, { text: 'тест', entities: ['A'] });
    expect(out.id).toBe('abc');
  });

  it('memorySearch нормирует limit и убирает пустой project', async () => {
    let got: { q: string; project: string | null; limit: number } | undefined;
    const store = stubStore({
      search: async (q, project, limit) => {
        got = { q, project, limit };
        return [];
      },
    });
    const out = await memorySearch(store, { query: 'fortress', project: '  ', limit: 100 });
    expect(got).toEqual({ q: 'fortress', project: null, limit: 25 });
    expect(out.results).toEqual([]);
  });

  it('memoryRelated отдаёт результат по сущности', async () => {
    const store = stubStore({
      related: async () => ({ entity: 'Conquest', relations: [], memories: ['m'] }),
    });
    const out = await memoryRelated(store, { entity: 'Conquest' });
    expect(out.entity).toBe('Conquest');
    expect(out.memories).toEqual(['m']);
  });
});
```

- [ ] **Step 2: Run — FAIL**

Run: `cd memory/mcp-server && npm test`
Expected: «Cannot find module '../src/tools.js'».

- [ ] **Step 3: Реализовать `memory/mcp-server/src/tools.ts`**

```ts
import type { GraphStore, MemoryInput, MemoryRecord, RelatedResult } from './graph.js';

export interface AddMemoryArgs {
  text: string;
  entities?: string[];
  kind?: 'fact' | 'decision' | 'preference' | 'note';
  project?: string;
  source?: string;
  relations?: { type: string; from: string; to: string }[];
}

export interface SearchArgs {
  query: string;
  project?: string;
  limit?: number;
}

export interface RelatedArgs {
  entity: string;
}

export async function memoryAdd(store: GraphStore, args: AddMemoryArgs): Promise<{ id: string }> {
  const input: MemoryInput = {
    text: args.text,
    entities: args.entities ?? [],
    kind: args.kind ?? 'note',
    project: args.project ?? 'agent',
    source: args.source ?? 'session',
    relations: args.relations ?? [],
  };
  const id = await store.addMemory(input);
  return { id };
}

export async function memorySearch(
  store: GraphStore,
  args: SearchArgs,
): Promise<{ query: string; results: MemoryRecord[] }> {
  const project = args.project && args.project.trim().length > 0 ? args.project : null;
  const limit = Math.min(Math.max(args.limit ?? 8, 1), 25);
  const results = await store.search(args.query, project, limit);
  return { query: args.query, results };
}

export async function memoryRelated(store: GraphStore, args: RelatedArgs): Promise<RelatedResult> {
  return store.related(args.entity);
}
```

- [ ] **Step 4: Run — PASS**

Run: `cd memory/mcp-server && npm test`
Expected: 8 tests PASS.

- [ ] **Step 5: Реализовать `memory/mcp-server/src/index.ts` (точка входа MCP)**

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import neo4j from 'neo4j-driver';
import { z } from 'zod';
import { GraphStore } from './graph.js';
import { memoryAdd, memoryRelated, memorySearch } from './tools.js';

const uri = process.env.NEO4J_URI ?? 'bolt://localhost:7687';
const user = process.env.NEO4J_USER ?? 'neo4j';
const password = process.env.NEO4J_PASSWORD ?? 'memorydev123';

const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
const store = GraphStore.fromDriver(driver);
await store.init();

const server = new McpServer({ name: 'agent-memory', version: '0.1.0' });

server.registerTool(
  'memory_add',
  {
    title: 'Add a memory',
    description:
      'Store a durable fact about a project, a decision, a preference or a note in the agent memory graph. ' +
      'Provide entities (names of involved subjects/objects), an optional kind and project, and optional typed relations between entities.',
    inputSchema: {
      text: z.string().describe('The fact to remember'),
      entities: z.array(z.string()).optional().describe('Entity names linked to this fact'),
      kind: z.enum(['fact', 'decision', 'preference', 'note']).optional(),
      project: z.string().optional().describe('Project this fact belongs to'),
      source: z.string().optional(),
      relations: z
        .array(z.object({ type: z.string(), from: z.string(), to: z.string() }))
        .optional()
        .describe('Typed relations between entities: Entity(from) -[type]-> Entity(to)'),
    },
  },
  async (args) => {
    const { id } = await memoryAdd(store, args);
    return { content: [{ type: 'text', text: JSON.stringify({ id }) }] };
  },
);

server.registerTool(
  'memory_search',
  {
    title: 'Search memory',
    description: 'Full-text search over stored memories, optionally filtered by project.',
    inputSchema: {
      query: z.string(),
      project: z.string().optional(),
      limit: z.number().int().min(1).max(25).optional(),
    },
  },
  async (args) => {
    const out = await memorySearch(store, args);
    return { content: [{ type: 'text', text: JSON.stringify(out) }] };
  },
);

server.registerTool(
  'memory_related',
  {
    title: 'Inspect an entity',
    description: "Show an entity, its relations to other entities, and the memories about it.",
    inputSchema: { entity: z.string() },
  },
  async (args) => {
    const out = await memoryRelated(store, args);
    return { content: [{ type: 'text', text: JSON.stringify(out) }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 6: Собрать и smoke-проверить MCP по stdio**

```bash
cd memory/mcp-server && npm run build
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  | node dist/index.js
```

Expected: в stdout ответ с `"result":{"capabilities":{"tools":...}}` (сервер завёл соединение с Neo4j из Task 1 и ответил initialize).

- [ ] **Step 7: Commit**

```bash
git add memory/mcp-server
git commit -m "feat: память — MCP-сервер (memory_add/search/related по stdio)"
```

---

### Task 4: Подключение к opencode (opencode.json)

**Files:**
- Create: `opencode.json` (корень репо)

**Interfaces:**
- Consumes: `memory/mcp-server/dist/index.js` из Task 3.
- Produces: инструменты `memory_add` / `memory_search` / `memory_related` у ассистента.

- [ ] **Step 1: Создать `opencode.json`**

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "memory": {
        "type": "local",
        "command": ["node", "memory/mcp-server/dist/index.js"],
        "cwd": ".",
        "environment": {
          "NEO4J_URI": "bolt://localhost:7687",
          "NEO4J_USER": "neo4j",
          "NEO4J_PASSWORD": "memorydev123"
        },
        "codemode": false
      }
    }
  }
}
```

Примечание: `codemode: false` — инструменты видны в нативном списке инструментов (в этой среде Code Mode не активен).

- [ ] **Step 2: Проверить конфиг валиден**

```bash
node -e "JSON.parse(require('fs').readFileSync('opencode.json','utf8')); console.log('ok')"
```

Expected: `ok`.

- [ ] **Step 3: Перезапустить сервис opencode, чтобы MCP подхватился**

```bash
opencode2 service restart
opencode2 mcp list
```

Expected: в списке `memory` (появится после рестарта). Если `opencode2` недоступен в текущей оболочке — пометить как «нужен рестарт вручную» и перейти дальше (код уже готов).

- [ ] **Step 4: Commit**

```bash
git add opencode.json
git commit -m "feat: подключение MCP memory в opencode"
```

---

### Task 5: Сид conquest

**Files:**
- Create: `memory/mcp-server/src/facts.ts`
- Create: `memory/mcp-server/src/seed.ts`
- Create: `memory/mcp-server/test/facts.test.ts`

**Interfaces:**
- Consumes: `GraphStore`, `MemoryInput` из Task 2.
- Produces: `SEED_FACTS: MemoryInput[]` и `seed.ts` (CLI, идемпотентный: id = `seed-` + sha1(project|kind|text)).

- [ ] **Step 1: Написать падающие тесты `memory/mcp-server/test/facts.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { SEED_FACTS } from '../src/facts.js';

describe('SEED_FACTS', () => {
  it('каждый факт имеет текст и сущности', () => {
    for (const f of SEED_FACTS) {
      expect(f.text.trim().length).toBeGreaterThan(0);
      expect((f.entities ?? []).length).toBeGreaterThan(0);
    }
  });

  it('нет дублей текста внутри проекта', () => {
    const keys = SEED_FACTS.map((f) => `${f.project ?? ''}|${f.kind ?? ''}|${f.text}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
```

- [ ] **Step 2: Run — FAIL**

Run: `cd memory/mcp-server && npm test`
Expected: «Cannot find module '../src/facts.js'».

- [ ] **Step 3: Реализовать `memory/mcp-server/src/facts.ts`**

```ts
import type { MemoryInput } from './graph.js';

function fact(input: Omit<MemoryInput, 'kind'> & { kind?: MemoryInput['kind'] }): MemoryInput {
  return { project: 'conquest', kind: 'fact', ...input };
}

export const SEED_FACTS: MemoryInput[] = [
  fact({
    text: 'Conquest — real-time стратегия: захват гексов на гексагональной карте в реальном времени (без ходов).',
    entities: ['Conquest'],
  }),
  fact({
    text: 'Клиент на Vue 3 (<script setup>), TypeScript, Vite; сборка: vue-tsc -b && vite build.',
    entities: ['Conquest', 'Vue 3', 'TypeScript', 'Vite'],
    relations: [
      { type: 'depends_on', from: 'Conquest', to: 'Vue 3' },
      { type: 'depends_on', from: 'Conquest', to: 'TypeScript' },
      { type: 'depends_on', from: 'Conquest', to: 'Vite' },
    ],
  }),
  fact({
    text: 'Сервер на Node.js + ws (WebSocket), TypeScript; тесты — vitest; компиляция — tsc.',
    entities: ['Conquest', 'Server', 'Node.js', 'ws', 'vitest'],
    relations: [
      { type: 'depends_on', from: 'Server', to: 'Node.js' },
      { type: 'depends_on', from: 'Server', to: 'ws' },
      { type: 'uses', from: 'Server', to: 'vitest' },
    ],
  }),
  fact({
    text: 'Деплой через Docker (docker-compose, docker-compose.prod.yml).',
    entities: ['Conquest', 'Docker'],
    relations: [{ type: 'deploys_with', from: 'Conquest', to: 'Docker' }],
  }),
  fact({
    text: 'Правило: захват нейтрального гекса стоит очки по стоимости террейна (grass 150, desert 200, forest 250, water 350, mountain/mine 450).',
    entities: ['Conquest', 'terrain'],
  }),
  fact({
    text: 'Правило: атака вражеского гекса возможна только после объявления войны.',
    entities: ['Conquest', 'war'],
  }),
  fact({
    text: 'Правило: битва решается вложениями очков — перевес атаки/защиты забирает гекс.',
    entities: ['Conquest', 'battle'],
  }),
  fact({
    text: 'Правило: крепость защищает свой гекс и 6 соседних гексов своего владельца (радиус 1).',
    entities: ['Conquest', 'fortress'],
  }),
  fact({
    text: 'Правило: потеря столицы = выбывание; отрезанная от столицы территория становится нейтральной.',
    entities: ['Conquest', 'capital'],
  }),
  fact({
    text: 'Дипломатия: война/мир/союз; действуют предложения peace/alliance между игроками.',
    entities: ['Conquest', 'diplomacy', 'peace', 'alliance'],
  }),
  fact({
    text: 'Режим «Обучение»: соло против лёгкого ИИ; машина из 6 этапов на клиенте (capture, attack, defend, fortress, diplomacy, done) с паузой на каждом этапе.',
    entities: ['Conquest', 'training'],
  }),
  fact({
    text: 'Нагрузочный тест: комната с N ИИ (5/10/20/30) на круглой карте round.',
    entities: ['Conquest', 'load test'],
  }),
  fact({
    text: 'UI имеет языки EN/RU, по умолчанию английский; сервер всегда на английском.',
    entities: ['Conquest', 'i18n'],
  }),
  fact({
    text: 'ИИ расширяет территорию компактно: избегает тонких коридоров шириной в одну клетку — их легко отрезать соседям.',
    entities: ['Conquest', 'AI'],
  }),
  fact({ text: 'Пользователь общается с ассистентом по-русски.', entities: ['user'], kind: 'preference' }),
  fact({ text: 'Пользователь предпочитает серверные строки на английском языке.', entities: ['user'], kind: 'preference' }),
];
```

- [ ] **Step 4: Run — PASS**

Run: `cd memory/mcp-server && npm test`
Expected: 10 tests PASS.

- [ ] **Step 5: Реализовать `memory/mcp-server/src/seed.ts`**

```ts
import { createHash } from 'node:crypto';
import neo4j from 'neo4j-driver';
import { GraphStore, type MemoryInput } from './graph.js';
import { SEED_FACTS } from './facts.js';

const uri = process.env.NEO4J_URI ?? 'bolt://localhost:7687';
const user = process.env.NEO4J_USER ?? 'neo4j';
const password = process.env.NEO4J_PASSWORD ?? 'memorydev123';

function seedId(input: MemoryInput): string {
  const hash = createHash('sha1').update([input.project, input.kind, input.text].join('|')).digest('hex');
  return `seed-${hash.slice(0, 16)}`;
}

async function main(): Promise<void> {
  const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  try {
    const store = GraphStore.fromDriver(driver);
    await store.init();
    for (const input of SEED_FACTS) {
      await store.addMemory({ ...input, id: seedId(input) });
    }
    console.log(`Seeded ${SEED_FACTS.length} facts (idempotent upsert)`);
  } finally {
    await driver.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 6: Собрать и прогнать сид**

```bash
cd memory/mcp-server && npm run build && node dist/seed.js
```

Expected: `Seeded 16 facts (idempotent upsert)`. Повторный запуск даёт ту же цифру без дублей.

- [ ] **Step 7: Проверить поиск по реальной БД**

```bash
node --input-type=module -e "
import neo4j from 'neo4j-driver';
import { GraphStore } from './memory/mcp-server/dist/graph.js';
const d = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j','memorydev123'));
const s = GraphStore.fromDriver(d);
console.log(JSON.stringify((await s.search('fortress', 'conquest', 5)).map(r => r.text), null, 1));
console.log(JSON.stringify(await s.related('Conquest')));
await d.close();
"
```

Expected: найден факт про крепость; у «Conquest» есть связи/воспоминания.

- [ ] **Step 8: Commit**

```bash
git add memory/mcp-server
git commit -m "feat: память — сид conquest (16 фактов) и идемпотентный seed.ts"
```

---

### Task 6: E2E smoke + регрессия

**Files:** (только проверки, новых файлов нет)

**Interfaces:**
- Consumes: всё выше.

- [ ] **Step 1: Проверить, что проект conquest не сломан**

```bash
cd server && npm test
cd web && npm run build
```

Expected: серверные тесты PASS (204), сборка web чистая.

- [ ] **Step 2: Убедиться, что MCP-инструменты у ассистента**

После рестарта opencode (Task 4) у ассистента в списке инструментов должны быть `memory_add`, `memory_search`, `memory_related`. Проверить через ответ MCP-сервера:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"check","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | node memory/mcp-server/dist/index.js
```

Expected: ответ `tools/list` содержит `memory_add`, `memory_search`, `memory_related`.

- [ ] **Step 3: Визуальный осмотр графа (пользователь)**

Открыть `http://localhost:7474`, войти `neo4j/memorydev123`, набрать `MATCH (n) RETURN n LIMIT 200` — граф с 16 фактами и связанными сущностями. (Это пункт «изучать, что знает ассистент»; выполняется вручную.)

- [ ] **Step 4: Финальный статус**

```bash
git status --short
```

Expected: только оставшиеся до этого незакоммиченные изменения пользователя (не из этого плана). Всё из плана закоммичено.

---
