import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import {
  AUTH_DIGEST_BYTES,
  OPAQUE_TOKEN_BASE64URL_CHARACTERS,
  OPAQUE_TOKEN_BYTES,
  VERIFICATION_TOKEN_KEY_VERSION,
} from './auth.constants';

export type OpaqueTokenIssue = {
  cookieValue: string;
  persistence: {
    digest: Buffer;
  };
};

export type VerificationTokenPersistence = {
  pendingRegistrationId: string;
  keyVersion: typeof VERIFICATION_TOKEN_KEY_VERSION;
  secretDigest: Buffer;
};

export type VerificationTokenIssue = {
  token: string;
  persistence: VerificationTokenPersistence;
};

export type ParsedVerificationToken = {
  keyVersion: typeof VERIFICATION_TOKEN_KEY_VERSION;
  pendingRegistrationId: string;
  secret: Buffer;
};

export type VerifiedVerificationToken = Omit<ParsedVerificationToken, 'secret'>;

type Pepper = Buffer | string;

const BASE64URL_SECRET_PATTERN = new RegExp(
  `^[A-Za-z0-9_-]{${OPAQUE_TOKEN_BASE64URL_CHARACTERS}}$`,
  'u',
);
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function issueOpaqueToken(): OpaqueTokenIssue {
  const cookieValue = randomBytes(OPAQUE_TOKEN_BYTES).toString('base64url');
  return {
    cookieValue,
    persistence: {
      digest: digestOpaqueToken(cookieValue),
    },
  };
}

export function digestOpaqueToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export function createVerificationToken(
  pepper: Pepper,
): VerificationTokenIssue {
  const pendingRegistrationId = randomUUID();
  const secret = deriveVerificationSecret(
    VERIFICATION_TOKEN_KEY_VERSION,
    pendingRegistrationId,
    pepper,
  );
  return {
    token: [
      VERIFICATION_TOKEN_KEY_VERSION,
      pendingRegistrationId,
      secret.toString('base64url'),
    ].join('.'),
    persistence: {
      pendingRegistrationId,
      keyVersion: VERIFICATION_TOKEN_KEY_VERSION,
      secretDigest: digestSecret(secret),
    },
  };
}

export function reconstructVerificationToken(
  pendingRegistrationId: string,
  keyVersion: typeof VERIFICATION_TOKEN_KEY_VERSION,
  pepper: Pepper,
): string {
  if (
    keyVersion !== VERIFICATION_TOKEN_KEY_VERSION ||
    !UUID_V4_PATTERN.test(pendingRegistrationId)
  ) {
    throw new RangeError('Invalid verification token identity');
  }
  const secret = deriveVerificationSecret(
    keyVersion,
    pendingRegistrationId,
    pepper,
  );
  return [keyVersion, pendingRegistrationId, secret.toString('base64url')].join(
    '.',
  );
}

export function parseVerificationToken(
  token: string,
): ParsedVerificationToken | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return undefined;
  }
  const [keyVersion, pendingRegistrationId, encodedSecret] = parts;
  if (
    keyVersion !== VERIFICATION_TOKEN_KEY_VERSION ||
    !UUID_V4_PATTERN.test(pendingRegistrationId) ||
    !BASE64URL_SECRET_PATTERN.test(encodedSecret)
  ) {
    return undefined;
  }
  const secret = Buffer.from(encodedSecret, 'base64url');
  if (
    secret.length !== OPAQUE_TOKEN_BYTES ||
    secret.toString('base64url') !== encodedSecret
  ) {
    return undefined;
  }
  return {
    keyVersion,
    pendingRegistrationId,
    secret,
  };
}

export function verifyVerificationToken(
  token: string,
  pepper: Pepper,
  storedSecretDigest: Buffer,
): VerifiedVerificationToken | undefined {
  const parsed = parseVerificationToken(token);
  if (!parsed || storedSecretDigest.length !== AUTH_DIGEST_BYTES) {
    return undefined;
  }
  const expectedSecret = deriveVerificationSecret(
    parsed.keyVersion,
    parsed.pendingRegistrationId,
    pepper,
  );
  const expectedDigest = digestSecret(expectedSecret);
  if (
    !timingSafeEqual(parsed.secret, expectedSecret) ||
    !timingSafeEqual(storedSecretDigest, expectedDigest)
  ) {
    return undefined;
  }
  return {
    keyVersion: parsed.keyVersion,
    pendingRegistrationId: parsed.pendingRegistrationId,
  };
}

export function rateLimitSubjectDigest(
  action: string,
  subject: string,
  pepper: Pepper,
): Buffer {
  if (action.length === 0) {
    throw new RangeError('Rate-limit action is required');
  }
  const actionBytes = Buffer.from(action, 'utf8');
  const subjectBytes = Buffer.from(subject, 'utf8');
  return createHmac('sha256', pepper)
    .update('studytube-rate-limit:v1\0', 'utf8')
    .update(encodeLength(actionBytes.length))
    .update(actionBytes)
    .update(encodeLength(subjectBytes.length))
    .update(subjectBytes)
    .digest();
}

function deriveVerificationSecret(
  keyVersion: typeof VERIFICATION_TOKEN_KEY_VERSION,
  pendingRegistrationId: string,
  pepper: Pepper,
): Buffer {
  return createHmac('sha256', pepper)
    .update(`email-verification:${keyVersion}:${pendingRegistrationId}`, 'utf8')
    .digest();
}

function encodeLength(length: number): Buffer {
  const encoded = Buffer.allocUnsafe(4);
  encoded.writeUInt32BE(length);
  return encoded;
}

function digestSecret(secret: Buffer): Buffer {
  return createHash('sha256').update(secret).digest();
}
