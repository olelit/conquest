import { createHash } from 'node:crypto';
import neo4j from 'neo4j-driver';
import { GraphStore, type MemoryInput } from './graph.js';
import { SEED_FACTS } from './facts.js';

const uri = process.env.NEO4J_URI ?? 'bolt://localhost:7687';
const user = process.env.NEO4J_USER ?? 'neo4j';
const password = process.env.NEO4J_PASSWORD ?? 'memorydev123';

function seedId(input: MemoryInput): string {
  const hash = createHash('sha1').update([input.project, input.kind, input.text].join('|')).digest('hex');
  return `seed-${hash.slice(0, 16)}`;
}

async function main(): Promise<void> {
  const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  try {
    const store = GraphStore.fromDriver(driver);
    await store.init();
    for (const input of SEED_FACTS) {
      await store.addMemory({ ...input, id: seedId(input) });
    }
    console.log(`Seeded ${SEED_FACTS.length} facts (idempotent upsert)`);
  } finally {
    await driver.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
