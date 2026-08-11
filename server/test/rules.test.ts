import { describe, expect, it } from 'vitest';
import { MAP_COLUMNS, MAP_ROWS } from '../src/map.js';
import {
  applyAttack,
  applyCapture,
  applyDefend,
  applyEnclosure,
  applyIncome,
  BASE_POINTS,
  CAPTURE_TICKS,
  computeWinner,
  DRAIN_PER_TICK,
  findHex,
  hasAdjacentOwner,
  hexCount,
  isAdjacent,
  isInBounds,
  playerIncome,
  pointLimit,
  terrainCost,
  TERRAIN_COSTS,
  tickBattles,
  validateAttack,
  validateCapture,
  validateDefend,
  WIN_HEX_COUNT,
  type GameState,
  type HexState,
  type PlayerState,
} from '../src/rules.js';

function makeState(hexes: Partial<HexState>[] = [], players: { id: number; points: number }[] = [{ id: 1, points: 1000 }, { id: 2, points: 1000 }]): GameState {
  const h: HexState[] = [];
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let q = 0; q < MAP_COLUMNS; q++) {
      h.push({ q, r, terrain: 'grass', ownerId: null, attackerId: null, defenderId: null, attackInvestment: 0, defenseInvestment: 0, battleProgress: 0 });
    }
  }
  for (const p of hexes) {
    const hex = h.find((x) => x.q === p.q && x.r === p.r);
    if (hex) Object.assign(hex, p);
  }
  return { players: players.map((p) => ({ id: p.id, points: p.points })), hexes: h, winnerId: null };
}

const P = 1;
const AI = 2;

describe('константы', () => {
  it('стоимости по террейнам', () => {
    expect(TERRAIN_COSTS).toEqual({ grass: 150, desert: 200, forest: 250, water: 350, mountain: 450, mine: 450 });
    expect(terrainCost('forest')).toBe(250);
  });
  it('лимит очков', () => {
    expect(BASE_POINTS).toBe(1000);
    expect(pointLimit(0)).toBe(1000);
    expect(pointLimit(5)).toBe(1250);
  });
});

describe('геометрия', () => {
  it('соседство axial', () => {
    expect(isAdjacent({ q: 5, r: 3 }, { q: 6, r: 3 })).toBe(true);
    expect(isAdjacent({ q: 5, r: 3 }, { q: 4, r: 3 })).toBe(true);
    expect(isAdjacent({ q: 5, r: 3 }, { q: 5, r: 4 })).toBe(true);
    expect(isAdjacent({ q: 5, r: 3 }, { q: 5, r: 2 })).toBe(true);
    expect(isAdjacent({ q: 5, r: 3 }, { q: 6, r: 2 })).toBe(true);
    expect(isAdjacent({ q: 5, r: 3 }, { q: 4, r: 4 })).toBe(true);
    expect(isAdjacent({ q: 5, r: 3 }, { q: 6, r: 4 })).toBe(false);
    expect(isAdjacent({ q: 5, r: 3 }, { q: 5, r: 3 })).toBe(false);
  });
  it('границы поля', () => {
    expect(isInBounds(0, 0)).toBe(true);
    expect(isInBounds(15, 11)).toBe(true);
    expect(isInBounds(16, 0)).toBe(false);
    expect(isInBounds(-1, 0)).toBe(false);
    expect(isInBounds(0, 12)).toBe(false);
  });
});

describe('первый бесплатный захват', () => {
  it('игрок с 0 гексов может захватить любой нейтральный гекс бесплатно', () => {
    const s = makeState();
    expect(validateCapture(s, P, 15, 11)).toEqual({ ok: true });
    applyCapture(s, P, 15, 11);
    expect(findHex(s, 15, 11)!.ownerId).toBe(P);
    expect(s.players[0].points).toBe(1000);
  });
  it('нельзя захватить гекс соперника', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: AI }]);
    expect(validateCapture(s, P, 5, 5).ok).toBe(false);
  });
  it('гекс в битве нельзя захватить', () => {
    const s = makeState([{ q: 5, r: 5, attackerId: AI, attackInvestment: 300 }]);
    expect(validateCapture(s, P, 5, 5).ok).toBe(false);
  });
});

