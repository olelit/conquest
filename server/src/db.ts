import 'reflect-metadata';
import { Column, DataSource, Entity, PrimaryColumn, Repository } from 'typeorm';

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

export class PlayersRepository {
  constructor(private readonly dataSource: DataSource) {}

  private repo(): Repository<PlayerEntity> {
    return this.dataSource.getRepository(PlayerEntity);
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

  async migrate(): Promise<void> {
    if ((await this.count()) === 0) {
      await this.insertDefaults();
    }
  }
}

export const dataSource = new DataSource({
  type: 'postgres',
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5432),
  username: process.env.PGUSER ?? 'conquest',
  password: process.env.PGPASSWORD ?? 'conquest',
  database: process.env.PGDATABASE ?? 'conquest_db',
  entities: [PlayerEntity],
  synchronize: true,
});

export const playersRepository = new PlayersRepository(dataSource);

export async function initDb(): Promise<void> {
  await dataSource.initialize();
  await playersRepository.migrate();
}

export async function closeDb(): Promise<void> {
  if (dataSource.isInitialized) {
    await dataSource.destroy();
  }
}
