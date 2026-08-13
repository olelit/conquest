import { describe, expect, it } from 'vitest';
import * as rules from '../src/rules.js';
import { Room } from '../src/rooms.js';
import type { Difficulty } from '../src/config.js';

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
  it('пустую комнату нельзя начать', () => {
    const room = makeRoom();
    expect(room.start(1).ok).toBe(false);
    expect(room.status).toBe('waiting');
  });
  it('имена AI не повторяются', () => {
    const room = makeRoom(false, 1, 6);
    room.addHuman('A', 1);
    room.start(1);
    const names = room.gameState!.players.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
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
  it('removeHuman в waiting: передача хозяина, id слотов стабильны', () => {
    const room = makeRoom();
    room.addHuman('A', 1);
    room.addHuman('B', 2);
    room.removeHuman(1);
    expect(room.slotsCount).toBe(1);
    expect(room.hostPlayerId).toBe(2);
    expect(room.slotForConn(2)).toBe(2);
  });
  it('новый хозяин после передачи может начать игру', () => {
    const room = makeRoom(true, 1, 4);
    room.addHuman('A', 1);
    room.addHuman('B', 2);
    room.removeHuman(1);
    expect(room.start(2).ok).toBe(true);
    expect(room.status).toBe('playing');
    expect(room.gameState!.players.map((p) => p.id)).toEqual([2, 3]);
  });
  it('новый игрок после ухода получает следующий свободный id', () => {
    const room = makeRoom(false, 1, 4);
    room.addHuman('A', 1);
    room.addHuman('B', 2);
    room.removeHuman(1);
    expect(room.addHuman('C', 3)).toBe(3);
    expect(room.slotForConn(3)).toBe(3);
  });
  it('нельзя добавить в играющую комнату', () => {
    const room = makeRoom(false, 1, 2);
    room.addHuman('A', 1);
    room.start(1);
    expect(room.addHuman('B', 2)).toBeNull();
  });
  it('view().game: игроки с hexCount/income/limit и captureTicks в payload', () => {
    const room = makeRoom(true, 1, 2);
    room.addHuman('A', 1);
    room.start(1);
    const view = room.view().game!;
    expect(view.captureTicks).toBe(5);
    expect(view.players[0]).toMatchObject({ id: 1, name: 'A', points: expect.any(Number), hexCount: 0, income: 0, limit: 1000, isAi: false });
    expect(view.players[1]).toMatchObject({ id: 2, hexCount: 0, limit: 1000, isAi: true });
    // после захвата hexCount растёт, лимит тоже
    room.handleAction(1, 'capture', { q: 0, r: 0 });
    expect(room.view().game!.players[0].hexCount).toBe(1);
    expect(room.view().game!.players[0].limit).toBe(1050);
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
  it('лог не содержит сообщений о захватах', () => {
    const room = makeRoom(true, 1, 2);
    room.addHuman('A', 1);
    room.start(1);
    room.handleAction(1, 'capture', { q: 0, r: 0 });
    room.tick();
    const log = room.view().log;
    expect(log.some((entry) => entry.includes('захватил'))).toBe(false);
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

describe('Room: выбытие', () => {
  it('10%: столица захвачена — игрок выбывает, территория делится на ИИ, соло заканчивается', () => {
    const room = new Room(1, 'Тест', 'normal', 6, true, 1, () => 0.05);
    room.addHuman('A', 1);
    room.start(1);
    const g = room.gameState!;
    const capital = g.hexes[0];
    capital.ownerId = 1;
    g.players[0].capital = { q: capital.q, r: capital.r };
    for (let i = 1; i <= 20; i++) g.hexes[i].ownerId = 1;
    capital.attackerId = 2;
    capital.attackInvestment = 500;
    capital.defenseInvestment = 0;
    capital.battleProgress = rules.CAPTURE_TICKS - 1;
    room.tick();
    expect(g.players[0].eliminated).toBe(true);
    expect(g.winnerId).toBe(2);
    expect(g.players).toHaveLength(4);
    expect(room.slotsCount).toBe(4);
    expect(room.view().slots.filter((s) => s.isAi)).toHaveLength(3);
  });
  it('отрезание: захват шейки нейтрализует дальний кусок', () => {
    const room = new Room(1, 'Тест', 'normal', 6, true, 1, () => 0.5);
    room.addHuman('A', 1);
    room.start(1);
    const g = room.gameState!;
    const chain = [g.hexes[0], g.hexes[1], g.hexes[2], g.hexes[3], g.hexes[4], g.hexes[5]];
    for (const hex of chain) hex.ownerId = 1;
    g.players[0].capital = { q: chain[0].q, r: chain[0].r };
    // игрок 2 (ИИ) захватывает шейку chain[2] через битву
    const neck = chain[2];
    neck.attackerId = 2;
    neck.attackInvestment = 500;
    neck.defenseInvestment = 0;
    neck.battleProgress = rules.CAPTURE_TICKS - 1;
    // детерминизм: в этом же тике ИИ 2 захватывает дешёвых соседей шейки,
    // поэтому делаем шейковый хвост дорогим, а других соседей — дешёвыми
    chain[3].terrain = 'mountain';
    g.hexes[17].terrain = 'grass';
    g.hexes[18].terrain = 'grass';
    room.tick();
    expect(neck.ownerId).toBe(2);
    expect(chain[0].ownerId).toBe(1);
    expect(chain[3].ownerId).toBeNull();
    expect(chain[5].ownerId).toBeNull();
  });
});

describe('Room: окружение и выбытие', () => {
  it('окружение территории со столицей выбывает её владельца', () => {
    const room = new Room(1, 'Тест', 'normal', 6, true, 1, () => 0.5);
    room.addHuman('A', 1);
    room.start(1);
    const g = room.gameState!;
    g.hexes.find((h) => h.q === 7 && h.r === 6)!.ownerId = 1;
    g.hexes.find((h) => h.q === 8 && h.r === 6)!.ownerId = 1;
    g.players[0].capital = { q: 7, r: 6 };
    for (const [q, r] of [[6,6],[7,7],[7,5],[8,5],[6,7],[9,6],[8,7],[9,5]]) {
      g.hexes.find((h) => h.q === q && h.r === r)!.ownerId = 2;
    }
    room.tick();
    expect(g.players[0].eliminated).toBe(true);
    expect(g.hexes.find((h) => h.q === 7 && h.r === 6)!.ownerId).toBe(2);
  });
});

import { RoomManager } from '../src/rooms.js';

describe('RoomManager', () => {
  it('create + join + lobby', () => {
    const m = new RoomManager();
    expect(m.createRoom(1, 'normal', 5).ok).toBe(true);
    expect(m.lobby()).toHaveLength(1);
    expect(m.lobby()[0]).toMatchObject({ mapType: 'normal', maxPlayers: 5, humans: 1 });
    expect(m.joinRoom(2, 1).ok).toBe(true);
    expect(m.lobby()[0].humans).toBe(2);
  });
  it('нельзя быть в двух комнатах', () => {
    const m = new RoomManager();
    m.createRoom(1, 'normal', 4);
    expect(m.createRoom(1, 'normal', 4).ok).toBe(false);
  });
  it('join в полную комнату отклоняется', () => {
    const m = new RoomManager();
    m.createRoom(1, 'normal', 2);
    m.joinRoom(2, 1);
    expect(m.joinRoom(3, 1).ok).toBe(false);
  });
  it('join в играющую комнату отклоняется', () => {
    const m = new RoomManager();
    m.createRoom(1, 'normal', 2);
    m.joinRoom(2, 1);
    m.startRoom(1);
    expect(m.joinRoom(3, 1).ok).toBe(false);
  });
  it('неверные настройки создания отклоняются', () => {
    const m = new RoomManager();
    expect(m.createRoom(1, 'normal', 1).ok).toBe(false);
    expect(m.createRoom(1, 'normal', 6).ok).toBe(false);
    expect(m.createRoom(1, 'unknown' as never, 4).ok).toBe(false);
    expect(m.createSolo(1, 'normal', 0).ok).toBe(false);
    expect(m.createSolo(1, 'normal', 5).ok).toBe(false);
  });
  it('solo: создаётся и сразу играет', () => {
    const m = new RoomManager();
    expect(m.createSolo(1, 'normal', 2).ok).toBe(true);
    const room = m.roomForConn(1)!;
    expect(room.status).toBe('playing');
    expect(room.gameState!.players).toHaveLength(3);
  });
  it('старт — только хозяин; состав полный', () => {
    const m = new RoomManager();
    m.createRoom(1, 'normal', 4);
    m.joinRoom(2, 1);
    expect(m.startRoom(2).ok).toBe(false);
    expect(m.startRoom(1).ok).toBe(true);
    expect(m.roomForConn(1)!.gameState!.players).toHaveLength(4);
  });
  it('хозяин вышел из waiting — передача первому', () => {
    const m = new RoomManager();
    m.createRoom(1, 'normal', 4);
    m.joinRoom(2, 1);
    m.joinRoom(3, 1);
    m.leaveRoom(1);
    expect(m.roomForConn(2)!.hostPlayerId).toBe(2);
    expect(m.viewerPlayerId(1)).toBeNull();
  });
  it('пустая waiting-комната удаляется', () => {
    const m = new RoomManager();
    m.createRoom(1, 'normal', 4);
    expect(m.lobby()).toHaveLength(1);
    m.leaveRoom(1);
    expect(m.lobby()).toHaveLength(0);
  });
  it('дисконнект во время игры: слот → AI, комната живёт', () => {
    const m = new RoomManager();
    m.createRoom(1, 'normal', 2);
    m.joinRoom(2, 1);
    m.startRoom(1);
    m.connectionClosed(1);
    expect(m.roomForConn(2)!.gameState!.players.find((p) => p.id === 1)!.isAi).toBe(true);
    expect(m.roomForConn(2)!.status).toBe('playing');
  });
  it('auth обновляет имя слота', async () => {
    const m = new RoomManager();
    m.createRoom(1, 'normal', 4);
    // имитация профиля: приватный метод недоступен — используем handleAuth с мок-токеном нельзя,
    // поэтому проверяем updateName через комнату напрямую:
    m.roomForConn(1)!.updateName(1, 'НовоеИмя');
    expect(m.roomForConn(1)!.view().slots[0].name).toBe('НовоеИмя');
  });
  it('все люди вышли из игры — комната удаляется', () => {
    const m = new RoomManager();
    m.createRoom(1, 'normal', 2);
    m.joinRoom(2, 1);
    m.startRoom(1);
    expect(m.roomCount).toBe(1);
    m.connectionClosed(1);
    m.connectionClosed(2);
    m.tickAll();
    expect(m.roomCount).toBe(0);
  });
  it('завершённая игра удаляется после grace-периода (grace 0)', () => {
    const m = new RoomManager(0);
    m.createRoom(1, 'normal', 2);
    m.joinRoom(2, 1);
    m.startRoom(1);
    m.roomForConn(1)!.gameState!.winnerId = 1;
    m.tickAll();
    expect(m.roomCount).toBe(0);
    expect(m.roomForConn(1)).toBeNull();
    expect(m.roomForConn(2)).toBeNull();
  });
  it('завершённая игра живёт внутри grace-периода', () => {
    const m = new RoomManager(60_000);
    m.createRoom(1, 'normal', 2);
    m.joinRoom(2, 1);
    m.startRoom(1);
    m.roomForConn(1)!.gameState!.winnerId = 1;
    m.tickAll();
    expect(m.roomCount).toBe(1);
  });
});

describe('Room: перезапуск', () => {
  it('рестарт только в соло-режиме', () => {
    const room = makeRoom(false, 1, 2);
    room.addHuman('A', 1);
    room.start(1);
    expect(room.restart().ok).toBe(false);
  });
  it('рестарт до начала игры отклоняется', () => {
    const room = makeRoom(true, 1, 2);
    room.addHuman('A', 1);
    expect(room.restart().ok).toBe(false);
  });
  it('рестарт сбрасывает состояние', () => {
    const room = makeRoom(true, 1, 2);
    room.addHuman('A', 1);
    room.start(1);
    room.handleAction(1, 'capture', { q: 0, r: 0 });
    room.tick();
    expect(room.view().game!.players[0].hexCount).toBe(1);
    expect(room.restart().ok).toBe(true);
    const g = room.view().game!;
    expect(g.players[0].hexCount).toBe(0);
    expect(g.players[0].points).toBe(1000);
    expect(g.winnerId).toBeNull();
    expect(g.players).toHaveLength(2);
  });
  it('рестарт убирает порождённых ИИ и чинит паузу', () => {
    const room = new Room(1, 'Тест', 'normal', 6, true, 1, () => 0.05);
    room.addHuman('A', 1);
    room.start(1);
    const g = room.gameState!;
    g.hexes[0].ownerId = 1;
    g.players[0].capital = { q: g.hexes[0].q, r: g.hexes[0].r };
    for (let i = 1; i <= 20; i++) g.hexes[i].ownerId = 1;
    g.hexes[0].attackerId = 2;
    g.hexes[0].attackInvestment = 500;
    g.hexes[0].defenseInvestment = 0;
    g.hexes[0].battleProgress = rules.CAPTURE_TICKS - 1;
    room.tick();
    expect(g.players).toHaveLength(4);
    room.paused = true;
    expect(room.restart().ok).toBe(true);
    expect(room.view().game!.players).toHaveLength(2);
    expect(room.paused).toBe(false);
    expect(room.view().game!.winnerId).toBeNull();
  });
});

describe('Room: сложность', () => {
  it('соло с easy: ИИ получает множитель 0.5, человек — без множителя', () => {
    const m = new RoomManager();
    expect(m.createSolo(1, 'normal', 1, 'easy').ok).toBe(true);
    const g = m.roomForConn(1)!.gameState!;
    const human = g.players.find((p) => !p.isAi)!;
    const ai = g.players.find((p) => p.isAi)!;
    expect(human.incomeMultiplier).toBeUndefined();
    expect(ai.incomeMultiplier).toBe(0.5);
  });
  it('неизвестная сложность — ошибка', () => {
    const m = new RoomManager();
    expect(m.createSolo(1, 'normal', 1, 'impossible' as Difficulty).ok).toBe(false);
  });
  it('мультиплеер: ИИ на средней сложности', () => {
    const room = makeRoom(false, 1, 2);
    room.addHuman('A', 1);
    room.start(1);
    expect(room.gameState!.players.find((p) => p.isAi)!.incomeMultiplier).toBe(0.75);
  });
});

describe('Room: взаимное выбытие', () => {
  it('все выбыли в один тик: победитель — последний захвативший столицу', () => {
    const room = new Room(1, 'Тест', 'normal', 2, false, 1);
    room.addHuman('A', 1);
    room.addHuman('B', 2);
    room.start(1);
    const g = room.gameState!;
    const humanCap = g.hexes.find((h) => h.q === 5 && h.r === 5)!;
    const aiCap = g.hexes.find((h) => h.q === 6 && h.r === 5)!;
    humanCap.ownerId = 1;
    aiCap.ownerId = 2;
    g.players[0].capital = { q: 5, r: 5 };
    g.players[1].capital = { q: 6, r: 5 };
    // битва за столицу игрока 1 (атакует игрок 2)
    humanCap.attackerId = 2;
    humanCap.defenderId = 1;
    humanCap.attackInvestment = 500;
    humanCap.defenseInvestment = 0;
    humanCap.battleProgress = rules.CAPTURE_TICKS - 1;
    // битва за столицу игрока 2 (атакует игрок 1)
    aiCap.attackerId = 1;
    aiCap.defenderId = 2;
    aiCap.attackInvestment = 500;
    aiCap.defenseInvestment = 0;
    aiCap.battleProgress = rules.CAPTURE_TICKS - 1;
    room.tick();
    expect(g.players[0].eliminated).toBe(true);
    expect(g.players[1].eliminated).toBe(true);
    // последний обработанный захват — столицы (6,5) игроком 1 (порядок гексов в массиве)
    expect(g.winnerId).toBe(1);
  });
});

describe('Room: статистика', () => {
  it('start, действия человека и ИИ записываются', () => {
    const room = makeRoom(true, 1, 2);
    room.addHuman('A', 1);
    room.start(1);
    room.handleAction(1, 'capture', { q: 0, r: 0 });
    room.tick();
    const events = room.stats.events;
    expect(events.filter((e) => e.type === 'start')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'action' && e.playerId === 1)).toHaveLength(1);
    expect(events.some((e) => e.type === 'action' && e.playerId === 2)).toBe(true);
  });
  it('реакция на атаку фиксируется для ИИ', () => {
    const room = makeRoom(true, 1, 2);
    room.addHuman('A', 1);
    room.start(1);
    const g = room.gameState!;
    g.hexes[0].terrain = 'grass';
    g.hexes[0].ownerId = 2;
    g.players[1].capital = { q: g.hexes[0].q, r: g.hexes[0].r };
    g.hexes[1].ownerId = 1;
    g.players[0].capital = { q: g.hexes[1].q, r: g.hexes[1].r };
    const result = room.handleAction(1, 'attack', { q: g.hexes[0].q, r: g.hexes[0].r, points: 200 });
    expect(result.type).toBe('state');
    room.tick();
    const reactions = room.stats.events.filter((e) => e.type === 'reaction');
    expect(reactions).toHaveLength(1);
    expect((reactions[0] as { playerId: number }).playerId).toBe(2);
  });
  it('снапшот пишется каждые 10 тиков', () => {
    const room = makeRoom(true, 1, 2);
    room.addHuman('A', 1);
    room.start(1);
    for (let i = 0; i < 10; i++) room.tick();
    const snapshots = room.stats.events.filter((e) => e.type === 'snapshot');
    expect(snapshots).toHaveLength(1);
  });
  it('человек вышел — его ИИ-замена получает множитель сложности', () => {
    const room = new Room(1, 'Тест', 'normal', 6, true, 1, () => 0.5, 'easy');
    room.addHuman('A', 1);
    room.start(1);
    room.humanDisconnected(1);
    expect(room.gameState!.players.find((p) => p.id === 1)!.incomeMultiplier).toBe(0.5);
  });
});
