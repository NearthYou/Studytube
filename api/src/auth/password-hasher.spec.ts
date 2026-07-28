import { argon2, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import {
  ARGON2_MEMORY_KIB,
  ARGON2_PARALLELISM,
  ARGON2_SALT_BYTES,
  ARGON2_TAG_BYTES,
  ARGON2_TIME_COST,
} from './auth.constants';
import { Argon2WorkLimiter } from './argon2-work-limiter';
import {
  PasswordHasher,
  PasswordValidationError,
  type Argon2Function,
} from './password-hasher';

const argon2Async = promisify(argon2);

describe('PasswordHasher', () => {
  const password = 'correct horse battery staple';

  it('hashes and verifies with the configured Argon2id PHC parameters', async () => {
    const hasher = new PasswordHasher();

    const encoded = await hasher.hash(password);

    expect(encoded).toMatch(
      /^\$argon2id\$v=19\$m=65536,t=3,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/,
    );
    await expect(hasher.verify(encoded, password)).resolves.toEqual({
      valid: true,
      needsRehash: false,
      algorithm: 'argon2id',
    });
  });

  it('uses a different 16-byte salt for the same password', async () => {
    const hasher = new PasswordHasher();

    const first = await hasher.hash(password);
    const second = await hasher.hash(password);
    const firstSalt = first.split('$')[4];
    const secondSalt = second.split('$')[4];

    expect(firstSalt).not.toBe(secondSalt);
    expect(Buffer.from(firstSalt, 'base64')).toHaveLength(ARGON2_SALT_BYTES);
    expect(Buffer.from(secondSalt, 'base64')).toHaveLength(ARGON2_SALT_BYTES);
  });

  it('rejects a wrong password with a timing-safe digest comparison', async () => {
    const hasher = new PasswordHasher();
    const encoded = await hasher.hash(password);

    await expect(hasher.verify(encoded, 'incorrect password')).resolves.toEqual(
      {
        valid: false,
        needsRehash: false,
        algorithm: 'argon2id',
      },
    );
  });

  it('recognizes and verifies a lowercase legacy SHA-256 hash', async () => {
    const hasher = new PasswordHasher();
    const legacy = createHash('sha256').update(password).digest('hex');

    await expect(hasher.verify(legacy, password)).resolves.toEqual({
      valid: true,
      needsRehash: true,
      algorithm: 'legacy_sha256',
    });
    await expect(hasher.verify(legacy, 'incorrect password')).resolves.toEqual({
      valid: false,
      needsRehash: true,
      algorithm: 'legacy_sha256',
    });
    await expect(
      hasher.verify(legacy.toUpperCase(), password),
    ).resolves.toEqual({
      valid: false,
      needsRehash: false,
      algorithm: 'unknown',
    });
  });

  it('marks legacy and weaker PHC parameters for rehash', async () => {
    const hasher = new PasswordHasher();
    const salt = Buffer.alloc(ARGON2_SALT_BYTES, 7);
    const tag = await argon2Async('argon2id', {
      message: Buffer.from(password),
      nonce: salt,
      parallelism: ARGON2_PARALLELISM,
      tagLength: ARGON2_TAG_BYTES,
      memory: ARGON2_MEMORY_KIB / 2,
      passes: ARGON2_TIME_COST - 1,
    });
    const weaker = `$argon2id$v=19$m=${ARGON2_MEMORY_KIB / 2},t=${
      ARGON2_TIME_COST - 1
    },p=${ARGON2_PARALLELISM}$${salt.toString('base64').replace(/=+$/, '')}$${Buffer.from(tag).toString('base64').replace(/=+$/, '')}`;

    await expect(hasher.verify(weaker, password)).resolves.toEqual({
      valid: true,
      needsRehash: true,
      algorithm: 'argon2id',
    });
  });

  it('keeps whitespace significant and rejects control characters', async () => {
    const hasher = new PasswordHasher();
    const spaced = '  password  ';
    const encoded = await hasher.hash(spaced);

    await expect(hasher.verify(encoded, spaced)).resolves.toMatchObject({
      valid: true,
    });
    await expect(hasher.verify(encoded, spaced.trim())).resolves.toMatchObject({
      valid: false,
    });
    expect(() => hasher.validate('password\n')).toThrow(
      PasswordValidationError,
    );
    expect(() => hasher.validate('password\u0000')).toThrow(
      PasswordValidationError,
    );
  });

  it('accepts 8 bytes and rejects values outside 8 to 128 UTF-8 bytes', () => {
    const hasher = new PasswordHasher();

    expect(() => hasher.validate('12345678')).not.toThrow();
    expect(() => hasher.validate('a'.repeat(128))).not.toThrow();
    expect(() => hasher.validate('😀😀')).not.toThrow();
    expect(() => hasher.validate('1234567')).toThrow(PasswordValidationError);
    expect(() => hasher.validate('a'.repeat(129))).toThrow(
      PasswordValidationError,
    );
    expect(() => hasher.validate('😀')).toThrow(PasswordValidationError);
  });

  it('rejects malformed or oversized PHC strings without invoking Argon2', async () => {
    const argon2Function = jest.fn<
      ReturnType<Argon2Function>,
      Parameters<Argon2Function>
    >();
    const hasher = new PasswordHasher({ argon2: argon2Function });
    const malformed = [
      '$argon2id$v=19$m=65536,t=3,p=1,extra=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      '$argon2id$v=19$m=999999999,t=3,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      '$argon2id$v=19$m=65536,t=3,p=1$not_base64!$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      `$argon2id$v=19$m=65536,t=3,p=1$${'A'.repeat(300)}`,
    ];

    for (const storedHash of malformed) {
      await expect(hasher.verify(storedHash, password)).resolves.toEqual({
        valid: false,
        needsRehash: false,
        algorithm: 'unknown',
      });
    }
    expect(argon2Function).not.toHaveBeenCalled();
  });

  it('routes real hashes and verifications through the work limiter', async () => {
    const limiter = new Argon2WorkLimiter({
      concurrency: 1,
      maxQueueSize: 0,
      memoryBudgetMiB: 64,
    });
    const hasher = new PasswordHasher({ limiter });
    let release: (() => void) | undefined;
    const blocker = limiter.run(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    await expect(hasher.hash(password)).rejects.toMatchObject({
      code: 'AUTH_ARGON2_QUEUE_FULL',
      retryAfterSeconds: 1,
    });
    release?.();
    await blocker;
  });
});
