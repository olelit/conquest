import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerFeedbackRoutes } from '../src/feedback.js';
import { SlidingWindowLimiter } from '../src/rate-limit.js';
import { registerAdminRoutes } from '../src/admin.js';
import { hashPassword } from '../src/password.js';

interface FeedbackRow {
  id: number;
  text: string;
  ip: string;
  read: boolean;
  createdAt: Date;
}

function makeFeedbackStub() {
  const rows: FeedbackRow[] = [];
  let nextId = 1;
  return {
    rows,
    async create(text: string, ip: string): Promise<number> {
      rows.push({ id: nextId, text, ip, read: false, createdAt: new Date() });
      return nextId++;
    },
    async list(): Promise<FeedbackRow[]> {
      return [...rows].reverse();
    },
    async markRead(id: number): Promise<boolean> {
      const row = rows.find((r) => r.id === id);
      if (!row) return false;
      row.read = true;
      return true;
    },
    async remove(id: number): Promise<boolean> {
      const idx = rows.findIndex((r) => r.id === id);
      if (idx === -1) return false;
      rows.splice(idx, 1);
      return true;
    },
  };
}

let server: ReturnType<typeof createServer>;
let base = '';
const stub = makeFeedbackStub();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerFeedbackRoutes(app, stub as never, new SlidingWindowLimiter(60000), 3, true);
  const adminCreds = {
    get: async () => ({ id: 1, username: 'admin', passwordHash: await hashPassword('admin'), sessionSecret: 's' }),
    updateCredentials: async () => {},
  };
  registerAdminRoutes(app, {} as never, {} as never, adminCreds as never, {} as never, stub as never);
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

async function post(text: unknown, ip = '127.0.0.1'): Promise<Response> {
  return fetch(`${base}/api/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ text }),
  });
}

describe('feedback: POST /api/feedback', () => {
  it('сохраняет отзыв и возвращает ok', async () => {
    stub.rows.length = 0;
    const res = await post('Отличная игра!');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(stub.rows).toHaveLength(1);
    expect(stub.rows[0].text).toBe('Отличная игра!');
    expect(stub.rows[0].ip).toBe('127.0.0.1');
  });

  it('пустой текст → 400 empty', async () => {
    const res = await post('   ');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'empty' });
  });

  it('не-строка → 400 empty', async () => {
    const res = await post(42);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'empty' });
  });

  it('длинный текст → 400 too-long', async () => {
    const res = await post('x'.repeat(2001));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'too-long' });
  });

  it('лимит 3/мин → 429 rate-limit', async () => {
    stub.rows.length = 0;
    const ip = '9.9.9.9';
    expect((await post('1', ip)).status).toBe(200);
    expect((await post('2', ip)).status).toBe(200);
    expect((await post('3', ip)).status).toBe(200);
    const fourth = await post('4', ip);
    expect(fourth.status).toBe(429);
    expect(await fourth.json()).toEqual({ ok: false, error: 'rate-limit' });
    expect(stub.rows).toHaveLength(3);
  });
});

describe('feedback: админ-роуты', () => {
  let cookie = '';

  beforeAll(async () => {
    const res = await fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin' }),
    });
    expect(res.status).toBe(200);
    cookie = res.headers.get('set-cookie')!.split(';')[0];
  });

  it('GET /api/admin/feedback возвращает список', async () => {
    stub.rows.length = 0;
    await post('Первый', '1.1.1.1');
    await post('Второй', '2.2.2.2');
    const res = await fetch(`${base}/api/admin/feedback`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; feedback: FeedbackRow[] };
    expect(body.ok).toBe(true);
    expect(body.feedback.map((f) => f.text)).toEqual(['Второй', 'Первый']);
  });

  it('POST /:id/read помечает прочитанным, 404 для неизвестного id', async () => {
    stub.rows.length = 0;
    const id = await stub.create('x', '1.1.1.1');
    const res = await fetch(`${base}/api/admin/feedback/${id}/read`, { method: 'POST', headers: { cookie } });
    expect(res.status).toBe(200);
    expect(stub.rows[0].read).toBe(true);
    const missing = await fetch(`${base}/api/admin/feedback/9999/read`, { method: 'POST', headers: { cookie } });
    expect(missing.status).toBe(404);
  });

  it('DELETE /:id удаляет, 404 для неизвестного id', async () => {
    stub.rows.length = 0;
    const id = await stub.create('y', '1.1.1.1');
    const res = await fetch(`${base}/api/admin/feedback/${id}`, { method: 'DELETE', headers: { cookie } });
    expect(res.status).toBe(200);
    expect(stub.rows).toHaveLength(0);
    const missing = await fetch(`${base}/api/admin/feedback/9999`, { method: 'DELETE', headers: { cookie } });
    expect(missing.status).toBe(404);
  });

  it('неавторизованный запрос → 401', async () => {
    const res = await fetch(`${base}/api/admin/feedback`);
    expect(res.status).toBe(401);
  });
});

describe('feedback: trustProxy выключен', () => {
  let server2: ReturnType<typeof createServer>;
  let base2 = '';
  const stub2 = makeFeedbackStub();

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    registerFeedbackRoutes(app, stub2 as never, new SlidingWindowLimiter(60000), 3, false);
    server2 = createServer(app);
    await new Promise<void>((resolve) => server2.listen(0, '127.0.0.1', resolve));
    base2 = `http://127.0.0.1:${(server2.address() as AddressInfo).port}`;
  });

  afterAll(() =>
    new Promise<void>((resolve) => {
      server2.close(() => resolve());
      server2.closeAllConnections();
    }),
  );

  it('игнорирует X-Forwarded-For, когда trustProxy выключен', async () => {
    const res = await fetch(`${base2}/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '1.2.3.4' },
      body: JSON.stringify({ text: 'hi' }),
    });
    expect(res.status).toBe(200);
    expect(stub2.rows[0].ip).not.toBe('1.2.3.4');
  });
});
