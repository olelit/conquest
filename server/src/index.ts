import http from 'http';
import express from 'express';
import { closeDb, initDb, dumpsRepository } from './db.js';
import { config } from './config.js';
import { RoomManager } from './rooms.js';
import { attachWs } from './ws.js';
import { registerAdminRoutes } from './admin.js';

const PORT = Number(process.env.PORT ?? 3000);
const MAX_DB_RETRIES = 15;
const DB_RETRY_DELAY_MS = 2000;
const TICK_INTERVAL_MS = config.tickIntervalMs;

async function connectWithRetry(): Promise<void> {
  for (let attempt = 1; attempt <= MAX_DB_RETRIES; attempt++) {
    try {
      await initDb();
      return;
    } catch (err) {
      if (attempt === MAX_DB_RETRIES) throw err;
      console.error(
        `DB not ready (attempt ${attempt}/${MAX_DB_RETRIES}), retrying in ${DB_RETRY_DELAY_MS}ms...`,
      );
      await new Promise((resolve) => setTimeout(resolve, DB_RETRY_DELAY_MS));
    }
  }
}

async function main(): Promise<void> {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  await connectWithRetry();

  const manager = new RoomManager();
  registerAdminRoutes(app, manager, dumpsRepository);

  if (process.env.NODE_ENV === 'production') {
    const cfg = await import('./config.js');
    const insecure =
      cfg.config.adminUser === 'admin' ||
      cfg.config.adminPassword === 'admin' ||
      cfg.config.adminSecret === 'conquest-admin-dev-secret';
    if (insecure) {
      console.warn(
        'WARNING: admin uses default credentials/secret. Set CONQUEST_ADMIN_USER, CONQUEST_ADMIN_PASSWORD, CONQUEST_ADMIN_SECRET in production.',
      );
    }
  }

  console.log('Conquest server ready: rooms in memory');

  const server = http.createServer(app);
  const broadcast = attachWs(server, manager);

  setInterval(() => {
    manager.tickAll();
    broadcast();
  }, TICK_INTERVAL_MS);

  server.listen(PORT, () => console.log(`API listening on port ${PORT}`));
}

main().catch(async (err) => {
  console.error('API failed to start:', err);
  await closeDb();
  process.exit(1);
});
