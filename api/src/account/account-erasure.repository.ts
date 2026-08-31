export type AccountErasureCommand = {
  userId: number;
  sessionId: string;
  reauthCutoff: Date;
  erasedAt: Date;
};

export type AccountErasureResult =
  | { status: 'deleted' }
  | { status: 'reauth_required' }
  | { status: 'not_found' };

export interface AccountErasureRepository {
  erase(command: AccountErasureCommand): Promise<AccountErasureResult>;
}

export class AccountErasureUnavailableError extends Error {
  readonly code = 'ACCOUNT_ERASURE_UNAVAILABLE';

  constructor() {
    super('Account erasure persistence failed');
    this.name = 'AccountErasureUnavailableError';
  }
}
