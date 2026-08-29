import express from 'express';
import type { Request } from 'express';
import type { FeedbackRepository } from './db.js';
import type { SlidingWindowLimiter } from './rate-limit.js';

export const FEEDBACK_MAX_LENGTH = 2000;

export function extractIp(req: Request, trustProxy = false): string {
  if (trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.trim() !== '') return fwd.split(',')[0].trim();
    const real = req.headers['x-real-ip'];
    if (typeof real === 'string' && real.trim() !== '') return real.trim();
  }
  return req.socket.remoteAddress ?? 'unknown';
}

export function registerFeedbackRoutes(
  app: express.Express,
  repo: FeedbackRepository,
  limiter: SlidingWindowLimiter,
  rateLimit: number,
  trustProxy = false,
): void {
  app.post('/api/feedback', async (req, res) => {
    const raw = (req.body ?? {}) as { text?: unknown };
    if (typeof raw.text !== 'string') {
      res.status(400).json({ ok: false, error: 'empty' });
      return;
    }
    const text = raw.text.trim();
    if (text === '') {
      res.status(400).json({ ok: false, error: 'empty' });
      return;
    }
    if (text.length > FEEDBACK_MAX_LENGTH) {
      res.status(400).json({ ok: false, error: 'too-long' });
      return;
    }
    const ip = extractIp(req, trustProxy);
    if (!limiter.try(ip, rateLimit)) {
      res.status(429).json({ ok: false, error: 'rate-limit' });
      return;
    }
    try {
      await repo.create(text, ip);
      res.json({ ok: true });
    } catch (err) {
      console.error('feedback save failed:', err);
      res.status(500).json({ ok: false, error: 'server' });
    }
  });
}
