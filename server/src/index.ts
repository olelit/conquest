import express from 'express';
import { closeDb, countHexes, fetchHexes, initDb, insertHexes } from './db.js';
import { generateMap, MAP_COLUMNS, MAP_ROWS } from './map.js';

const PORT = Number(process.env.PORT ?? 3000);
const MAX_DB_RETRIES = 15;
const DB_RETRY_DELAY_MS = 2000;

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
  const count = await countHexes();
  if (count === 0) {
    const hexes = generateMap(MAP_COLUMNS, MAP_ROWS);
    await insertHexes(hexes);
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

  app.get('/api/map', async (_req, res) => {
    try {
      const hexes = await fetchHexes();
      res.json({ hexes });
    } catch (err) {
      console.error('Failed to fetch map:', err);
      res.status(500).json({ error: 'Failed to fetch map' });
    }
  });

  await connectWithRetry();
  await seedIfEmpty();
  app.listen(PORT, () => console.log(`API listening on port ${PORT}`));
}

main().catch(async (err) => {
  console.error('API failed to start:', err);
  await closeDb();
  process.exit(1);
});
