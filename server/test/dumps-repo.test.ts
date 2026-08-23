import { describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';
import { DumpsRepository } from '../src/db.js';

interface FakeDump {
  roomId: number;
  roomName: string;
  mapType: string;
  note: string | null;
  state: unknown;
  auto: boolean;
}

function makeRepo(): { repo: DumpsRepository; rows: FakeDump[] } {
  const rows: FakeDump[] = [];
  const fakeRepo = {
    save: async (e: FakeDump): Promise<FakeDump> => {
      rows.push({ ...e });
      return e;
    },
    find: async (): Promise<FakeDump[]> => [...rows],
  };
  const dataSource = { getRepository: () => fakeRepo } as unknown as DataSource;
  return { repo: new DumpsRepository(dataSource), rows };
}

describe('DumpsRepository', () => {
  it('save: auto по умолчанию false, пробрасывается явный auto', async () => {
    const { repo, rows } = makeRepo();
    await repo.save({ roomId: 1, roomName: 'R', mapType: 'normal', note: null, state: { x: 1 } });
    await repo.save({ roomId: 2, roomName: 'R2', mapType: 'normal', note: null, state: {}, auto: true });
    expect(rows[0].auto).toBe(false);
    expect(rows[1].auto).toBe(true);
  });
  it('list возвращает auto в строках', async () => {
    const { repo, rows } = makeRepo();
    rows.push({ roomId: 1, roomName: 'R', mapType: 'normal', note: null, state: {}, auto: true });
    const list = await repo.list();
    expect(list[0].auto).toBe(true);
  });
});