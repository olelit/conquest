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
