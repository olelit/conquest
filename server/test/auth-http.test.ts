import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerAuthRoutes } from '../src/auth-routes.js';
import { signSessionToken, verifySessionToken } from '../src/auth.js';

interface UserRow {
  id: number;
  sub: string;
  login: string;
  email: string;
  name: string;
  passwordHash: string;
  sessionSecret: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

function makeUsersStub() {
  const rows: UserRow[] = [];
  let nextId = 1;
  return {
    rows,
    async findByLogin(login: string): Promise<UserRow | null> {
      return rows.find((u) => u.login === login) ?? null;
    },
    async createLocal(login: string, passwordHash: string, sessionSecret: string): Promise<UserRow> {
      const row: UserRow = {
        id: nextId++,
        sub: `local:${login}`,
        login,
        email: '',
        name: login,
        passwordHash,
        sessionSecret,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      };
      rows.push(row);
      return row;
    },
    async upsertBySub(): Promise<void> {},
    async list(): Promise<UserRow[]> {
      return [...rows];
    },
  };
}

let server: ReturnType<typeof createServer>;
let base = '';
const stub = makeUsersStub();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerAuthRoutes(app, stub as never);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() =>
  new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  }),
);

async function register(login: unknown, password: unknown): Promise<Response> {
  return fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password }),
  });
}

async function login(login: unknown, password: unknown): Promise<Response> {
  return fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password }),
  });
}

describe('POST /api/auth/register', () => {
  it('регистрирует и сразу выдаёт токен', async () => {
    stub.rows.length = 0;
    const res = await register('TestUser', 'secret1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; token: string; name: string };
    expect(body.ok).toBe(true);
    expect(body.name).toBe('testuser');
    expect(stub.rows).toHaveLength(1);
    expect(stub.rows[0].sub).toBe('local:testuser');
    expect(stub.rows[0].passwordHash).not.toBe('secret1');
    expect(verifySessionToken(body.token, stub.rows[0].sessionSecret)).toEqual({ u: 'testuser' });
  });

  it('короткий логин → 400 invalid-login', async () => {
    stub.rows.length = 0;
    const res = await register('ab', 'secret1');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'invalid-login' });
  });

  it('недопустимые символы логина → 400 invalid-login', async () => {
    stub.rows.length = 0;
    const res = await register('bad login!', 'secret1');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'invalid-login' });
  });

  it('короткий пароль → 400 invalid-password', async () => {
    stub.rows.length = 0;
    const res = await register('user1', '123');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'invalid-password' });
  });

  it('занятый логин → 409 login-taken', async () => {
    stub.rows.length = 0;
    await register('taken1', 'secret1');
    const res = await register('Taken1', 'secret2');
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: 'login-taken' });
  });
});

describe('POST /api/auth/login', () => {
  it('вход с верным паролем → токен', async () => {
    stub.rows.length = 0;
    await register('user1', 'secret1');
    const res = await login('USER1', 'secret1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; token: string; name: string };
    expect(body.name).toBe('user1');
    const row = stub.rows.find((u) => u.login === 'user1')!;
    expect(verifySessionToken(body.token, row.sessionSecret)).toEqual({ u: 'user1' });
  });

  it('неверный пароль → 401 invalid-credentials', async () => {
    stub.rows.length = 0;
    await register('user1', 'secret1');
    const res = await login('user1', 'wrong1');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: 'invalid-credentials' });
  });

  it('неизвестный логин → 401 invalid-credentials', async () => {
    stub.rows.length = 0;
    const res = await login('nobody', 'secret1');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: 'invalid-credentials' });
  });
});

describe('handleAuth через RoomManager', () => {
  it('принимает валидный токен и отклоняет неверный', async () => {
    stub.rows.length = 0;
    await register('user1', 'secret1');
    const row = stub.rows.find((u) => u.login === 'user1')!;
    const token = signSessionToken('user1', row.sessionSecret);
    const { RoomManager } = await import('../src/rooms.js');
    const manager = new RoomManager(60_000, stub as never);
    const ok = await manager.handleAuth(1, token);
    expect(ok).toEqual({ ok: true });
    const bad = await manager.handleAuth(2, token + 'x');
    expect(bad.ok).toBe(false);
    expect(manager.authProfileFor(1)?.name).toBe('user1');
    manager.logout(1);
    expect(manager.authProfileFor(1)).toBeNull();
  });
});