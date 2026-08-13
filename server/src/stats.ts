import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type StatsEvent =
  | { type: 'start'; t: number; mapType: string; players: { id: number; name: string; isAi: boolean; incomeMultiplier: number }[] }
  | { type: 'action'; t: number; playerId: number; action: 'capture' | 'attack' | 'defend'; q: number; r: number }
  | { type: 'battle'; t: number; q: number; r: number; winnerId: number | null }
  | { type: 'reaction'; t: number; playerId: number; ms: number }
  | { type: 'snapshot'; t: number; players: { id: number; hexCount: number; points: number }[] }
  | { type: 'end'; t: number; winnerId: number | null; durationMs: number };

export interface StatsPlayerSummary {
  id: number;
  name: string;
  isAi: boolean;
  incomeMultiplier: number;
  actions: number;
  captures: number;
  attacks: number;
  defends: number;
  actionsPerMinute: number;
  reactions: { count: number; avgMs: number; maxMs: number } | null;
  hexesAtEnd: number;
  pointsAtEnd: number;
}

export interface StatsSummary {
  durationMs: number;
  battles: number;
  players: StatsPlayerSummary[];
}

export class GameStatsRecorder {
  private readonly recorded: StatsEvent[] = [];

  constructor(private readonly roomId: number) {}

  get events(): StatsEvent[] {
    return [...this.recorded];
  }

  record(event: StatsEvent): void {
    this.recorded.push(event);
  }

  clear(): void {
    this.recorded.length = 0;
  }

  writeSummary(statsDir: string): string {
    if (this.recorded.length === 0) return '';
    mkdirSync(statsDir, { recursive: true });
    const starts = this.recorded.filter((e) => e.type === 'start');
    const ends = this.recorded.filter((e) => e.type === 'end');
    const lastStart = starts[starts.length - 1];
    const lastEnd = ends[ends.length - 1];
    const startedAt = lastStart ? lastStart.t : Date.now();
    const path = join(statsDir, `${this.roomId}-${startedAt}.json`);
    const summary = this.buildSummary();
    const payload = { meta: { roomId: this.roomId, startedAt }, summary, events: this.recorded };
    writeFileSync(path, JSON.stringify(payload, null, 2));
    return path;
  }

  private buildSummary(): StatsSummary {
    const starts = this.recorded.filter((e) => e.type === 'start');
    const ends = this.recorded.filter((e) => e.type === 'end');
    const lastStart = starts[starts.length - 1];
    const lastEnd = ends[ends.length - 1];
    const durationMs = lastStart && lastEnd ? lastEnd.t - lastStart.t : 0;
    const startPlayers = lastStart && lastStart.type === 'start' ? lastStart.players : [];
    const known = new Map(startPlayers.map((p) => [p.id, p]));
    const snapshotsForMerge = this.recorded.filter((e) => e.type === 'snapshot');
    const lastSnapshotForMerge = snapshotsForMerge[snapshotsForMerge.length - 1];
    if (lastSnapshotForMerge && lastSnapshotForMerge.type === 'snapshot') {
      for (const sp of lastSnapshotForMerge.players) {
        if (!known.has(sp.id)) {
          known.set(sp.id, { id: sp.id, name: `Игрок ${sp.id}`, isAi: true, incomeMultiplier: 1 });
        }
      }
    }
    const players = [...known.values()].map((p) => {
      const actions = this.recorded.filter((e): e is Extract<StatsEvent, { type: 'action' }> => e.type === 'action' && e.playerId === p.id);
      const reactions = this.recorded.filter((e): e is Extract<StatsEvent, { type: 'reaction' }> => e.type === 'reaction' && e.playerId === p.id);
      const reactionsSummary =
        reactions.length > 0
          ? {
              count: reactions.length,
              avgMs: Math.round(reactions.reduce((s, r) => s + r.ms, 0) / reactions.length),
              maxMs: Math.max(...reactions.map((r) => r.ms)),
            }
          : null;
      const snapshots = this.recorded.filter((e) => e.type === 'snapshot');
      const lastSnapshot = snapshots[snapshots.length - 1];
      const endHexCount = lastSnapshot && lastSnapshot.type === 'snapshot' ? lastSnapshot.players.find((s) => s.id === p.id)?.hexCount ?? 0 : 0;
      const endPoints = lastSnapshot && lastSnapshot.type === 'snapshot' ? lastSnapshot.players.find((s) => s.id === p.id)?.points ?? 0 : 0;
      const minutes = durationMs / 60000;
      return {
        id: p.id,
        name: p.name,
        isAi: p.isAi,
        incomeMultiplier: p.incomeMultiplier,
        actions: actions.length,
        captures: actions.filter((a) => a.action === 'capture').length,
        attacks: actions.filter((a) => a.action === 'attack').length,
        defends: actions.filter((a) => a.action === 'defend').length,
        actionsPerMinute: minutes > 0 ? Math.round(actions.length / minutes) : 0,
        reactions: reactionsSummary,
        hexesAtEnd: endHexCount,
        pointsAtEnd: endPoints,
      };
    });
    return { durationMs, battles: this.recorded.filter((e) => e.type === 'battle').length, players };
  }
}
