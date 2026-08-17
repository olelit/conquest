import { describe, expect, it } from 'vitest';
import { SEED_FACTS } from '../src/facts.js';

describe('SEED_FACTS', () => {
  it('каждый факт имеет текст и сущности', () => {
    for (const f of SEED_FACTS) {
      expect(f.text.trim().length).toBeGreaterThan(0);
      expect((f.entities ?? []).length).toBeGreaterThan(0);
    }
  });

  it('нет дублей текста внутри проекта', () => {
    const keys = SEED_FACTS.map((f) => `${f.project ?? ''}|${f.kind ?? ''}|${f.text}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
