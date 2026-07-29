import {
  argon2,
  createHash,
  randomBytes,
  timingSafeEqual,
  type Argon2Parameters,
} from 'node:crypto';
import {
  ARGON2_ALGORITHM,
  ARGON2_MEMORY_KIB,
  ARGON2_PARALLELISM,
  ARGON2_SALT_BYTES,
  ARGON2_TAG_BYTES,
  ARGON2_TIME_COST,
  ARGON2_VERSION,
  PASSWORD_HASH_MAX_CHARACTERS,
  PASSWORD_MAX_UTF8_BYTES,
  PASSWORD_MIN_UTF8_BYTES,
} from './auth.constants';
import { Argon2WorkLimiter } from './argon2-work-limiter';

export type PasswordVerification = {
  valid: boolean;
  needsRehash: boolean;
  algorithm: 'argon2id' | 'legacy_sha256' | 'unknown';
};

export type Argon2Function = (parameters: Argon2Parameters) => Promise<Buffer>;

export type PasswordHasherOptions = {
  limiter?: Argon2WorkLimiter;
  argon2?: Argon2Function;
};

export class PasswordValidationError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = 'PasswordValidationError';
  }
}

type ParsedPhc = {
  memory: number;
  passes: number;
  parallelism: number;
  salt: Buffer;
  tag: Buffer;
};

const LEGACY_SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ARGON2ID_PHC_PATTERN =
  /^\$argon2id\$v=19\$m=([1-9]\d{0,5}),t=([1-9]\d?),p=([1-9]\d?)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;
const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u;
const LONE_SURROGATE_PATTERN = /[\uD800-\uDFFF]/u;
const defaultLimiter = new Argon2WorkLimiter();

export class PasswordHasher {
  private readonly limiter: Argon2WorkLimiter;
  private readonly deriveArgon2: Argon2Function;

  constructor(options: PasswordHasherOptions = {}) {
    this.limiter = options.limiter ?? defaultLimiter;
    this.deriveArgon2 = options.argon2 ?? runNodeArgon2;
  }

  validate(password: string): void {
    const byteLength = Buffer.byteLength(password, 'utf8');
    if (
      byteLength < PASSWORD_MIN_UTF8_BYTES ||
      byteLength > PASSWORD_MAX_UTF8_BYTES
    ) {
      throw new PasswordValidationError(
        `Password must be ${PASSWORD_MIN_UTF8_BYTES} to ${PASSWORD_MAX_UTF8_BYTES} UTF-8 bytes`,
      );
    }
    if (CONTROL_CHARACTER_PATTERN.test(password)) {
      throw new PasswordValidationError(
        'Password must not contain control characters',
      );
    }
    if (LONE_SURROGATE_PATTERN.test(password)) {
      throw new PasswordValidationError('Password must be well-formed UTF-16');
    }
  }

  async hash(password: string): Promise<string> {
    this.validate(password);
    const salt = randomBytes(ARGON2_SALT_BYTES);
    const tag = await this.limiter.run(() =>
      this.deriveArgon2({
        message: Buffer.from(password, 'utf8'),
        nonce: salt,
        parallelism: ARGON2_PARALLELISM,
        tagLength: ARGON2_TAG_BYTES,
        memory: ARGON2_MEMORY_KIB,
        passes: ARGON2_TIME_COST,
      }),
    );
    return encodePhc(
      {
        memory: ARGON2_MEMORY_KIB,
        passes: ARGON2_TIME_COST,
        parallelism: ARGON2_PARALLELISM,
        salt,
        tag,
      },
      ARGON2_VERSION,
    );
  }

  async verify(
    storedHash: string,
    password: string,
  ): Promise<PasswordVerification> {
    this.validate(password);
    if (LEGACY_SHA256_PATTERN.test(storedHash)) {
      const expected = Buffer.from(storedHash, 'hex');
      const actual = createHash('sha256').update(password, 'utf8').digest();
      return {
        valid: timingSafeEqual(expected, actual),
        needsRehash: true,
        algorithm: 'legacy_sha256',
      };
    }

    const parsed = parsePhc(storedHash);
    if (!parsed) {
      return {
        valid: false,
        needsRehash: false,
        algorithm: 'unknown',
      };
    }

    const actual = await this.limiter.run(() =>
      this.deriveArgon2({
        message: Buffer.from(password, 'utf8'),
        nonce: parsed.salt,
        parallelism: parsed.parallelism,
        tagLength: parsed.tag.length,
        memory: parsed.memory,
        passes: parsed.passes,
      }),
    );
    return {
      valid: timingSafeEqual(parsed.tag, actual),
      needsRehash:
        parsed.memory !== ARGON2_MEMORY_KIB ||
        parsed.passes !== ARGON2_TIME_COST ||
        parsed.parallelism !== ARGON2_PARALLELISM ||
        parsed.tag.length !== ARGON2_TAG_BYTES,
      algorithm: 'argon2id',
    };
  }

  createDummyHash(): Promise<string> {
    return this.hash('studytube-dummy-password');
  }
}

function parsePhc(storedHash: string): ParsedPhc | undefined {
  if (storedHash.length > PASSWORD_HASH_MAX_CHARACTERS) {
    return undefined;
  }
  const match = ARGON2ID_PHC_PATTERN.exec(storedHash);
  if (!match) {
    return undefined;
  }
  const memory = Number(match[1]);
  const passes = Number(match[2]);
  const parallelism = Number(match[3]);
  if (
    memory < 8 * parallelism ||
    memory > ARGON2_MEMORY_KIB ||
    passes < 2 ||
    passes > ARGON2_TIME_COST ||
    parallelism !== ARGON2_PARALLELISM
  ) {
    return undefined;
  }
  const salt = decodeCanonicalBase64(match[4], ARGON2_SALT_BYTES);
  const tag = decodeCanonicalBase64(match[5], ARGON2_TAG_BYTES);
  if (!salt || !tag) {
    return undefined;
  }
  return { memory, passes, parallelism, salt, tag };
}

function decodeCanonicalBase64(
  encoded: string,
  expectedBytes: number,
): Buffer | undefined {
  const decoded = Buffer.from(encoded, 'base64');
  if (decoded.length !== expectedBytes || encodeBase64(decoded) !== encoded) {
    return undefined;
  }
  return decoded;
}

function encodePhc(parsed: ParsedPhc, version: number): string {
  return `$${ARGON2_ALGORITHM}$v=${version}$m=${parsed.memory},t=${parsed.passes},p=${parsed.parallelism}$${encodeBase64(parsed.salt)}$${encodeBase64(parsed.tag)}`;
}

function encodeBase64(value: Buffer): string {
  return value.toString('base64').replace(/=+$/u, '');
}

function runNodeArgon2(parameters: Argon2Parameters): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    argon2(ARGON2_ALGORITHM, parameters, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derivedKey);
    });
  });
}
