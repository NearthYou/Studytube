import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseService } from './database.service';

class TestDatabaseService extends DatabaseService {
  restoreFallbackForTest() {
    return this.loadFallbackState();
  }
}

function configServiceForFallbackPath(fallbackPath: string) {
  return {
    get: jest.fn((key: string) =>
      key === 'BOARD_FALLBACK_DATA_PATH' ? fallbackPath : undefined,
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
});
