import pg from 'pg';

const pool = new pg.Pool({
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? 'conquest',
  password: process.env.PGPASSWORD ?? 'conquest',
  database: process.env.PGDATABASE ?? 'conquest_db',
});

export async function initDb(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hexes (
      q integer NOT NULL,
      r integer NOT NULL,
      terrain text NOT NULL,
      PRIMARY KEY (q, r)
    )
  `);
}

export async function countHexes(): Promise<number> {
  const result = await pool.query<{ count: string }>('SELECT COUNT(*) AS count FROM hexes');
  return Number(result.rows[0].count);
}

export async function insertHexes(
  hexes: { q: number; r: number; terrain: string }[],
): Promise<void> {
  for (const hex of hexes) {
    await pool.query('INSERT INTO hexes (q, r, terrain) VALUES ($1, $2, $3)', [
      hex.q,
      hex.r,
      hex.terrain,
    ]);
  }
}

export async function fetchHexes(): Promise<{ q: number; r: number; terrain: string }[]> {
  const result = await pool.query('SELECT q, r, terrain FROM hexes ORDER BY r, q');
  return result.rows;
}

export async function closeDb(): Promise<void> {
  await pool.end();
}
