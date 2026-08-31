import type { Response } from 'express';
import type { AuthCookiePolicy } from '../auth/auth-cookie';
import { AccountDeletionController } from './account-deletion.controller';
import type { AccountErasureService } from './account-erasure.service';

const request = {
  principal: {
    userId: 71,
    sessionId: '33333333-3333-4333-8333-333333333333',
  },
} as never;

describe('AccountDeletionController', () => {
  it('deletes the current account and clears its session cookie', async () => {
    const fixture = createFixture();
    fixture.eraseAccount.mockResolvedValueOnce({ status: 'deleted' });

    await expect(
      fixture.controller.deleteAccount(request, fixture.response),
    ).resolves.toBeUndefined();

    expect(fixture.eraseAccount).toHaveBeenCalledWith({
      userId: 71,
      sessionId: '33333333-3333-4333-8333-333333333333',
    });
    expect(fixture.clearSessionCookie).toHaveBeenCalledWith(fixture.response);
  });

  it('requires a recent Google reauthentication without clearing the session', async () => {
    const fixture = createFixture();
    fixture.eraseAccount.mockResolvedValueOnce({ status: 'reauth_required' });

    await expect(
      fixture.controller.deleteAccount(request, fixture.response),
    ).rejects.toMatchObject({
      code: 'ACCOUNT_REAUTH_REQUIRED',
      status: 401,
    });
    expect(fixture.clearSessionCookie).not.toHaveBeenCalled();
  });

  it('does not claim success for an already missing account', async () => {
    const fixture = createFixture();
    fixture.eraseAccount.mockResolvedValueOnce({ status: 'not_found' });

    await expect(
      fixture.controller.deleteAccount(request, fixture.response),
    ).rejects.toMatchObject({
      code: 'ACCOUNT_NOT_FOUND',
      status: 404,
    });
  });
});

function createFixture() {
  const eraseAccount = jest.fn();
  const erasure = {
    eraseAccount,
  } as unknown as jest.Mocked<AccountErasureService>;
  const clearSessionCookie = jest.fn();
  const cookies = {
    clearSessionCookie,
  } as unknown as jest.Mocked<AuthCookiePolicy>;
  const response = {} as Response;
  return {
    controller: new AccountDeletionController(erasure, cookies),
    eraseAccount,
    clearSessionCookie,
    response,
  };
}
