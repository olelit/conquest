import { describe, expect, it } from 'vitest';
import { MAP_COLUMNS, MAP_PRESETS, MAP_ROWS, generateMap, type Terrain } from '../src/map.js';
import {
  applyAttack,
  applyCapture,
  applyCut,
  applyDefend,
  applyEnclosure,
  applyIncome,
  BASE_POINTS,
  CAPTURE_TICKS,
  computeWinner,
  DRAIN_PER_TICK,
  eliminateIfCapitalLost,
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
  winHexCount,
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
  return { players: players.map((p) => ({ id: p.id, points: p.points })), hexes: h, columns: MAP_COLUMNS, rows: MAP_ROWS, winnerId: null };
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
  it('границы поля (обычная 16x12)', () => {
    const s = makeState();
    expect(isInBounds(s, 0, 0)).toBe(true);
    expect(isInBounds(s, 15, 11)).toBe(true);
    expect(isInBounds(s, 16, 0)).toBe(false);
    expect(isInBounds(s, -1, 0)).toBe(false);
    expect(isInBounds(s, 0, 12)).toBe(false);
  });
  it('границы поля (длинная 24x9)', () => {
    const long = makeState([], [{ id: 1, points: 1000 }, { id: 2, points: 1000 }]);
    long.columns = 24;
    long.rows = 9;
    expect(isInBounds(long, 23, 8)).toBe(true);
    expect(isInBounds(long, 24, 8)).toBe(false);
    expect(isInBounds(long, 23, 9)).toBe(false);
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
  it('первый гекс не может быть на воде', () => {
    const s = makeState([{ q: 5, r: 5, terrain: 'water' }]);
    expect(validateCapture(s, P, 5, 5).ok).toBe(false);
    const s2 = makeState([{ q: 5, r: 5, terrain: 'water' }]);
    expect(validateCapture(s2, P, 6, 5).ok).toBe(true);
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
  it('бесплатный первый гекс у границы ИИ — битва с реальным пулом (стоимость гекса)', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI }]);
    applyCapture(s, P, 5, 5);
    const hex = findHex(s, 5, 5)!;
    expect(hex.attackerId).toBe(P);
    expect(hex.attackInvestment).toBe(150);
    expect(s.players[0].points).toBe(850);
  });
  it('первый гекс у границы врага не берётся без очков', () => {
    const poor = makeState([{ q: 6, r: 5, ownerId: AI }], [{ id: 1, points: 100 }, { id: 2, points: 1000 }]);
    expect(validateCapture(poor, P, 5, 5).ok).toBe(false);
    const far = makeState([{ q: 9, r: 9, ownerId: AI }], [{ id: 1, points: 100 }, { id: 2, points: 1000 }]);
    expect(validateCapture(far, P, 5, 5).ok).toBe(true);
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
  it('атакующий может долить в свою атаку на нейтральном спорном гексе', () => {
    const s = makeState([{ q: 4, r: 5, attackerId: P, attackInvestment: 300, defenseInvestment: 200 }]);
    expect(validateAttack(s, P, 4, 5, 100).ok).toBe(true);
    applyAttack(s, P, 4, 5, 100);
    expect(findHex(s, 4, 5)!.attackInvestment).toBe(400);
    expect(validateAttack(s, AI, 4, 5, 100).ok).toBe(false);
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
  it('вложения не сбрасывают прогресс — они меняют лидера', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 300, battleProgress: 2 }]);
    applyDefend(s, AI, 6, 5, 400);
    expect(findHex(s, 6, 5)!.battleProgress).toBe(2);
    expect(findHex(s, 6, 5)!.defenseInvestment).toBe(400);
    applyAttack(s, P, 6, 5, 200);
    expect(findHex(s, 6, 5)!.battleProgress).toBe(2);
    expect(findHex(s, 6, 5)!.attackInvestment).toBe(500);
  });
});

