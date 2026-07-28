import { ServiceUnavailableException } from '@nestjs/common';
import { AppService } from './app.service';

describe('AppService health contracts', () => {
  const databaseService = {
    health: jest.fn(),
  };
  const aiProxyService = {
    health: jest.fn(),
  };

  let service: AppService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AppService(databaseService as never, aiProxyService as never);
  });

  it('reports liveness without probing downstream dependencies', () => {
    expect(service.getLiveness()).toMatchObject({
      service: 'api',
      status: 'ok',
      live: true,
    });
    expect(databaseService.health).not.toHaveBeenCalled();
    expect(aiProxyService.health).not.toHaveBeenCalled();
  });

  it('reports readiness when the required database dependency is healthy', async () => {
    const database = {
      service: 'api',
      status: 'ok',
      ready: true,
      database: 'postgresql + pgvector',
    };
    databaseService.health.mockResolvedValue(database);

    await expect(service.getReadiness()).resolves.toMatchObject({
      service: 'api',
      status: 'ok',
      ready: true,
      dependencies: { database },
    });
  });

  it('returns a 503 contract when the required database is unavailable', async () => {
    expect.assertions(2);
    const database = {
      service: 'api',
      status: 'unavailable',
      ready: false,
      database: 'postgresql + pgvector',
      error: 'database_unavailable',
    };
    databaseService.health.mockResolvedValue(database);

    try {
      await service.getReadiness();
      throw new Error('Expected readiness to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(
        (error as ServiceUnavailableException).getResponse(),
      ).toMatchObject({
        service: 'api',
        status: 'unavailable',
        ready: false,
        dependencies: { database },
      });
    }
  });
});
