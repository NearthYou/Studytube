import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_LEARNING_PREFERENCES } from './database-board.mapper';
import { DatabaseService } from './database.service';

class TestDatabaseService extends DatabaseService {
  fallbackLoaded = false;

  databaseAvailableForTest() {
    return (this as unknown as { databaseAvailable: boolean })
      .databaseAvailable;
  }

  restoreFallbackForTest() {
    return this.loadFallbackState();
  }

  protected override async loadFallbackState() {
    this.fallbackLoaded = true;
    return super.loadFallbackState();
  }
}

function configServiceForFallbackPath(
  fallbackPath: string,
  overrides: Record<string, string> = {},
) {
  return {
    get: jest.fn((key: string) =>
      key === 'BOARD_FALLBACK_DATA_PATH' ? fallbackPath : overrides[key],
    ),
  } as never;
}

describe('DatabaseService fallback persistence', () => {
  it('restores users and sessions from the file-backed fallback store', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agentic-board-fallback-'));
    const fallbackPath = join(directory, 'board.json');
    const firstService = new TestDatabaseService(
      configServiceForFallbackPath(fallbackPath),
    );
    const secondService = new TestDatabaseService(
      configServiceForFallbackPath(fallbackPath),
    );

    try {
      const user = await firstService.createUser({
        name: 'Ada',
        email: 'ada@example.com',
        passwordHash: 'hashed-password',
      });
      await firstService.createSession(user.id, 'token-1');

      await secondService.restoreFallbackForTest();

      await expect(
        secondService.findUserByEmail('ada@example.com'),
      ).resolves.toMatchObject({
        id: user.id,
        email: 'ada@example.com',
        passwordHash: 'hashed-password',
      });
      await expect(secondService.findSession('token-1')).resolves.toMatchObject(
        {
          token: 'token-1',
          user: {
            id: user.id,
            email: 'ada@example.com',
          },
        },
      );
    } finally {
      await firstService.onModuleDestroy();
      await secondService.onModuleDestroy();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('retries database initialization before switching to fallback data', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agentic-board-fallback-'));
    const fallbackPath = join(directory, 'board.json');
    const service = new TestDatabaseService(
      configServiceForFallbackPath(fallbackPath, {
        DB_INIT_ATTEMPTS: '3',
        DB_INIT_RETRY_DELAY_MS: '0',
      }),
    );
    let attempts = 0;

    (service as unknown as { ensureSchema: () => Promise<void> }).ensureSchema =
      jest.fn(async () => {
        attempts += 1;

        if (attempts < 3) {
          throw new Error('database is still starting');
        }
      });
    (service as unknown as { seedDatabase: () => Promise<void> }).seedDatabase =
      jest.fn(async () => undefined);

    try {
      await service.onModuleInit();

      expect(attempts).toBe(3);
      expect(service.fallbackLoaded).toBe(false);
      expect(service.databaseAvailableForTest()).toBe(true);
    } finally {
      await service.onModuleDestroy();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('uses valid default learning preferences JSON in the users schema', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agentic-board-fallback-'));
    const fallbackPath = join(directory, 'board.json');
    const service = new TestDatabaseService(
      configServiceForFallbackPath(fallbackPath),
    );
    const queries: string[] = [];

    (
      service as unknown as {
        pool: { query: (sql: string) => Promise<void>; end: () => Promise<void> };
      }
    ).pool = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
      }),
      end: jest.fn(async () => undefined),
    };

    try {
      await (
        service as unknown as { ensureSchema: () => Promise<void> }
      ).ensureSchema();

      const usersSchema = queries.find((query) =>
        query.includes('CREATE TABLE IF NOT EXISTS users'),
      );
      const expectedDefault = JSON.stringify(
        DEFAULT_LEARNING_PREFERENCES,
      ).replace(/'/g, "''");

      expect(usersSchema).toContain(`DEFAULT '${expectedDefault}'::jsonb`);
      expect(JSON.parse(expectedDefault)).toEqual(
        DEFAULT_LEARNING_PREFERENCES,
      );
    } finally {
      await service.onModuleDestroy();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
