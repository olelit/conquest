import { describe, expect, it } from 'vitest';
import { SlidingWindowLimiter } from '../src/rate-limit.js';

describe('SlidingWindowLimiter', () => {
  it('пропускает до лимита попаданий в окне, дальше отклоняет', () => {
    let t = 1000;
    const limiter = new SlidingWindowLimiter(60000, () => t);
    expect(limiter.try('1.2.3.4', 3)).toBe(true);
    expect(limiter.try('1.2.3.4', 3)).toBe(true);
    expect(limiter.try('1.2.3.4', 3)).toBe(true);
    expect(limiter.try('1.2.3.4', 3)).toBe(false);
    expect(limiter.try('1.2.3.4', 3)).toBe(false);
  });

  it('после окончания окна лимит сбрасывается', () => {
    let t = 1000;
    const limiter = new SlidingWindowLimiter(60000, () => t);
    limiter.try('1.2.3.4', 3);
    limiter.try('1.2.3.4', 3);
    limiter.try('1.2.3.4', 3);
    expect(limiter.try('1.2.3.4', 3)).toBe(false);
    t = 1000 + 60001;
    expect(limiter.try('1.2.3.4', 3)).toBe(true);
  });

  it('разные IP не мешают друг другу', () => {
    const limiter = new SlidingWindowLimiter(60000);
    expect(limiter.try('a', 3)).toBe(true);
    expect(limiter.try('b', 3)).toBe(true);
    expect(limiter.try('a', 3)).toBe(true);
    expect(limiter.try('a', 3)).toBe(true);
    expect(limiter.try('a', 3)).toBe(false);
    expect(limiter.try('b', 3)).toBe(true);
  });

  it('sweep удаляет пустые записи', () => {
    let t = 1000;
    const limiter = new SlidingWindowLimiter(60000, () => t);
    limiter.try('1.2.3.4', 3);
    expect(limiter.size()).toBe(1);
    t = 1000 + 60001;
    limiter.sweep();
    expect(limiter.size()).toBe(0);
  });
});