describe('N игроков', () => {
  function makeState3(hexes: Partial<HexState>[] = []): GameState {
    return makeState(hexes, [
      { id: 1, points: 1000 },
      { id: 2, points: 1000 },
      { id: 3, points: 1000 },
    ]);
  }
  it('захват нейтрального гекса рядом с любым соперником порождает битву', () => {
    const s = makeState3([{ q: 5, r: 5, ownerId: 3 }, { q: 6, r: 5, ownerId: 1 }]);
    applyCapture(s, 2, 4, 5);
    const hex = findHex(s, 4, 5)!;
    expect(hex.attackerId).toBe(2);
    expect(hex.attackInvestment).toBe(150);
  });
  it('нейтральный спорный гекс может защищать любой соседний игрок', () => {
    const s = makeState3([{ q: 4, r: 5, attackerId: 1, attackInvestment: 300 }, { q: 5, r: 5, ownerId: 3 }]);
    expect(validateDefend(s, 3, 4, 5, 100).ok).toBe(true);
    expect(validateDefend(s, 2, 4, 5, 100).ok).toBe(false);
  });
  it('атаковать можно гекс любого соперника', () => {
    const s = makeState3([{ q: 5, r: 5, ownerId: 3 }, { q: 6, r: 5, ownerId: 1 }, { q: 4, r: 5, ownerId: 2 }]);
    expect(validateAttack(s, 2, 5, 5, 150).ok).toBe(true);
  });
  it('свой гекс атаковать нельзя', () => {
    const s = makeState3([{ q: 5, r: 5, ownerId: 2 }]);
    expect(validateAttack(s, 2, 5, 5, 150).ok).toBe(false);
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

describe('тик битвы: перевес двигает захват', () => {
  it('оба пула тратятся по DRAIN_PER_TICK за тик', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 600, defenseInvestment: 300 }]);
    tickBattles(s);
    expect(findHex(s, 6, 5)!.attackInvestment).toBe(590);
    expect(findHex(s, 6, 5)!.defenseInvestment).toBe(290);
  });
  it('перевес атаки двигает прогресс в плюс', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 600, defenseInvestment: 300 }]);
    tickBattles(s);
    expect(findHex(s, 6, 5)!.battleProgress).toBe(1);
  });
  it('перевес обороны двигает прогресс в минус', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, defenderId: AI, attackerId: P, attackInvestment: 300, defenseInvestment: 600 }]);
    tickBattles(s);
    expect(findHex(s, 6, 5)!.battleProgress).toBe(-1);
  });
  it('равные пулы не двигают прогресс', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 500, defenseInvestment: 500 }]);
    tickBattles(s);
    expect(findHex(s, 6, 5)!.battleProgress).toBe(0);
  });
  it('смена лидера разворачивает прогресс', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 600, defenseInvestment: 300, battleProgress: 3 }]);
    tickBattles(s);
    expect(findHex(s, 6, 5)!.battleProgress).toBe(4);
    applyDefend(s, AI, 6, 5, 400);
    tickBattles(s);
    expect(findHex(s, 6, 5)!.battleProgress).toBe(3);
  });
  it('завершение: +5 тиков перевеса — атакующий захватывает, остаток возвращается', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 600, defenseInvestment: 300 }], [{ id: 1, points: 400 }, { id: 2, points: 700 }]);
    for (let i = 0; i < 5; i++) tickBattles(s);
    const hex = findHex(s, 6, 5)!;
    expect(hex.ownerId).toBe(P);
    expect(hex.attackerId).toBeNull();
    expect(hex.battleProgress).toBe(0);
    expect(s.players[0].points).toBe(950);
    expect(s.players[1].points).toBe(700);
  });
  it('завершение: −5 тиков перевеса — защитник отбивает, остаток возвращается', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, defenderId: AI, attackerId: P, attackInvestment: 300, defenseInvestment: 600 }], [{ id: 1, points: 700 }, { id: 2, points: 400 }]);
    for (let i = 0; i < 5; i++) tickBattles(s);
    const hex = findHex(s, 6, 5)!;
    expect(hex.ownerId).toBe(AI);
    expect(hex.attackerId).toBeNull();
    expect(s.players[1].points).toBe(950);
    expect(s.players[0].points).toBe(700);
  });
  it('нейтральный спорный гекс достаётся защитнику при его перевесе', () => {
    const s = makeState([{ q: 4, r: 5, attackerId: P, defenderId: AI, attackInvestment: 300, defenseInvestment: 600 }, { q: 5, r: 5, ownerId: AI }]);
    for (let i = 0; i < 5; i++) tickBattles(s);
    expect(findHex(s, 4, 5)!.ownerId).toBe(AI);
  });
  it('ничья: оба пула дошли до 0 — битва заканчивается без победителя', () => {
    const s = makeState([{ q: 6, r: 5, ownerId: AI, attackerId: P, attackInvestment: 100, defenseInvestment: 100 }]);
    const results: { q: number; r: number; winnerId: number | null }[] = [];
    for (let i = 0; i < 10; i++) results.push(...tickBattles(s));
    const hex = findHex(s, 6, 5)!;
    expect(hex.ownerId).toBe(AI);
    expect(hex.attackerId).toBeNull();
    expect(results).toEqual([{ q: 6, r: 5, winnerId: null }]);
  });
});

