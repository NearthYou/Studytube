import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

const FORMAT_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MINIMUM_STORED_BYTES = 1 + IV_BYTES + TAG_BYTES + 1;

export class GoogleAttemptCrypto {
  private readonly key: Buffer;

  constructor(
    key: Buffer,
    private readonly random: (size: number) => Buffer = randomBytes,
  ) {
    if (key.length !== 32) {
      throw new RangeError('Google attempt encryption key must be 32 bytes');
    }
    this.key = Buffer.from(key);
  }

  digest(value: string): Buffer {
    return createHash('sha256').update(value, 'utf8').digest();
  }

  encryptVerifier(verifier: string): Buffer {
    if (!verifier || verifier.length > 512 || /\p{Cc}/u.test(verifier)) {
      throw new RangeError('Invalid PKCE verifier');
    }
    const version = Buffer.from([FORMAT_VERSION]);
    const iv = this.random(IV_BYTES);
    if (iv.length !== IV_BYTES) {
      throw new Error('Google authentication encryption is unavailable');
    }
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(version);
    const ciphertext = Buffer.concat([
      cipher.update(verifier, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([version, iv, ciphertext, tag]);
  }

  decryptVerifier(stored: Buffer): string {
    try {
      if (
        stored.length < MINIMUM_STORED_BYTES ||
        stored[0] !== FORMAT_VERSION
      ) {
        throw new Error('invalid format');
      }
      const version = stored.subarray(0, 1);
      const iv = stored.subarray(1, 1 + IV_BYTES);
      const tag = stored.subarray(stored.length - TAG_BYTES);
      const ciphertext = stored.subarray(
        1 + IV_BYTES,
        stored.length - TAG_BYTES,
      );
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAAD(version);
      decipher.setAuthTag(tag);
      const verifier = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString('utf8');
      if (!verifier || /\p{Cc}/u.test(verifier)) {
        throw new Error('invalid verifier');
      }
      return verifier;
    } catch {
      throw new Error('Invalid Google authentication attempt');
    }
  }
}
