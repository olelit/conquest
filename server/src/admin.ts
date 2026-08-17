import { createHmac, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';
import type { RoomManager } from './rooms.js';
import type { DumpsRepository } from './db.js';

export const ADMIN_COOKIE = 'conquest_admin';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function b64url(data: Buffer | string): string {
  return Buffer.from(data).toString('base64url');
}

export function signToken(payload: { u: string; exp: number }, secret: string): string {
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(token: string, secret: string): { u: string } | null {
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload: { u?: string; exp?: number };
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload.u !== 'string' || typeof payload.exp !== 'number') return null;
  if (payload.exp < Date.now()) return null;
  return { u: payload.u };
}

export function authAdmin(username: string, password: string): boolean {
  if (username !== config.adminUser) return false;
  const actual = createHmac('sha256', config.adminSecret).update(password).digest();
  const expected = createHmac('sha256', config.adminSecret).update(config.adminPassword).digest();
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function adminSession(req: Request): { u: string } | null {
  const cookie = req.headers.cookie ?? '';
  const match = cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${ADMIN_COOKIE}=`));
  if (!match) return null;
  const token = match.slice(ADMIN_COOKIE.length + 1);
  return verifyToken(token, config.adminSecret);
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (adminSession(req)) {
    next();
  } else {
    res.status(401).json({ ok: false, error: 'Admin access required' });
  }
}

export function setAdminCookie(res: Response): void {
  const token = signToken({ u: config.adminUser, exp: Date.now() + SESSION_TTL_MS }, config.adminSecret);
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`);
}

export function clearAdminCookie(res: Response): void {
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

export function registerAdminRoutes(app: express.Express, manager: RoomManager, dumps: DumpsRepository): void {
  app.get('/admin', (_req, res) => {
    res.sendFile(join(import.meta.dirname, '..', 'public', 'admin.html'));
  });

  const publicRouter = express.Router();

  publicRouter.post('/login', (req, res) => {
    const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
    if (!authAdmin(String(username ?? ''), String(password ?? ''))) {
      res.status(401).json({ ok: false, error: 'Invalid credentials' });
      return;
    }
    setAdminCookie(res);
    res.json({ ok: true, username: config.adminUser });
  });

  publicRouter.post('/logout', (_req, res) => {
    clearAdminCookie(res);
    res.json({ ok: true });
  });

  publicRouter.get('/me', (req, res) => {
    const session = adminSession(req);
    if (!session) {
      res.json({ authenticated: false });
      return;
    }
    res.json({ authenticated: true, username: session.u });
  });

  const protectedRouter = express.Router();
  protectedRouter.use(requireAdmin);

  protectedRouter.get('/status', (_req, res) => {
    res.json(manager.adminOverview());
  });

  protectedRouter.get('/dumps', async (_req, res) => {
    try {
      res.json({ ok: true, dumps: await dumps.list() });
    } catch (err) {
      console.error('dumps list failed:', err);
      res.status(500).json({ ok: false, error: 'Failed to list dumps' });
    }
  });

  protectedRouter.get('/dumps/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ ok: false, error: 'Invalid id' });
      return;
    }
    try {
      const dump = await dumps.findById(id);
      if (!dump) {
        res.status(404).json({ ok: false, error: 'Dump not found' });
        return;
      }
      res.json({ ok: true, dump });
    } catch (err) {
      console.error('dump fetch failed:', err);
      res.status(500).json({ ok: false, error: 'Failed to fetch dump' });
    }
  });

  protectedRouter.post('/rooms/:roomId/dump', async (req, res) => {
    const roomId = Number(req.params.roomId);
    if (!Number.isInteger(roomId)) {
      res.status(400).json({ ok: false, error: 'Invalid room id' });
      return;
    }
    const note = (req.body as { note?: string } | undefined)?.note;
    const result = await manager.dumpRoom(roomId, typeof note === 'string' && note.trim().length > 0 ? note.trim() : undefined);
    if (!result.ok) {
      res.status(404).json({ ok: false, error: result.error });
      return;
    }
    res.json({ ok: true, id: result.id });
  });

  app.use('/api/admin', publicRouter);
  app.use('/api/admin', protectedRouter);
}
