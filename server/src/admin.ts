import { createHmac, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { hashPassword, verifyPassword } from './password.js';
import type { RoomManager } from './rooms.js';
import type { AdminCredentialsRepository, DumpsRepository } from './db.js';

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

export async function authAdmin(
  username: string,
  password: string,
  stored: { username: string; passwordHash: string },
): Promise<boolean> {
  if (username !== stored.username) return false;
  return verifyPassword(password, stored.passwordHash);
}

export function setAdminCookie(res: Response, username: string, secret: string): void {
  const token = signToken({ u: username, exp: Date.now() + SESSION_TTL_MS }, secret);
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`);
}

export function clearAdminCookie(res: Response): void {
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function sessionFrom(req: Request, secret: string): { u: string } | null {
  const cookie = req.headers.cookie ?? '';
  const match = cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${ADMIN_COOKIE}=`));
  if (!match) return null;
  const token = match.slice(ADMIN_COOKIE.length + 1);
  return verifyToken(token, secret);
}

export interface CredentialChangeInput {
  currentPassword?: string;
  newLogin?: string;
  newPassword?: string;
}

export type CredentialChange =
  | { ok: true; username: string; passwordHash: string }
  | { ok: false; status: 400 | 401 | 409; error: string };

export async function planCredentialChange(
  stored: { username: string; passwordHash: string },
  input: CredentialChangeInput,
): Promise<CredentialChange> {
  const current = input.currentPassword ?? '';
  if (!(await verifyPassword(current, stored.passwordHash))) {
    return { ok: false, status: 401, error: 'Current password is incorrect' };
  }
  const newLogin = typeof input.newLogin === 'string' ? input.newLogin.trim() : undefined;
  const newPassword = input.newPassword;
  if ((newLogin === undefined || newLogin === '') && (newPassword === undefined || newPassword === '')) {
    return { ok: false, status: 400, error: 'Nothing to change' };
  }
  if (newLogin !== undefined && newLogin === '') {
    return { ok: false, status: 400, error: 'New login cannot be empty' };
  }
  if (newPassword !== undefined && newPassword === '') {
    return { ok: false, status: 400, error: 'New password cannot be empty' };
  }
  if (newLogin !== undefined && newLogin === stored.username) {
    return { ok: false, status: 409, error: 'New login is the same as current' };
  }
  if (newPassword !== undefined && (await verifyPassword(newPassword, stored.passwordHash))) {
    return { ok: false, status: 400, error: 'New password is the same as current' };
  }
  return {
    ok: true,
    username: newLogin ?? stored.username,
    passwordHash: newPassword !== undefined ? await hashPassword(newPassword) : stored.passwordHash,
  };
}

export function registerAdminRoutes(
  app: express.Express,
  manager: RoomManager,
  dumps: DumpsRepository,
  adminCreds: AdminCredentialsRepository,
): void {
  app.get('/admin', (_req, res) => {
    res.sendFile(join(import.meta.dirname, '..', 'public', 'admin.html'));
  });

  const publicRouter = express.Router();

  publicRouter.post('/login', async (req, res) => {
    const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
    let stored;
    try {
      stored = await adminCreds.get();
    } catch (err) {
      console.error('admin login failed:', err);
      res.status(503).json({ ok: false, error: 'Admin service unavailable' });
      return;
    }
    if (!stored || !(await authAdmin(String(username ?? ''), String(password ?? ''), stored))) {
      res.status(401).json({ ok: false, error: 'Invalid credentials' });
      return;
    }
    setAdminCookie(res, stored.username, stored.sessionSecret);
    res.json({ ok: true, username: stored.username });
  });

  publicRouter.post('/logout', (_req, res) => {
    clearAdminCookie(res);
    res.json({ ok: true });
  });

  publicRouter.get('/me', async (req, res) => {
    let stored;
    try {
      stored = await adminCreds.get();
    } catch {
      res.json({ authenticated: false });
      return;
    }
    const session = stored ? sessionFrom(req, stored.sessionSecret) : null;
    if (!session) {
      res.json({ authenticated: false });
      return;
    }
    res.json({ authenticated: true, username: session.u });
  });

  const protectedRouter = express.Router();
  protectedRouter.use(async (req: Request, res: Response, next: NextFunction) => {
    try {
      const stored = await adminCreds.get();
      if (stored && sessionFrom(req, stored.sessionSecret)) {
        next();
      } else {
        res.status(401).json({ ok: false, error: 'Admin access required' });
      }
    } catch {
      res.status(503).json({ ok: false, error: 'Admin service unavailable' });
    }
  });

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

  protectedRouter.post('/credentials', async (req, res) => {
    let stored;
    try {
      stored = await adminCreds.get();
    } catch (err) {
      console.error('credentials update failed:', err);
      res.status(503).json({ ok: false, error: 'Admin service unavailable' });
      return;
    }
    if (!stored) {
      res.status(500).json({ ok: false, error: 'No admin credentials' });
      return;
    }
    const plan = await planCredentialChange(stored, (req.body ?? {}) as CredentialChangeInput);
    if (!plan.ok) {
      res.status(plan.status).json({ ok: false, error: plan.error });
      return;
    }
    try {
      await adminCreds.updateCredentials(plan.username, plan.passwordHash);
    } catch (err) {
      console.error('credentials update failed:', err);
      res.status(500).json({ ok: false, error: 'Failed to update credentials' });
      return;
    }
    clearAdminCookie(res);
    res.json({ ok: true });
  });

  app.use('/api/admin', publicRouter);
  app.use('/api/admin', protectedRouter);
}
