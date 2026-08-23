import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerAdminRoutes } from '../src/admin.js';
import { hashPassword } from '../src/password.js';

let server: ReturnType<typeof createServer>;
let base = '';
let cookie = '';

beforeAll(async () => {
  const stored = { id: 1, username: 'admin', passwordHash: await hashPassword('admin'), sessionSecret: 'test-secret' };
  const adminCreds = {
    get: async () => stored,
    updateCredentials: async (username: string, passwordHash: string) => {
      stored.username = username;
      stored.passwordHash = passwordHash;
    },
  };
  const app = express();
  app.use(express.json());
  const usersStub = {
    list: async () => [
      { id: 1, sub: 's1', email: 'a@x.com', name: 'A', firstSeenAt: new Date('2026-08-01'), lastSeenAt: new Date('2026-08-02') },
      { id: 2, sub: 's2', email: 'b@x.com', name: 'B', firstSeenAt: new Date('2026-08-03'), lastSeenAt: new Date('2026-08-04') },
    ],
  };
  registerAdminRoutes(app, {} as never, {} as never, adminCreds as never, usersStub as never);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const res = await fetch(`${base}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin' }),
  });
  expect(res.status).toBe(200);
  cookie = res.headers.get('set-cookie')!.split(';')[0];
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('admin HTTP: /api/admin', () => {
  it('me подтверждает сессию по cookie', async () => {
    const me = (await (await fetch(`${base}/api/admin/me`, { headers: { cookie } })).json()) as { authenticated: boolean };
    expect(me.authenticated).toBe(true);
  });

  it('malformed /credentials не роняет сервер (регрессия DoS)', async () => {
    const res = await fetch(`${base}/api/admin/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ currentPassword: { x: 1 }, newPassword: null }),
    });
    expect(res.status).toBe(401);
    const me = (await (await fetch(`${base}/api/admin/me`, { headers: { cookie } })).json()) as { authenticated: boolean };
    expect(me.authenticated).toBe(true);
  });

  it('users отдаёт список вошедших админу', async () => {
    const res = await fetch(`${base}/api/admin/users`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; users: { sub: string; name: string }[] };
    expect(data.ok).toBe(true);
    expect(data.users).toHaveLength(2);
    expect(data.users[0]).toMatchObject({ sub: 's1', name: 'A' });
  });
});