describe('захват нейтрального гекса', () => {
  it('только соседний и по цене', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: P }]);
    const s1 = makeState([{ q: 5, r: 5, ownerId: P }]);
    expect(validateCapture(s, P, 4, 5).ok).toBe(true);
    applyCapture(s, P, 4, 5);
    expect(findHex(s, 4, 5)!.ownerId).toBe(P);
    expect(s.players[0].points).toBe(850);
    expect(validateCapture(s1, P, 6, 7).ok).toBe(false);
    expect(validateCapture(s1, P, 5, 5).ok).toBe(false);
  });
  it('стоимость зависит от террейна', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: P }, { q: 6, r: 5, terrain: 'mountain' }]);
    applyCapture(s, P, 6, 5);
    expect(s.players[0].points).toBe(550);
  });
  it('не хватает очков', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: P }], [{ id: 1, points: 100 }, { id: 2, points: 1000 }]);
    expect(validateCapture(s, P, 6, 5).ok).toBe(false);
  });
  it('армия резервирует очки и уменьшает доступный бюджет', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: P }], [{ id: 1, points: 1000 }, { id: 2, points: 1000 }]);
    expect(validateCapture(s, P, 6, 5, 900).ok).toBe(false);
    expect(validateCapture(s, P, 6, 5, 800).ok).toBe(true);
  });
});

describe('захват нейтрального гекса у границы соперника порождает битву', () => {
  it('соседний с территорией ИИ — битва вместо мгновенного захвата', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: P }, { q: 3, r: 5, ownerId: AI }]);
    applyCapture(s, P, 4, 5);
    const hex = findHex(s, 4, 5)!;
    expect(hex.ownerId).toBeNull();
    expect(hex.attackerId).toBe(P);
    expect(hex.attackInvestment).toBe(150);
    expect(hex.battleProgress).toBe(0);
    expect(s.players[0].points).toBe(850);
  });
  it('не соседний с соперником — мгновенный захват', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: P }, { q: 9, r: 9, ownerId: AI }]);
    applyCapture(s, P, 6, 5);
    expect(findHex(s, 6, 5)!.ownerId).toBe(P);
  });
  it('бесплатный первый гекс у границы ИИ — битва с вложением 1 очко', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI }]);
    applyCapture(s, P, 5, 5);
    const hex = findHex(s, 5, 5)!;
    expect(hex.attackerId).toBe(P);
    expect(hex.attackInvestment).toBe(1);
  });
});

describe('атака на гекс соперника', () => {
  it('валидна только для соседнего гекса соперника', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: P }, { q: 7, r: 5, ownerId: AI }]);
    expect(validateAttack(s, P, 7, 5, 100).ok).toBe(false);
    const s2 = makeState([{ q: 5, r: 5, ownerId: P }, { q: 6, r: 5, ownerId: AI }]);
    expect(validateAttack(s2, P, 6, 5, 150).ok).toBe(true);
  });
  it('требует очки и целое число ≥ 1', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: P }, { q: 6, r: 5, ownerId: AI }]);
    expect(validateAttack(s, P, 6, 5, 0).ok).toBe(false);
    expect(validateAttack(s, P, 6, 5, 1.5).ok).toBe(false);
    const poor = makeState([{ q: 5, r: 5, ownerId: P }, { q: 6, r: 5, ownerId: AI }], [{ id: 1, points: 50 }, { id: 2, points: 1000 }]);
    expect(validateAttack(poor, P, 6, 5, 100).ok).toBe(false);
  });
  it('нельзя атаковать свой гекс или гекс, атакуемый соперником', () => {
    const s1 = makeState([{ q: 5, r: 5, ownerId: P }]);
    expect(validateAttack(s1, P, 5, 5, 50).ok).toBe(false);
    const s2 = makeState([{ q: 5, r: 5, ownerId: P, attackerId: AI, attackInvestment: 100 }]);
    expect(validateAttack(s2, P, 5, 5, 50).ok).toBe(false);
    const s3 = makeState([{ q: 5, r: 5, ownerId: P }, { q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 100 }]);
    expect(validateAttack(s3, P, 6, 5, 50).ok).toBe(true);
  });
  it('долив в свою атаку увеличивает вложение', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: P }, { q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 100 }]);
    applyAttack(s, P, 6, 5, 50);
    expect(findHex(s, 6, 5)!.attackInvestment).toBe(150);
    expect(s.players[0].points).toBe(950);
  });
  it('первая атака требует минимум — стоимость гекса', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: P }, { q: 6, r: 5, terrain: 'mountain', ownerId: AI }]);
    expect(validateAttack(s, P, 6, 5, 449).ok).toBe(false);
    expect(validateAttack(s, P, 6, 5, 450).ok).toBe(true);
  });
  it('долив в свою атаку может быть меньше стоимости', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: P }, { q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 500 }]);
    expect(validateAttack(s, P, 6, 5, 10).ok).toBe(true);
  });
  it('вложение защитника во время захвата атакующего сбрасывает прогресс', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 300, battleProgress: 2 }]);
    applyDefend(s, AI, 6, 5, 100);
    expect(findHex(s, 6, 5)!.battleProgress).toBe(0);
    expect(findHex(s, 6, 5)!.defenseInvestment).toBe(100);
  });
  it('долив атакующего, пока он сам захватывает, не сбрасывает прогресс', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 300, battleProgress: 2 }]);
    applyAttack(s, P, 6, 5, 100);
    expect(findHex(s, 6, 5)!.battleProgress).toBe(2);
    expect(findHex(s, 6, 5)!.attackInvestment).toBe(400);
  });
});

