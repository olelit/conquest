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
  registerAdminRoutes(app, {} as never, {} as never, adminCreds as never);
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
});