import 'reflect-metadata';
import { Column, DataSource, Entity, PrimaryColumn, Repository } from 'typeorm';
import type { GameState } from './rules.js';
import type { Terrain } from './map.js';
import { config } from './config.js';
import { generateMap, MAP_COLUMNS, MAP_ROWS } from './map.js';

@Entity('players')
export class PlayerEntity {
  @PrimaryColumn({ name: 'id', type: 'int' })
  id!: number;

  @Column({ name: 'name', type: 'text' })
  name!: string;

  @Column({ name: 'points', type: 'int', default: 1000 })
  points!: number;

  @Column({ name: 'is_ai', type: 'boolean', default: false })
  isAi!: boolean;
}

@Entity('hexes')
export class HexEntity {
  @PrimaryColumn({ name: 'q', type: 'int' })
  q!: number;

  @PrimaryColumn({ name: 'r', type: 'int' })
  r!: number;

  @Column({ name: 'terrain', type: 'text' })
  terrain!: Terrain;

  @Column({ name: 'owner_id', type: 'int', nullable: true })
  ownerId!: number | null;

  @Column({ name: 'attacker_id', type: 'int', nullable: true })
  attackerId!: number | null;

  @Column({ name: 'defender_id', type: 'int', nullable: true })
  defenderId!: number | null;

  @Column({ name: 'attack_investment', type: 'int', default: 0 })
  attackInvestment!: number;

  @Column({ name: 'defense_investment', type: 'int', default: 0 })
  defenseInvestment!: number;

  @Column({ name: 'battle_progress', type: 'float', default: 0 })
  battleProgress!: number;
}

export interface PlayerRow {
  id: number;
  name: string;
  points: number;
  isAi: boolean;
}

export class PlayersRepository {
  constructor(private readonly dataSource: DataSource) {}

  private repo(): Repository<PlayerEntity> {
    return this.dataSource.getRepository(PlayerEntity);
  }

  async findAll(): Promise<PlayerEntity[]> {
    return this.repo().find({ order: { id: 'ASC' } });
  }

  async count(): Promise<number> {
    return this.repo().count();
  }

  async insertDefaults(): Promise<void> {
    await this.repo().save([
      { id: 1, name: 'player', points: 1000, isAi: false },
      { id: 2, name: 'ai', points: 1000, isAi: true },
    ]);
  }

  async saveMany(players: PlayerRow[]): Promise<void> {
    await this.repo().save(players);
  }

  async updateName(id: number, name: string): Promise<void> {
    await this.repo().update({ id }, { name });
  }

  async updateAiFlags(id1: number, isAi1: boolean, id2: number, isAi2: boolean): Promise<void> {
    await this.repo().update({ id: id1 }, { isAi: isAi1 });
    await this.repo().update({ id: id2 }, { isAi: isAi2 });
  }
}

export class HexesRepository {
  constructor(private readonly dataSource: DataSource) {}

  private repo(): Repository<HexEntity> {
    return this.dataSource.getRepository(HexEntity);
  }

  async count(): Promise<number> {
    return this.repo().count();
  }

  async findAll(): Promise<HexEntity[]> {
    return this.repo().find({ order: { r: 'ASC', q: 'ASC' } });
  }

  async insertMany(hexes: HexEntity[]): Promise<void> {
    if (hexes.length === 0) return;
    await this.repo().save(hexes);
  }

  async seedIfEmpty(): Promise<void> {
    if ((await this.count()) > 0) return;
    const generated = generateMap('normal');
    await this.insertMany(generated as HexEntity[]);
  }

  async ensureMines(): Promise<void> {
    const count = await this.repo().countBy({ terrain: 'mine' });
    if (count > 0) return;
    await this.dataSource.query(
      `UPDATE hexes SET terrain = 'mine' WHERE terrain = 'mountain' AND random() < $1`,
      [config.mineChance],
    );
  }
}

export class GameRepository {
  constructor(
    private readonly dataSource: DataSource,
    private readonly players: PlayersRepository,
    private readonly hexes: HexesRepository,
  ) {}

  async migrate(): Promise<void> {
    if ((await this.players.count()) === 0) {
      await this.players.insertDefaults();
    }
    await this.hexes.seedIfEmpty();
  }

  async load(): Promise<GameState> {
    const players = await this.players.findAll();
    const hexes = await this.hexes.findAll();
    return {
      players: players.map((p) => ({ id: p.id, name: p.name, points: p.points, isAi: p.isAi })),
      hexes: hexes.map((h) => ({
        q: h.q,
        r: h.r,
        terrain: h.terrain,
        ownerId: h.ownerId,
        attackerId: h.attackerId,
        defenderId: h.defenderId,
        attackInvestment: h.attackInvestment,
        defenseInvestment: h.defenseInvestment,
        battleProgress: h.battleProgress,
      })),
      winnerId: null,
    };
  }

  async persist(state: GameState): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.save(
        PlayerEntity,
        state.players.map((p) => ({
          id: p.id,
          name: p.name ?? 'Игрок',
          points: p.points,
          isAi: p.isAi ?? false,
        })),
      );
      await manager.save(HexEntity, state.hexes as HexEntity[]);
    });
  }
}

export const dataSource = new DataSource({
  type: 'postgres',
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5432),
  username: process.env.PGUSER ?? 'conquest',
  password: process.env.PGPASSWORD ?? 'conquest',
  database: process.env.PGDATABASE ?? 'conquest_db',
  entities: [PlayerEntity, HexEntity],
  synchronize: true,
});

export const playersRepository = new PlayersRepository(dataSource);
export const hexesRepository = new HexesRepository(dataSource);
export const gameRepository = new GameRepository(dataSource, playersRepository, hexesRepository);

export async function initDb(): Promise<void> {
  await dataSource.initialize();
}

export async function closeDb(): Promise<void> {
  if (dataSource.isInitialized) {
    await dataSource.destroy();
  }
}
