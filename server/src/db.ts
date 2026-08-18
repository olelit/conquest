import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { Column, DataSource, Entity, PrimaryColumn, PrimaryGeneratedColumn, Repository } from 'typeorm';
import { config } from './config.js';
import { hashPassword } from './password.js';

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

@Entity('game_dumps')
export class GameDumpEntity {
  @PrimaryGeneratedColumn({ name: 'id', type: 'int' })
  id!: number;

  @Column({ name: 'room_id', type: 'int' })
  roomId!: number;

  @Column({ name: 'room_name', type: 'text' })
  roomName!: string;

  @Column({ name: 'map_type', type: 'text' })
  mapType!: string;

  @Column({ name: 'note', type: 'text', nullable: true })
  note!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'state', type: 'jsonb' })
  state!: unknown;
}

@Entity('admin_credentials')
export class AdminCredentialsEntity {
  @PrimaryColumn({ name: 'id', type: 'int' })
  id!: number;

  @Column({ name: 'username', type: 'text' })
  username!: string;

  @Column({ name: 'password_hash', type: 'text' })
  passwordHash!: string;

  @Column({ name: 'session_secret', type: 'text' })
  sessionSecret!: string;
}

export class AdminCredentialsRepository {
  constructor(private readonly dataSource: DataSource) {}

  private repo(): Repository<AdminCredentialsEntity> {
    return this.dataSource.getRepository(AdminCredentialsEntity);
  }

  async get(): Promise<AdminCredentialsEntity | null> {
    return this.repo().findOneBy({ id: 1 });
  }

  async ensureSeeded(username: string, password: string): Promise<void> {
    const existing = await this.repo().findOneBy({ id: 1 });
    if (existing) return;
    await this.repo().save({
      id: 1,
      username,
      passwordHash: await hashPassword(password),
      sessionSecret: randomBytes(32).toString('base64url'),
    });
  }

  async updateCredentials(username: string, passwordHash: string): Promise<void> {
    await this.repo().update(
      { id: 1 },
      { username, passwordHash, sessionSecret: randomBytes(32).toString('base64url') },
    );
  }
}

export class DumpsRepository {
  constructor(private readonly dataSource: DataSource) {}

  private repo(): Repository<GameDumpEntity> {
    return this.dataSource.getRepository(GameDumpEntity);
  }

  async save(dump: { roomId: number; roomName: string; mapType: string; note: string | null; state: unknown }): Promise<number> {
    const entity = await this.repo().save({
      roomId: dump.roomId,
      roomName: dump.roomName,
      mapType: dump.mapType,
      note: dump.note ?? null,
      state: dump.state,
    });
    return entity.id;
  }

  async list(): Promise<{ id: number; roomId: number; roomName: string; mapType: string; note: string | null; createdAt: Date }[]> {
    return this.repo().find({
      order: { id: 'DESC' },
      select: ['id', 'roomId', 'roomName', 'mapType', 'note', 'createdAt'],
    });
  }

  async findById(id: number): Promise<GameDumpEntity | null> {
    return this.repo().findOneBy({ id });
  }
}

export const dataSource = new DataSource({
  type: 'postgres',
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5432),
  username: process.env.PGUSER ?? 'conquest',
  password: process.env.PGPASSWORD ?? 'conquest',
  database: process.env.PGDATABASE ?? 'conquest_db',
  entities: [PlayerEntity, GameDumpEntity, AdminCredentialsEntity],
  synchronize: true,
});

export const playersRepository = new PlayersRepository(dataSource);
export const dumpsRepository = new DumpsRepository(dataSource);
export const adminCredentialsRepository = new AdminCredentialsRepository(dataSource);

export async function initDb(): Promise<void> {
  await dataSource.initialize();
  await playersRepository.migrate();
  await adminCredentialsRepository.ensureSeeded(config.adminUser, config.adminPassword);
}

export async function closeDb(): Promise<void> {
  if (dataSource.isInitialized) {
    await dataSource.destroy();
  }
}
