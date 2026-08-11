import { describe, expect, it } from 'vitest';
import { Room } from '../src/rooms.js';

function makeRoom(aiMode = false, aiCount = 1, maxPlayers = 4): Room {
  return new Room(1, 'Тест', 'normal', maxPlayers, aiMode, aiCount);
}

describe('Room: состав при старте', () => {
  it('комната с людьми: AI добивают до maxPlayers', () => {
    const room = makeRoom(false, 1, 4);
    room.addHuman('A', 1);
    room.addHuman('B', 2);
    expect(room.start(1).ok).toBe(true);
    const players = room.gameState!.players;
    expect(players).toHaveLength(4);
    expect(players.filter((p) => p.isAi)).toHaveLength(2);
  });
  it('соло-режим: 1 человек + ровно aiCount компов', () => {
    const room = makeRoom(true, 2, 6);
    room.addHuman('A', 1);
    expect(room.start(1).ok).toBe(true);
    const players = room.gameState!.players;
    expect(players).toHaveLength(3);
    expect(players.filter((p) => p.isAi)).toHaveLength(2);
  });
  it('не хозяин не может начать', () => {
    const room = makeRoom();
    room.addHuman('A', 1);
    room.addHuman('B', 2);
    expect(room.start(2).ok).toBe(false);
    expect(room.status).toBe('waiting');
  });
  it('повторный старт отклоняется', () => {
    const room = makeRoom();
    room.addHuman('A', 1);
    room.start(1);
    expect(room.start(1).ok).toBe(false);
  });
  it('карта соответствует типу', () => {
    const room = makeRoom();
    room.addHuman('A', 1);
    room.start(1);
    expect(room.gameState!.hexes).toHaveLength(192);
  });
});

describe('Room: игроки', () => {
  it('addHuman до заполнения', () => {
    const room = makeRoom(false, 1, 2);
    expect(room.addHuman('A', 1)).toBe(1);
    expect(room.addHuman('B', 2)).toBe(2);
    expect(room.addHuman('C', 3)).toBeNull();
    expect(room.slotsCount).toBe(2);
  });
  it('removeHuman в waiting: ренумерация и передача хозяина', () => {
    const room = makeRoom();
    room.addHuman('A', 1);
    room.addHuman('B', 2);
    room.removeHuman(1);
    expect(room.slotsCount).toBe(1);
    expect(room.hostPlayerId).toBe(2);
    expect(room.slotForConn(2)).toBe(1);
  });
  it('нельзя добавить в играющую комнату', () => {
    const room = makeRoom(false, 1, 2);
    room.addHuman('A', 1);
    room.start(1);
    expect(room.addHuman('B', 2)).toBeNull();
  });
});

describe('Room: действия и тик', () => {
  it('capture в игре меняет владельца', () => {
    const room = makeRoom(false, 1, 2);
    room.addHuman('A', 1);
    room.addHuman('B', 2);
    room.start(1);
    const result = room.handleAction(1, 'capture', { q: 0, r: 0 });
    expect(result.type).toBe('state');
    expect(room.gameState!.hexes.find((h) => h.q === 0 && h.r === 0)!.ownerId).toBe(1);
  });
  it('действия до старта отклоняются', () => {
    const room = makeRoom();
    room.addHuman('A', 1);
    expect(room.handleAction(1, 'capture', { q: 0, r: 0 }).type).toBe('error');
  });
  it('пауза только в aiMode', () => {
    const room = makeRoom(false, 1, 2);
    room.addHuman('A', 1);
    room.start(1);
    expect(room.handleAction(1, 'pause', {}).type).toBe('error');
    const solo = makeRoom(true, 1, 2);
    solo.addHuman('A', 1);
    solo.start(1);
    expect(solo.handleAction(1, 'pause', {}).type).toBe('state');
    expect(solo.paused).toBe(true);
  });
  it('тик: AI захватывает первый гекс, доход не падает', () => {
    const room = makeRoom(true, 1, 2);
    room.addHuman('A', 1);
    room.start(1);
    room.tick();
    expect(room.gameState!.hexes.filter((h) => h.ownerId === 2).length).toBe(1);
  });
  it('humanDisconnected в игре: слот становится AI навсегда', () => {
    const room = makeRoom(false, 1, 2);
    room.addHuman('A', 1);
    room.addHuman('B', 2);
    room.start(1);
    room.humanDisconnected(1);
    expect(room.gameState!.players.find((p) => p.id === 1)!.isAi).toBe(true);
    expect(room.slotForConn(1)).toBeNull();
    expect(room.view().slots.find((s) => s.id === 1)!.isAi).toBe(true);
  });
});
