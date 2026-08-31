import { AccountErasureService } from './account-erasure.service';
import type {
  AccountErasureCommand,
  AccountErasureRepository,
  AccountErasureResult,
} from './account-erasure.repository';

const NOW = new Date('2026-08-31T12:00:00.000Z');

describe('AccountErasureService', () => {
  it('requires Google reauthentication within the preceding five minutes', async () => {
    const repository = new RecordingAccountErasureRepository({
      status: 'deleted',
    });
    const service = new AccountErasureService(repository, () => NOW);

    await expect(
      service.eraseAccount({
        userId: 71,
        sessionId: '33333333-3333-4333-8333-333333333333',
      }),
    ).resolves.toEqual({ status: 'deleted' });
    expect(repository.commands).toEqual([
      {
        userId: 71,
        sessionId: '33333333-3333-4333-8333-333333333333',
        reauthCutoff: new Date('2026-08-31T11:55:00.000Z'),
        erasedAt: NOW,
      },
    ]);
  });

  it.each(['reauth_required', 'not_found'] as const)(
    'preserves the repository result %s without inventing success',
    async (status) => {
      const service = new AccountErasureService(
        new RecordingAccountErasureRepository({ status }),
        () => NOW,
      );

      await expect(
        service.eraseAccount({
          userId: 71,
          sessionId: '33333333-3333-4333-8333-333333333333',
        }),
      ).resolves.toEqual({ status });
    },
  );
});

class RecordingAccountErasureRepository implements AccountErasureRepository {
  readonly commands: AccountErasureCommand[] = [];

  constructor(private readonly result: AccountErasureResult) {}

  erase(command: AccountErasureCommand) {
    this.commands.push(command);
    return Promise.resolve(this.result);
  }
}
