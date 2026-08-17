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
  return username === config.adminUser && password === config.adminPassword;
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

  // /dumps, /dumps/:id, /rooms/:roomId/dump добавляются в Task 5

  app.use('/api/admin', publicRouter);
  app.use('/api/admin', protectedRouter);
}