describe('оборона', () => {
  it('владелец защищает свой гекс', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 300 }]);
    expect(validateDefend(s, AI, 6, 5, 100).ok).toBe(true);
    applyDefend(s, AI, 6, 5, 100);
    expect(findHex(s, 6, 5)!.defenseInvestment).toBe(100);
    expect(s.players[1].points).toBe(900);
  });
  it('не-владелец не может защищать гекс соперника', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 300 }]);
    expect(validateDefend(s, P, 6, 5, 100).ok).toBe(false);
  });
  it('вступить в спор о нейтральном гексе можно только соседнему', () => {
    const s = makeState([{ q: 4, r: 5, attackerId: P, attackInvestment: 300 }, { q: 7, r: 5, ownerId: AI }]);
    expect(validateDefend(s, AI, 4, 5, 100).ok).toBe(false);
    const s2 = makeState([{ q: 4, r: 5, attackerId: P, attackInvestment: 300 }, { q: 5, r: 5, ownerId: AI }]);
    expect(validateDefend(s2, AI, 4, 5, 100).ok).toBe(true);
  });
  it('без битвы защищаться нельзя', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: P }]);
    expect(validateDefend(s, P, 5, 5, 10).ok).toBe(false);
  });
  it('защищать свою же атаку нельзя', () => {
    const s = makeState([{ q: 5, r: 5, attackerId: P, attackInvestment: 300 }]);
    expect(validateDefend(s, P, 5, 5, 10).ok).toBe(false);
  });
  it('защита фиксирует defender_id', () => {
    const s = makeState([{ q: 4, r: 5, attackerId: P, attackInvestment: 300 }, { q: 5, r: 5, ownerId: AI }]);
    applyDefend(s, AI, 4, 5, 100);
    expect(findHex(s, 4, 5)!.defenderId).toBe(AI);
  });
});

describe('тик битвы: трата', () => {
  it('оба пула тратятся по DRAIN_PER_TICK за тик', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 600, defenseInvestment: 300 }]);
    tickBattles(s);
    expect(findHex(s, 6, 5)!.attackInvestment).toBe(590);
    expect(findHex(s, 6, 5)!.defenseInvestment).toBe(290);
  });
  it('пул не уходит в минус', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 5, defenseInvestment: 100 }]);
    tickBattles(s);
    expect(findHex(s, 6, 5)!.attackInvestment).toBe(0);
  });
  it('ничья: оба пула дошли до 0 — битва заканчивается без победителя, гекс у владельца', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 100, defenseInvestment: 100 }]);
    const results: { q: number; r: number; winnerId: number | null }[] = [];
    for (let i = 0; i < 10; i++) results.push(...tickBattles(s));
    const hex = findHex(s, 6, 5)!;
    expect(hex.ownerId).toBe(AI);
    expect(hex.attackerId).toBeNull();
    expect(hex.attackInvestment).toBe(0);
    expect(hex.defenseInvestment).toBe(0);
    expect(results).toEqual([{ q: 6, r: 5, winnerId: null }]);
  });
});

