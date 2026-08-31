import type {
  AccountErasureRepository,
  AccountErasureResult,
} from './account-erasure.repository';

const GOOGLE_REAUTH_TTL_MS = 5 * 60 * 1000;

export class AccountErasureService {
  constructor(
    private readonly repository: AccountErasureRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  eraseAccount(input: {
    userId: number;
    sessionId: string;
  }): Promise<AccountErasureResult> {
    const erasedAt = this.clock();
    return this.repository.erase({
      userId: input.userId,
      sessionId: input.sessionId,
      reauthCutoff: new Date(erasedAt.getTime() - GOOGLE_REAUTH_TTL_MS),
      erasedAt,
    });
  }
}
