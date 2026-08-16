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
