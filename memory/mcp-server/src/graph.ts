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
