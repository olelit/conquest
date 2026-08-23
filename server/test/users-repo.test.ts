import { describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';
import { UserEntity, UsersRepository } from '../src/db.js';

interface FakeUser {
  sub: string;
  email: string;
  name: string;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
}

function makeRepo(): { repo: UsersRepository; rows: FakeUser[]; calls: string[] } {
  const rows: FakeUser[] = [];
  const calls: string[] = [];
  const fakeRepo = {
    findOneBy: async ({ sub }: { sub: string }): Promise<FakeUser | null> => rows.find((r) => r.sub === sub) ?? null,
    save: async (e: FakeUser): Promise<FakeUser> => {
      calls.push(rows.some((r) => r.sub === e.sub) ? 'update' : 'insert');
      const existing = rows.find((r) => r.sub === e.sub);
      if (existing) Object.assign(existing, e);
      else rows.push({ ...e });
      return e;
    },
    find: async (): Promise<FakeUser[]> => [...rows],
  };
  const dataSource = { getRepository: () => fakeRepo } as unknown as DataSource;
  return { repo: new UsersRepository(dataSource), rows, calls };
}

describe('UsersRepository', () => {
  it('upsertBySub: первый вход — insert с first_seen_at', async () => {
    const { repo, rows, calls } = makeRepo();
    await repo.upsertBySub('s1', 'a@x.com', 'A');
    expect(calls).toEqual(['insert']);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sub: 's1', email: 'a@x.com', name: 'A' });
    expect(rows[0].firstSeenAt).toBeInstanceOf(Date);
    expect(rows[0].lastSeenAt).toBeInstanceOf(Date);
  });
  it('upsertBySub: повторный вход — update, first_seen_at сохраняется', async () => {
    const { repo, rows, calls } = makeRepo();
    await repo.upsertBySub('s1', 'a@x.com', 'A');
    const firstSeen = rows[0].firstSeenAt;
    await repo.upsertBySub('s1', 'b@x.com', 'B');
    expect(calls).toEqual(['insert', 'update']);
    expect(rows[0]).toMatchObject({ sub: 's1', email: 'b@x.com', name: 'B' });
    expect(rows[0].firstSeenAt).toBe(firstSeen);
    expect(rows[0].lastSeenAt).toBeInstanceOf(Date);
  });
  it('list возвращает все записи', async () => {
    const { repo } = makeRepo();
    await repo.upsertBySub('s1', 'a@x.com', 'A');
    await repo.upsertBySub('s2', 'b@x.com', 'B');
    expect((await repo.list()).map((u) => u.sub)).toEqual(['s1', 's2']);
  });
});