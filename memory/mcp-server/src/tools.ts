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
