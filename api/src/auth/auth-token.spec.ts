import { createHash, createHmac } from 'node:crypto';
import {
  createVerificationToken,
  digestOpaqueToken,
  issueOpaqueToken,
  parseVerificationToken,
  rateLimitSubjectDigest,
  reconstructVerificationToken,
  verifyVerificationToken,
} from './auth-token';

describe('auth token primitives', () => {
  const verificationPepper = Buffer.alloc(32, 0x41);
  const rateLimitPepper = Buffer.alloc(32, 0x52);

  it('issues a 32-byte base64url token with only its digest marked for persistence', () => {
    const issued = issueOpaqueToken();

    expect(issued.cookieValue).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued.persistence).toEqual({
      digest: createHash('sha256').update(issued.cookieValue, 'utf8').digest(),
    });
    expect(issued.persistence.digest).toBeInstanceOf(Buffer);
    expect(issued.persistence.digest).toHaveLength(32);
    expect(issued.persistence).not.toHaveProperty('cookieValue');
    expect(issued.persistence).not.toHaveProperty('token');
  });

  it('digests an opaque cookie token to a 32-byte Buffer', () => {
    const token = Buffer.alloc(32, 0x7f).toString('base64url');

    expect(digestOpaqueToken(token)).toEqual(
      createHash('sha256').update(token, 'utf8').digest(),
    );
    expect(digestOpaqueToken(token)).toHaveLength(32);
  });

  it('creates and validates a versioned verification token without persisting its secret', () => {
    const created = createVerificationToken(verificationPepper);

    expect(created.token).toMatch(
      /^v1\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/,
    );
    expect(Object.keys(created.persistence).sort()).toEqual([
      'keyVersion',
      'pendingRegistrationId',
      'secretDigest',
    ]);
    expect(typeof created.persistence.pendingRegistrationId).toBe('string');
    expect(created.persistence.keyVersion).toBe('v1');
    expect(created.persistence.secretDigest).toBeInstanceOf(Buffer);
    expect(created.persistence.secretDigest).toHaveLength(32);
    const expectedSecret = createHmac('sha256', verificationPepper)
      .update(
        `email-verification:v1:${created.persistence.pendingRegistrationId}`,
        'utf8',
      )
      .digest();
    expect(created.persistence.secretDigest).toEqual(
      createHash('sha256').update(expectedSecret).digest(),
    );
    expect(created.persistence).not.toHaveProperty('secret');
    expect(
      verifyVerificationToken(
        created.token,
        verificationPepper,
        created.persistence.secretDigest,
      ),
    ).toEqual({
      pendingRegistrationId: created.persistence.pendingRegistrationId,
      keyVersion: 'v1',
    });
  });

  it.each([
    'v2.123e4567-e89b-42d3-a456-426614174000.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    'v1.not-a-uuid.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    'v1.123e4567-e89b-42d3-a456-426614174000.short',
    'v1.123e4567-e89b-42d3-a456-426614174000.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    'v1.123e4567-e89b-42d3-a456-426614174000.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA+',
  ])('rejects malformed verification token grammar: %s', (token) => {
    expect(parseVerificationToken(token)).toBeUndefined();
    expect(
      verifyVerificationToken(token, verificationPepper, Buffer.alloc(32)),
    ).toBeUndefined();
  });

  it('rejects a verification token when either secret or stored digest differs', () => {
    const created = createVerificationToken(verificationPepper);
    const parsed = parseVerificationToken(created.token);
    if (!parsed) {
      throw new Error('Expected generated verification token to parse');
    }
    const alteredSecret = Buffer.from(parsed.secret);
    alteredSecret[0] ^= 0xff;
    const alteredToken = [
      parsed.keyVersion,
      parsed.pendingRegistrationId,
      alteredSecret.toString('base64url'),
    ].join('.');

    expect(
      verifyVerificationToken(
        alteredToken,
        verificationPepper,
        created.persistence.secretDigest,
      ),
    ).toBeUndefined();
    expect(
      verifyVerificationToken(
        created.token,
        verificationPepper,
        Buffer.alloc(32, 0xff),
      ),
    ).toBeUndefined();
  });

  it('reconstructs the same verification token in a fresh worker instance', () => {
    const created = createVerificationToken(verificationPepper);

    expect(
      reconstructVerificationToken(
        created.persistence.pendingRegistrationId,
        created.persistence.keyVersion,
        Buffer.from(verificationPepper),
      ),
    ).toBe(created.token);
  });

  it('domain-separates rate-limit subjects by action', () => {
    const subject = '192.0.2.40';

    const signup = rateLimitSubjectDigest(
      'signup-ip',
      subject,
      rateLimitPepper,
    );
    const login = rateLimitSubjectDigest('login-ip', subject, rateLimitPepper);

    expect(signup).toHaveLength(32);
    expect(login).toHaveLength(32);
    expect(signup.equals(login)).toBe(false);
    expect(
      rateLimitSubjectDigest('signup-ip', subject, rateLimitPepper),
    ).toEqual(signup);
  });
});
