export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  try(ip: string, limit: number): boolean {
    const cutoff = this.now() - this.windowMs;
    const arr = (this.hits.get(ip) ?? []).filter((t) => t > cutoff);
    if (arr.length >= limit) {
      this.hits.set(ip, arr);
      return false;
    }
    arr.push(this.now());
    this.hits.set(ip, arr);
    return true;
  }

  sweep(): void {
    const cutoff = this.now() - this.windowMs;
    for (const [ip, arr] of this.hits) {
      const kept = arr.filter((t) => t > cutoff);
      if (kept.length === 0) this.hits.delete(ip);
      else this.hits.set(ip, kept);
    }
  }

  size(): number {
    return this.hits.size;
  }
}