describe('тик битвы: захват', () => {
  it('пул соперника на нуле — начинается захват, пул победителя заморожен', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 300 }]);
    tickBattles(s);
    const hex = findHex(s, 6, 5)!;
    expect(hex.battleProgress).toBe(1);
    expect(hex.attackInvestment).toBe(300);
  });
  it('через CAPTURE_TICKS тиков захват завершается: гекс у атакующего, остаток пула возвращается', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 300 }], [{ id: 1, points: 100 }, { id: 2, points: 900 }]);
    const results: { q: number; r: number; winnerId: number | null }[] = [];
    for (let i = 0; i < CAPTURE_TICKS; i++) results.push(...tickBattles(s));
    const hex = findHex(s, 6, 5)!;
    expect(hex.ownerId).toBe(P);
    expect(hex.attackerId).toBeNull();
    expect(hex.attackInvestment).toBe(0);
    expect(hex.defenseInvestment).toBe(0);
    expect(hex.battleProgress).toBe(0);
    expect(s.players[0].points).toBe(400);
    expect(s.players[1].points).toBe(900);
    expect(results).toEqual([{ q: 6, r: 5, winnerId: P }]);
  });
  it('вложение защитника во время захвата отменяет его и возобновляет трату', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 300 }], [{ id: 1, points: 400 }, { id: 2, points: 900 }]);
    tickBattles(s);
    expect(findHex(s, 6, 5)!.battleProgress).toBe(1);
    applyDefend(s, AI, 6, 5, 500);
    const hex = findHex(s, 6, 5)!;
    expect(hex.battleProgress).toBe(0);
    expect(hex.defenseInvestment).toBe(500);
    tickBattles(s);
    expect(findHex(s, 6, 5)!.attackInvestment).toBe(290);
    expect(findHex(s, 6, 5)!.defenseInvestment).toBe(490);
  });
  it('дрип-защита (малые вложения) не отменяет захват: пул атаки больше — захват завершается, остаток возвращается', () => {
    const s = makeState(
      [{ q: 6, r: 5, ownerId: AI, attackerId: P, defenderId: AI, attackInvestment: 800, defenseInvestment: 151 }],
      [{ id: 1, points: 200 }, { id: 2, points: 1000 }],
    );
    let result: { q: number; r: number; winnerId: number | null } | undefined;
    for (let i = 0; i < 10 && !result; i++) {
      result = tickBattles(s)[0];
      const hex = findHex(s, 6, 5)!;
      if (hex.attackerId !== null) applyDefend(s, AI, 6, 5, 21);
    }
    const hex = findHex(s, 6, 5)!;
    expect(hex.ownerId).toBe(P);
    expect(hex.attackerId).toBeNull();
    expect(s.players[0].points).toBeGreaterThan(200);
    expect(result).toEqual({ q: 6, r: 5, winnerId: P });
  });
  it('защитник отбивает свой гекс: пул атакующего сгорает, остаток защитника возвращается', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, defenderId: AI, attackerId: P, attackInvestment: 100, defenseInvestment: 600 }], [{ id: 1, points: 900 }, { id: 2, points: 400 }]);
    for (let i = 0; i < 15; i++) tickBattles(s);
    const hex = findHex(s, 6, 5)!;
    expect(hex.ownerId).toBe(AI);
    expect(hex.attackerId).toBeNull();
    expect(s.players[1].points).toBe(900);
    expect(s.players[0].points).toBe(900);
  });
  it('обороняющийся забирает нейтральный спорный гекс, если его пул выстоял', () => {
    const s = makeState([{ q: 4, r: 5, attackerId: P, defenderId: AI, attackInvestment: 100, defenseInvestment: 600 }, { q: 5, r: 5, ownerId: AI }]);
    for (let i = 0; i < 15; i++) tickBattles(s);
    expect(findHex(s, 4, 5)!.ownerId).toBe(AI);
  });
});

describe('экономика', () => {
  it('доход 3 очка за гекс с учётом лимита', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: P }, { q: 6, r: 5, ownerId: P }, { q: 4, r: 5, ownerId: P }]);
    applyIncome(s);
    expect(s.players[0].points).toBe(1009);
    const big = makeState();
    for (let i = 0; i < 40; i++) big.hexes[i].ownerId = P;
    big.players[0].points = 2970;
    applyIncome(big);
    expect(big.players[0].points).toBe(3000);
  });
  it('шахта даёт больше дохода', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: P }, { q: 6, r: 5, terrain: 'mine', ownerId: P }]);
    expect(playerIncome(s, P)).toBe(9);
    applyIncome(s);
    expect(s.players[0].points).toBe(1009);
  });
});

