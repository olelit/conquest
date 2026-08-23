import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Room, RoomManager } from '../src/rooms.js';
import { dumpsRepository } from '../src/db.js';

vi.mock('../src/db.js', () => ({
  dumpsRepository: { save: vi.fn(async () => 1), list: vi.fn(async () => []) },
  usersRepository: { upsertBySub: vi.fn(async () => {}), list: vi.fn(async () => []) },
}));

const save = vi.mocked(dumpsRepository.save);

beforeEach(() => {
  save.mockClear();
});

describe('Room: авто-дамп', () => {
  it('завершённая игра сохраняется один раз с auto:true и end-событием сверху', async () => {
    const room = new Room(1, 'Тест', 'normal', 6, true, 1, () => 0.5);
    room.addHuman('A', 1);
    room.start(1);
    room.gameState!.winnerId = 1;
    room.tick();
    room.tick(); // второй тик не должен дублировать дамп
    await vi.waitFor(() => {
      expect(save).toHaveBeenCalledTimes(1);
    });
    const call = save.mock.calls[0][0] as { auto: boolean; note: string | null; state: { stats: { events: { type: string }[] } } };
    expect(call.auto).toBe(true);
    expect(call.note).toBeNull();
    expect(call.state.stats.events[0].type).toBe('end'); // события — новыми сверху
  });

  it('брошенная игра сохраняется при удалении комнаты', async () => {
    const m = new RoomManager();
    m.connectionOpened(1);
    m.createSolo(1, 'normal', 1);
    m.leaveRoom(1); // человек вышел — слот становится ИИ, humanCount 0
    m.tickAll();
    await vi.waitFor(() => {
      expect(save).toHaveBeenCalledTimes(1);
    });
    expect(save.mock.calls[0][0].auto).toBe(true);
  });

  it('рестарт позволяет сохранить следующую партию', async () => {
    const room = new Room(1, 'Тест', 'normal', 6, true, 1, () => 0.5);
    room.addHuman('A', 1);
    room.start(1);
    room.gameState!.winnerId = 1;
    room.tick();
    await vi.waitFor(() => {
      expect(save).toHaveBeenCalledTimes(1);
    });
    room.restart();
    room.gameState!.winnerId = 1;
    room.tick();
    await vi.waitFor(() => {
      expect(save).toHaveBeenCalledTimes(2);
    });
  });

  it('нестартовавшая комната удаляется без дампа', () => {
    const m = new RoomManager();
    m.connectionOpened(1);
    m.createRoom(1, 'normal', 4);
    m.leaveRoom(1);
    expect(m.roomCount).toBe(0);
    expect(save).not.toHaveBeenCalled();
  });
});