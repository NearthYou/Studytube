import { hashPassword, verifyPassword } from './password';

describe('password utilities', () => {
  it('hashes and verifies passwords using the shared smoke/auth policy', async () => {
    const passwordHash = await hashPassword('Password1!');

    expect(passwordHash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    await expect(verifyPassword('Password1!', passwordHash)).resolves.toBe(
      true,
    );
    await expect(verifyPassword('Password2!', passwordHash)).resolves.toBe(
      false,
    );
  });

  it('rejects malformed password hashes', async () => {
    await expect(verifyPassword('Password1!', 'not-a-hash')).resolves.toBe(
      false,
    );
  });
});