describe('окружение', () => {
  it('нейтральный гекс со всех сторон окружён игроком — становится его', () => {
    const s = makeState([
      { q: 4, r: 5, ownerId: P },
      { q: 6, r: 5, ownerId: P },
      { q: 5, r: 4, ownerId: P },
      { q: 5, r: 6, ownerId: P },
      { q: 6, r: 4, ownerId: P },
      { q: 4, r: 6, ownerId: P },
    ]);
    applyEnclosure(s);
    expect(findHex(s, 5, 5)!.ownerId).toBe(P);
  });
  it('гекс у края карты не окружается (за границей нет клеток)', () => {
    const s = makeState([
      { q: 0, r: 1, ownerId: P },
      { q: 1, r: 0, ownerId: P },
      { q: 1, r: 1, ownerId: P },
    ]);
    applyEnclosure(s);
    expect(findHex(s, 0, 0)!.ownerId).toBeNull();
  });
  it('гекс в битве не окружается', () => {
    const s = makeState([
      { q: 4, r: 5, ownerId: P },
      { q: 6, r: 5, ownerId: P },
      { q: 5, r: 4, ownerId: P },
      { q: 5, r: 6, ownerId: P },
      { q: 6, r: 4, ownerId: P },
      { q: 4, r: 6, ownerId: P },
      { q: 5, r: 5, attackerId: AI, attackInvestment: 100 },
    ]);
    applyEnclosure(s);
    expect(findHex(s, 5, 5)!.ownerId).toBeNull();
  });
  it('окружение работает для обоих игроков', () => {
    const s = makeState([
      { q: 4, r: 5, ownerId: P },
      { q: 6, r: 5, ownerId: P },
      { q: 5, r: 4, ownerId: P },
      { q: 5, r: 6, ownerId: P },
      { q: 6, r: 4, ownerId: P },
      { q: 4, r: 6, ownerId: P },
      { q: 9, r: 9, ownerId: AI },
      { q: 11, r: 9, ownerId: AI },
      { q: 10, r: 8, ownerId: AI },
      { q: 10, r: 10, ownerId: AI },
      { q: 11, r: 8, ownerId: AI },
      { q: 9, r: 10, ownerId: AI },
    ]);
    applyEnclosure(s);
    expect(findHex(s, 5, 5)!.ownerId).toBe(P);
    expect(findHex(s, 10, 9)!.ownerId).toBe(AI);
  });
  it('регион из нескольких окружённых клеток захватывается целиком', () => {
    const s = makeState([
      { q: 4, r: 5, ownerId: P },
      { q: 7, r: 5, ownerId: P },
      { q: 5, r: 4, ownerId: P },
      { q: 6, r: 4, ownerId: P },
      { q: 7, r: 4, ownerId: P },
      { q: 4, r: 6, ownerId: P },
      { q: 5, r: 7, ownerId: P },
      { q: 6, r: 7, ownerId: P },
      { q: 7, r: 6, ownerId: P },
      { q: 4, r: 7, ownerId: P },
    ]);
    applyEnclosure(s);
    expect(findHex(s, 5, 5)!.ownerId).toBe(P);
    expect(findHex(s, 6, 5)!.ownerId).toBe(P);
    expect(findHex(s, 5, 6)!.ownerId).toBe(P);
    expect(findHex(s, 6, 6)!.ownerId).toBe(P);
  });
  it('регион у края карты не захватывается', () => {
    const s = makeState([
      { q: 1, r: 0, ownerId: P },
      { q: 1, r: 1, ownerId: P },
      { q: 1, r: 2, ownerId: P },
      { q: 0, r: 2, ownerId: P },
    ]);
    applyEnclosure(s);
    expect(findHex(s, 0, 0)!.ownerId).toBeNull();
    expect(findHex(s, 0, 1)!.ownerId).toBeNull();
  });
  it('регион, окружённый территориями обоих игроков, никому не достаётся', () => {
    const s = makeState([
      { q: 4, r: 5, ownerId: P },
      { q: 6, r: 5, ownerId: AI },
      { q: 5, r: 4, ownerId: P },
      { q: 5, r: 6, ownerId: P },
      { q: 6, r: 4, ownerId: P },
      { q: 4, r: 6, ownerId: P },
    ]);
    applyEnclosure(s);
    expect(findHex(s, 5, 5)!.ownerId).toBeNull();
  });
  it('регион у гекса в битве не захватывается', () => {
    const s = makeState([
      { q: 4, r: 5, ownerId: P },
      { q: 7, r: 5, ownerId: P },
      { q: 5, r: 4, ownerId: P },
      { q: 6, r: 4, ownerId: P },
      { q: 7, r: 4, ownerId: P },
      { q: 4, r: 6, ownerId: P },
      { q: 5, r: 7, ownerId: P },
      { q: 6, r: 7, ownerId: P },
      { q: 7, r: 6, ownerId: P },
      { q: 4, r: 7, ownerId: P },
      { q: 5, r: 5, attackerId: AI, attackInvestment: 100 },
    ]);
    applyEnclosure(s);
    expect(findHex(s, 6, 5)!.ownerId).toBeNull();
    expect(findHex(s, 5, 6)!.ownerId).toBeNull();
  });
  it('гекс соперника, окружённый моими гексами, переходит мне', () => {
    const s = makeState([
      { q: 4, r: 5, ownerId: P },
      { q: 6, r: 5, ownerId: P },
      { q: 5, r: 4, ownerId: P },
      { q: 5, r: 6, ownerId: P },
      { q: 6, r: 4, ownerId: P },
      { q: 4, r: 6, ownerId: P },
      { q: 5, r: 5, ownerId: AI },
    ]);
    applyEnclosure(s);
    expect(findHex(s, 5, 5)!.ownerId).toBe(P);
  });
  it('регион из нескольких гексов соперника переходит целиком', () => {
    const s = makeState([
      { q: 4, r: 5, ownerId: P },
      { q: 7, r: 5, ownerId: P },
      { q: 5, r: 4, ownerId: P },
      { q: 6, r: 4, ownerId: P },
      { q: 7, r: 4, ownerId: P },
      { q: 4, r: 6, ownerId: P },
      { q: 6, r: 6, ownerId: P },
      { q: 5, r: 6, ownerId: P },
      { q: 5, r: 5, ownerId: AI },
      { q: 6, r: 5, ownerId: AI },
    ]);
    applyEnclosure(s);
    expect(findHex(s, 5, 5)!.ownerId).toBe(P);
    expect(findHex(s, 6, 5)!.ownerId).toBe(P);
  });
  it('гексы соперника у края карты не переходят', () => {
    const s = makeState([
      { q: 1, r: 0, ownerId: P },
      { q: 0, r: 1, ownerId: P },
      { q: 1, r: 1, ownerId: P },
      { q: 0, r: 0, ownerId: AI },
    ]);
    applyEnclosure(s);
    expect(findHex(s, 0, 0)!.ownerId).toBe(AI);
  });
  it('регион соперника с нейтральной дыркой не переходит', () => {
    const s = makeState([
      { q: 4, r: 5, ownerId: P },
      { q: 6, r: 5, ownerId: P },
      { q: 5, r: 4, ownerId: P },
      { q: 5, r: 6, ownerId: P },
      { q: 6, r: 4, ownerId: P },
      { q: 5, r: 5, ownerId: AI },
    ]);
    applyEnclosure(s);
    expect(findHex(s, 5, 5)!.ownerId).toBe(AI);
  });
  it('гекс соперника в битве не переходит', () => {
    const s = makeState([
      { q: 4, r: 5, ownerId: P },
      { q: 6, r: 5, ownerId: P },
      { q: 5, r: 4, ownerId: P },
      { q: 5, r: 6, ownerId: P },
      { q: 6, r: 4, ownerId: P },
      { q: 4, r: 6, ownerId: P },
      { q: 5, r: 5, ownerId: AI, attackerId: P, attackInvestment: 200 },
    ]);
    applyEnclosure(s);
    expect(findHex(s, 5, 5)!.ownerId).toBe(AI);
  });
});

describe('победа', () => {
  it('победа при ≥97 гексов', () => {
    const s = makeState();
    for (let i = 0; i < 96; i++) s.hexes[i].ownerId = P;
    computeWinner(s);
    expect(s.winnerId).toBeNull();
    s.hexes[96].ownerId = P;
    computeWinner(s);
    expect(s.winnerId).toBe(P);
  });
});

describe('вспомогательные', () => {
  it('hexCount и hasAdjacentOwner', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: P }, { q: 5, r: 4, ownerId: AI }]);
    expect(hexCount(s, P)).toBe(1);
    expect(hasAdjacentOwner(s, 4, 5, AI)).toBe(true);
    expect(hasAdjacentOwner(s, 7, 7, AI)).toBe(false);
  });
  it('константы захвата', () => {
    expect(WIN_HEX_COUNT).toBe(97);
    expect(CAPTURE_TICKS).toBe(5);
    expect(DRAIN_PER_TICK).toBe(10);
  });
});
