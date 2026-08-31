import { GoogleAttemptCrypto } from './google-attempt.crypto';

describe('GoogleAttemptCrypto', () => {
  const key = Buffer.from(
    '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
    'hex',
  );

  it('encrypts a verifier with authenticated versioned storage', () => {
    const crypto = new GoogleAttemptCrypto(key, () => Buffer.alloc(12, 9));

    const encrypted = crypto.encryptVerifier(
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~',
    );

    expect(encrypted[0]).toBe(1);
    expect(encrypted.subarray(1, 13)).toEqual(Buffer.alloc(12, 9));
    expect(crypto.decryptVerifier(encrypted)).toBe(
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~',
    );
    expect(encrypted.toString('utf8')).not.toContain(
      'abcdefghijklmnopqrstuvwxyz',
    );
  });

  it('rejects a tampered verifier without exposing ciphertext details', () => {
    const crypto = new GoogleAttemptCrypto(key, () => Buffer.alloc(12, 4));
    const encrypted = crypto.encryptVerifier('valid-pkce-verifier-value');
    encrypted[encrypted.length - 1] ^= 1;

    expect(() => crypto.decryptVerifier(encrypted)).toThrow(
      'Invalid Google authentication attempt',
    );
  });

  it('creates a stable SHA-256 digest without retaining the source value', () => {
    const crypto = new GoogleAttemptCrypto(key);

    expect(crypto.digest('abc').toString('hex')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