describe('экономика', () => {
  it('доход 2 очка за гекс с учётом лимита', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: P }, { q: 6, r: 5, ownerId: P }, { q: 4, r: 5, ownerId: P }]);
    applyIncome(s);
    expect(s.players[0].points).toBe(1006);
    const big = makeState();
    for (let i = 0; i < 40; i++) big.hexes[i].ownerId = P;
    big.players[0].points = 2970;
    applyIncome(big);
    expect(big.players[0].points).toBe(3000);
  });
  it('шахта даёт больше дохода', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: P }, { q: 6, r: 5, terrain: 'mine', ownerId: P }]);
    expect(playerIncome(s, P)).toBe(7);
    applyIncome(s);
    expect(s.players[0].points).toBe(1007);
  });
});

describe('столица', () => {
  it('первый захваченный гекс становится столицей', () => {
    const s = makeState([{ q: 5, r: 5 }]);
    applyCapture(s, P, 5, 5);
    expect(s.players[0].capital).toEqual({ q: 5, r: 5 });
  });
  it('второй захват не меняет столицу', () => {
    const s = makeState([{ q: 5, r: 5 }, { q: 6, r: 5 }]);
    applyCapture(s, P, 5, 5);
    applyCapture(s, P, 6, 5);
    expect(s.players[0].capital).toEqual({ q: 5, r: 5 });
  });
  it('первая клетка через бой становится столицей после победы', () => {
    const s = makeState(
      [{ q: 5, r: 5 }, { q: 6, r: 5, ownerId: AI }],
      [{ id: 1, points: 1000 }, { id: 2, points: 1000 }],
    );
    applyCapture(s, P, 5, 5); // бой у границы врага
    expect(s.players[0].capital).toBeUndefined();
    const hex = s.hexes.find((h) => h.q === 5 && h.r === 5)!;
    hex.attackInvestment = 300;
    hex.defenseInvestment = 0;
    hex.battleProgress = CAPTURE_TICKS - 1;
    tickBattles(s);
    expect(s.players[0].capital).toEqual({ q: 5, r: 5 });
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
  it('круглая карта: регион у края диска не роняет enclosure (регрессия)', () => {
    const hexes = generateMap('round').map((h) => ({
      q: h.q,
      r: h.r,
      terrain: h.terrain as Terrain,
      ownerId: null,
      attackerId: null,
      defenderId: null,
      attackInvestment: 0,
      defenseInvestment: 0,
      battleProgress: 0,
    }));
    const s: GameState = {
      players: [{ id: 1, points: 1000 }, { id: 2, points: 1000 }, { id: 3, points: 1000 }],
      hexes,
      columns: MAP_PRESETS.round.columns,
      rows: MAP_PRESETS.round.rows,
      winnerId: null,
    };
    const centerQ = (MAP_PRESETS.round.columns - 1) / 2;
    const centerR = (MAP_PRESETS.round.rows - 1) / 2;
    const edge = s.hexes.find((h) => h.q === 9 && h.r === 0)!;
    const distance = (Math.abs(9 - centerQ) + Math.abs(0 - centerR) + Math.abs(9 - centerQ + 0 - centerR)) / 2;
    expect(distance).toBe(9);
    edge.ownerId = 1;
    expect(() => applyEnclosure(s)).not.toThrow();
    expect(edge.ownerId).toBe(1);
  });
  it('длинная карта: соседство у правого края (q=23) видно (регрессия границ)', () => {
    const hexes: HexState[] = [];
    for (let r = 0; r < MAP_PRESETS.long.rows; r++) {
      for (let q = 0; q < MAP_PRESETS.long.columns; q++) {
        hexes.push({ q, r, terrain: 'grass', ownerId: null, attackerId: null, defenderId: null, attackInvestment: 0, defenseInvestment: 0, battleProgress: 0 });
      }
    }
    const s: GameState = {
      players: [{ id: 1, points: 1000 }, { id: 2, points: 1000 }],
      hexes,
      columns: MAP_PRESETS.long.columns,
      rows: MAP_PRESETS.long.rows,
      winnerId: null,
    };
    findHex(s, 22, 4)!.ownerId = P;
    findHex(s, 23, 4)!.ownerId = AI;
    expect(hasAdjacentOwner(s, 23, 4, P)).toBe(true);
    expect(hasAdjacentOwner(s, 22, 4, AI)).toBe(true);
    expect(hasAdjacentOwner(s, 23, 4, AI)).toBe(false);
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
  it('победа при 50%+1 гексов (97 из 192)', () => {
    const s = makeState();
    for (let i = 0; i < 96; i++) s.hexes[i].ownerId = P;
    computeWinner(s);
    expect(s.winnerId).toBeNull();
    s.hexes[96].ownerId = P;
    computeWinner(s);
    expect(s.winnerId).toBe(P);
  });
  it('победа для N игроков', () => {
    const s = makeState([], [{ id: 1, points: 1000 }, { id: 2, points: 1000 }, { id: 3, points: 1000 }]);
    const target = winHexCount(s.hexes.length);
    for (let i = 0; i < target; i++) s.hexes[i].ownerId = 1;
    computeWinner(s);
    expect(s.winnerId).toBe(1);
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
    expect(winHexCount(192)).toBe(97);
    expect(CAPTURE_TICKS).toBe(5);
    expect(DRAIN_PER_TICK).toBe(10);
  });
});

describe('отрезание территории', () => {
  it('захват шейки отрезает часть без столицы', () => {
    const s = makeState([
      { q: 2, r: 2, ownerId: P }, { q: 3, r: 2, ownerId: P }, { q: 4, r: 2, ownerId: P },
      { q: 5, r: 2, ownerId: P }, { q: 6, r: 2, ownerId: P }, { q: 7, r: 2, ownerId: P },
    ]);
    s.players[0].capital = { q: 2, r: 2 };
    s.hexes.find((h) => h.q === 4 && h.r === 2)!.ownerId = null; // шейку уже захватил враг
    const cut = applyCut(s, P);
    expect(cut.map((h) => `${h.q},${h.r}`).sort()).toEqual(['5,2', '6,2', '7,2'].sort());
    expect(s.hexes.find((h) => h.q === 5 && h.r === 2)!.ownerId).toBeNull();
    expect(s.hexes.find((h) => h.q === 2 && h.r === 2)!.ownerId).toBe(P);
    expect(s.hexes.find((h) => h.q === 3 && h.r === 2)!.ownerId).toBe(P);
  });
  it('связная территория не режется', () => {
    const s = makeState([{ q: 2, r: 2, ownerId: P }, { q: 3, r: 2, ownerId: P }]);
    s.players[0].capital = { q: 2, r: 2 };
    expect(applyCut(s, P)).toHaveLength(0);
  });
  it('выбывший игрок не режется', () => {
    const s = makeState([{ q: 2, r: 2, ownerId: P }, { q: 5, r: 5, ownerId: P }]);
    s.players[0].eliminated = true;
    expect(applyCut(s, P)).toHaveLength(0);
  });
  it('без столицы главный — первый компонент', () => {
    const s = makeState([{ q: 2, r: 2, ownerId: P }, { q: 5, r: 5, ownerId: P }]);
    const cut = applyCut(s, P);
    expect(cut.map((h) => `${h.q},${h.r}`)).toEqual(['5,5']);
  });
});

describe('выбытие', () => {
  it('потеря столицы = выбытие, территория нейтральна (90%)', () => {
    const s = makeState([{ q: 2, r: 2, ownerId: P }, { q: 3, r: 2, ownerId: P }]);
    s.players[0].capital = { q: 2, r: 2 };
    s.hexes.find((h) => h.q === 2 && h.r === 2)!.ownerId = AI; // столица уже захвачена
    const res = eliminateIfCapitalLost(s, P, () => 0.5);
    expect(res).not.toBeNull();
    expect(s.players[0].eliminated).toBe(true);
    expect(res!.capturerId).toBe(AI);
    expect(res!.neutralHexes.map((h) => `${h.q},${h.r}`)).toEqual(['3,2']);
    expect(res!.newAis).toHaveLength(0);
    expect(s.hexes.find((h) => h.q === 3 && h.r === 2)!.ownerId).toBeNull();
  });
  it('столица на месте — выбытия нет', () => {
    const s = makeState([{ q: 2, r: 2, ownerId: P }]);
    s.players[0].capital = { q: 2, r: 2 };
    expect(eliminateIfCapitalLost(s, P, () => 0.5)).toBeNull();
    expect(s.players[0].eliminated).toBeUndefined();
  });
  it('10% — территория делится на ИИ поровну, остаток нейтральный', () => {
    const hexes: Partial<HexState>[] = [];
    for (let i = 0; i < 22; i++) hexes.push({ q: i % 16, r: 5 + Math.floor(i / 16), ownerId: P });
    const s = makeState(hexes);
    s.players[0].capital = { q: 5, r: 5 };
    s.hexes.find((h) => h.q === 5 && h.r === 5)!.ownerId = AI; // столица захвачена, владений 21
    const res = eliminateIfCapitalLost(s, P, () => 0.05)!;
    expect(res.newAis).toHaveLength(2);
    expect(res.newAis[0].hexes).toHaveLength(10);
    expect(res.newAis[1].hexes).toHaveLength(10);
    expect(res.neutralHexes).toHaveLength(1);
    expect(res.newAis.map((a) => a.id)).toEqual([3, 4]);
    for (const ai of res.newAis) {
      for (const hex of ai.hexes) expect(hex.ownerId).toBe(ai.id);
    }
    expect(s.hexes.find((h) => h.q === 5 && h.r === 6)!.ownerId).toBeNull(); // остаток нейтральный
  });
  it('выбывший повторно не выбывает', () => {
    const s = makeState([]);
    s.players[0].eliminated = true;
    expect(eliminateIfCapitalLost(s, P, () => 0.5)).toBeNull();
  });
  it('выбывший игрок не может действовать', () => {
    const s1 = makeState([{ q: 5, r: 5, ownerId: P }, { q: 7, r: 5 }]);
    s1.players[0].eliminated = true;
    expect(validateCapture(s1, P, 7, 5).ok).toBe(false);
    const s2 = makeState([{ q: 5, r: 5, ownerId: P }, { q: 6, r: 5, attackerId: AI }]);
    s2.players[0].eliminated = true;
    expect(validateDefend(s2, P, 6, 5, 150).ok).toBe(false);
    const s3 = makeState([{ q: 5, r: 5, ownerId: P }, { q: 6, r: 5, ownerId: AI }]);
    s3.players[0].eliminated = true;
    expect(validateAttack(s3, P, 6, 5, 150).ok).toBe(false);
  });
  it('последний оставшийся — победитель', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: P }], [{ id: 1, points: 100 }, { id: 2, points: 100 }]);
    s.players[0].capital = { q: 5, r: 5 };
    s.players[1].eliminated = true;
    computeWinner(s);
    expect(s.winnerId).toBe(P);
  });
  it('битва за столицу: результат содержит loserId', () => {
    const s = makeState(
      [{ q: 5, r: 5, ownerId: P }, { q: 6, r: 5, ownerId: AI }],
      [{ id: 1, points: 1000 }, { id: 2, points: 1000 }],
    );
    s.players[0].capital = { q: 5, r: 5 };
    const hex = s.hexes.find((h) => h.q === 5 && h.r === 5)!;
    hex.attackerId = AI;
    hex.defenderId = P;
    hex.attackInvestment = 500;
    hex.defenseInvestment = 0;
    hex.battleProgress = CAPTURE_TICKS - 1;
    const results = tickBattles(s);
    expect(results).toHaveLength(1);
    expect(results[0].winnerId).toBe(AI);
    expect(results[0].loserId).toBe(P);
  });
  it('все выбыли в один тик: победитель — последний владелец клеток', () => {
    const s = makeState([{ q: 5, r: 5, ownerId: AI }], [{ id: 1, points: 100 }, { id: 2, points: 100 }]);
    s.players[0].capital = { q: 6, r: 5 };
    s.players[1].capital = { q: 5, r: 5 };
    s.players[0].eliminated = true;
    s.players[1].eliminated = true;
    computeWinner(s);
    expect(s.winnerId).toBe(AI);
  });
  it('выбытие отменяет незавершённые битвы выбывшего', () => {
    const s = makeState([
      { q: 2, r: 2, ownerId: P, attackerId: P, attackInvestment: 200 },
      { q: 5, r: 5, ownerId: P },
    ]);
    s.players[0].capital = { q: 5, r: 5 };
    s.hexes.find((h) => h.q === 5 && h.r === 5)!.ownerId = AI; // столица захвачена
    eliminateIfCapitalLost(s, P, () => 0.5);
    const battle = s.hexes.find((h) => h.q === 2 && h.r === 2)!;
    expect(battle.attackerId).toBeNull();
    expect(battle.attackInvestment).toBe(0);
  });
});
