import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { GameStatsRecorder } from '../src/stats.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

describe('GameStatsRecorder', () => {
  it('writeSummary пишет файл со сводкой', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stats-'));
    dirs.push(dir);
    const rec = new GameStatsRecorder(42);
    rec.record({ type: 'start', t: 1000, mapType: 'normal', players: [
      { id: 1, name: 'A', isAi: false, incomeMultiplier: 1 },
      { id: 2, name: 'B', isAi: true, incomeMultiplier: 0.5 },
    ] });
    rec.record({ type: 'action', t: 2000, playerId: 2, action: 'capture', q: 5, r: 5 });
    rec.record({ type: 'battle', t: 3000, q: 5, r: 5, winnerId: 2 });
    rec.record({ type: 'reaction', t: 3500, playerId: 2, ms: 1200 });
    rec.record({ type: 'snapshot', t: 4000, players: [
      { id: 1, hexCount: 3, points: 1050 },
      { id: 2, hexCount: 5, points: 900 },
    ] });
    rec.record({ type: 'end', t: 5000, winnerId: 2, durationMs: 4000 });
    const path = rec.writeSummary(dir);
    expect(statSync(path).isFile()).toBe(true);
    const data = JSON.parse(readFileSync(path, 'utf8'));
    expect(data.meta.roomId).toBe(42);
    expect(data.summary.durationMs).toBe(4000);
    expect(data.summary.battles).toBe(1);
    const ai = data.summary.players.find((p: { id: number }) => p.id === 2);
    expect(ai.actions).toBe(1);
    expect(ai.captures).toBe(1);
    expect(ai.actionsPerMinute).toBe(15); // 1 действие за 4 сек
    expect(ai.reactions).toEqual({ count: 1, avgMs: 1200, maxMs: 1200 });
    expect(ai.hexesAtEnd).toBe(5);
    expect(ai.pointsAtEnd).toBe(900);
  });
  it('без end-события сводка не падает', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stats-'));
    dirs.push(dir);
    const rec = new GameStatsRecorder(7);
    rec.record({ type: 'start', t: 1000, mapType: 'normal', players: [] });
    rec.record({ type: 'action', t: 2000, playerId: 1, action: 'capture', q: 0, r: 0 });
    const path = rec.writeSummary(dir);
    const data = JSON.parse(readFileSync(path, 'utf8'));
    expect(data.summary.durationMs).toBe(0);
    expect(data.summary.players).toHaveLength(0);
    expect(data.events).toHaveLength(2);
  });
  it('clear очищает события', () => {
    const rec = new GameStatsRecorder(1);
    rec.record({ type: 'action', t: 1, playerId: 1, action: 'capture', q: 0, r: 0 });
    rec.clear();
    expect(rec.events).toHaveLength(0);
  });
  it('writeSummary с пустым логом не создаёт файл', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stats-'));
    dirs.push(dir);
    const rec = new GameStatsRecorder(5);
    expect(rec.writeSummary(dir)).toBe('');
    expect(readdirSync(dir)).toHaveLength(0);
  });
  it('summary включает ИИ из последнего снапшота', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stats-'));
    dirs.push(dir);
    const rec = new GameStatsRecorder(9);
    rec.record({ type: 'start', t: 1000, mapType: 'normal', players: [{ id: 1, name: 'A', isAi: false, incomeMultiplier: 1 }] });
    rec.record({ type: 'snapshot', t: 3000, players: [
      { id: 1, hexCount: 3, points: 100 },
      { id: 5, hexCount: 2, points: 50 },
    ] });
    const data = JSON.parse(readFileSync(rec.writeSummary(dir), 'utf8'));
    expect(data.summary.players.map((p: { id: number }) => p.id).sort()).toEqual([1, 5]);
    expect(data.summary.players.find((p: { id: number }) => p.id === 5)!.isAi).toBe(true);
  });
  it('events возвращает копию', () => {
    const rec = new GameStatsRecorder(1);
    rec.record({ type: 'action', t: 1, playerId: 1, action: 'capture', q: 0, r: 0 });
    rec.events.length = 0;
    expect(rec.events).toHaveLength(1);
  });
});
