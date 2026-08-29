import { randomBytes } from 'node:crypto';
import express from 'express';
import { hashPassword, verifyPassword } from './password.js';
import { signSessionToken } from './auth.js';
import type { UsersRepository } from './db.js';

const LOGIN_RE = /^[a-z0-9_-]+$/;

export function registerAuthRoutes(app: express.Express, users: UsersRepository): void {
  app.post('/api/auth/register', async (req, res) => {
    const raw = (req.body ?? {}) as { login?: unknown; password?: unknown };
    const login = typeof raw.login === 'string' ? raw.login.trim().toLowerCase() : '';
    if (login.length < 3 || login.length > 32 || !LOGIN_RE.test(login)) {
      res.status(400).json({ ok: false, error: 'invalid-login' });
      return;
    }
    if (typeof raw.password !== 'string' || raw.password.length < 6 || raw.password.length > 128) {
      res.status(400).json({ ok: false, error: 'invalid-password' });
      return;
    }
    try {
      if (await users.findByLogin(login)) {
        res.status(409).json({ ok: false, error: 'login-taken' });
        return;
      }
      const passwordHash = await hashPassword(raw.password);
      const sessionSecret = randomBytes(32).toString('base64url');
      await users.createLocal(login, passwordHash, sessionSecret);
      res.json({ ok: true, token: signSessionToken(login, sessionSecret), name: login });
    } catch (err) {
      console.error('register failed:', err);
      res.status(500).json({ ok: false, error: 'server' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    const raw = (req.body ?? {}) as { login?: unknown; password?: unknown };
    const login = typeof raw.login === 'string' ? raw.login.trim().toLowerCase() : '';
    if (login === '' || typeof raw.password !== 'string' || raw.password === '') {
      res.status(400).json({ ok: false, error: 'invalid-credentials' });
      return;
    }
    try {
      const user = await users.findByLogin(login);
      if (!user || !user.passwordHash || !user.sessionSecret || !(await verifyPassword(raw.password, user.passwordHash))) {
        res.status(401).json({ ok: false, error: 'invalid-credentials' });
        return;
      }
      await users.upsertBySub(user.sub, user.email ?? '', user.name ?? login);
      res.json({ ok: true, token: signSessionToken(login, user.sessionSecret), name: login });
    } catch (err) {
      console.error('login failed:', err);
      res.status(500).json({ ok: false, error: 'server' });
    }
  });
}