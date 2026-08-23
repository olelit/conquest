import { describe, expect, it } from 'vitest';
import { GameStatsRecorder } from '../src/stats.js';

describe('GameStatsRecorder', () => {
  it('buildSummary собирает сводку по событиям', () => {
    const rec = new GameStatsRecorder();
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
    const summary = rec.buildSummary();
    expect(summary.durationMs).toBe(4000);
    expect(summary.battles).toBe(1);
    const ai = summary.players.find((p) => p.id === 2)!;
    expect(ai.actions).toBe(1);
    expect(ai.captures).toBe(1);
    expect(ai.actionsPerMinute).toBe(15); // 1 действие за 4 сек
    expect(ai.reactions).toEqual({ count: 1, avgMs: 1200, maxMs: 1200 });
    expect(ai.hexesAtEnd).toBe(5);
    expect(ai.pointsAtEnd).toBe(900);
  });
  it('без end-события сводка не падает', () => {
    const rec = new GameStatsRecorder();
    rec.record({ type: 'start', t: 1000, mapType: 'normal', players: [] });
    rec.record({ type: 'action', t: 2000, playerId: 1, action: 'capture', q: 0, r: 0 });
    const summary = rec.buildSummary();
    expect(summary.durationMs).toBe(0);
    expect(summary.players).toHaveLength(0);
  });
  it('clear очищает события', () => {
    const rec = new GameStatsRecorder();
    rec.record({ type: 'action', t: 1, playerId: 1, action: 'capture', q: 0, r: 0 });
    rec.clear();
    expect(rec.events).toHaveLength(0);
  });
  it('summary включает ИИ из последнего снапшота', () => {
    const rec = new GameStatsRecorder();
    rec.record({ type: 'start', t: 1000, mapType: 'normal', players: [{ id: 1, name: 'A', isAi: false, incomeMultiplier: 1 }] });
    rec.record({ type: 'snapshot', t: 3000, players: [
      { id: 1, hexCount: 3, points: 100 },
      { id: 5, hexCount: 2, points: 50 },
    ] });
    const summary = rec.buildSummary();
    expect(summary.players.map((p) => p.id).sort()).toEqual([1, 5]);
    expect(summary.players.find((p) => p.id === 5)!.isAi).toBe(true);
  });
  it('events возвращает копию', () => {
    const rec = new GameStatsRecorder();
    rec.record({ type: 'action', t: 1, playerId: 1, action: 'capture', q: 0, r: 0 });
    rec.events.length = 0;
    expect(rec.events).toHaveLength(1);
  });
});