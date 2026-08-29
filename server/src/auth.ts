import { createHmac, timingSafeEqual } from 'node:crypto';

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function b64url(data: Buffer | string): string {
  return Buffer.from(data).toString('base64url');
}

export interface SessionProfile {
  sub: string;
  email: string;
  name: string;
}

export function parseSessionToken(token: string): { u: string } | null {
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  let payload: { u?: string };
  try {
    payload = JSON.parse(Buffer.from(token.slice(0, dot), 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload.u !== 'string' || payload.u === '') return null;
  return { u: payload.u };
}

export function signSessionToken(login: string, secret: string): string {
  const body = b64url(JSON.stringify({ u: login, exp: Date.now() + SESSION_TTL_MS }));
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifySessionToken(token: string, secret: string): { u: string } | null {
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
  if (typeof payload.u !== 'string' || payload.u === '' || typeof payload.exp !== 'number') return null;
  if (payload.exp < Date.now()) return null;
  return { u: payload.u };
}