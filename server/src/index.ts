import http from 'http';
import express from 'express';
import { closeDb, hexesRepository, initDb } from './db.js';
import { config } from './config.js';
import { generateMap, MAP_COLUMNS, MAP_ROWS } from './map.js';
import { GameService } from './game.js';
import { attachWs } from './ws.js';

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

async function seedIfEmpty(): Promise<void> {
  const count = await hexesRepository.count();
  if (count === 0) {
    const hexes = generateMap('normal');
    await hexesRepository.insertMany(
      hexes.map((h) => ({
        q: h.q,
        r: h.r,
        terrain: h.terrain,
        ownerId: null,
        attackerId: null,
        defenderId: null,
        attackInvestment: 0,
        defenseInvestment: 0,
        battleProgress: 0,
      })),
    );
    console.log(`Seeded map with ${hexes.length} hexes`);
  } else {
    console.log(`Map already seeded (${count} hexes)`);
  }
}

async function main(): Promise<void> {
  const app = express();

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  await connectWithRetry();
  await seedIfEmpty();

  const service = await GameService.create();
  console.log(`Game started: human=${service.humanId}, ai=${service.aiId}`);

  const server = http.createServer(app);
  const broadcast = attachWs(server, service);

  let ticking = false;
  setInterval(() => {
    if (ticking) return;
    ticking = true;
    service
      .tick()
      .then(() => broadcast())
      .catch((err) => console.error('tick failed:', err))
      .finally(() => {
        ticking = false;
      });
  }, TICK_INTERVAL_MS);

  server.listen(PORT, () => console.log(`API listening on port ${PORT}`));
}

main().catch(async (err) => {
  console.error('API failed to start:', err);
  await closeDb();
  process.exit(1);
});
