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
