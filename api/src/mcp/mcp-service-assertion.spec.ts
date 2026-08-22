import { createHmac, randomUUID } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { McpServiceAssertionVerifier } from './mcp-service-assertion';

const SECRET = 'mcp-test-secret-that-is-at-least-thirty-two-bytes';
const NOW = 2_000_000_000;

describe('McpServiceAssertionVerifier', () => {
  const verifier = () =>
    new McpServiceAssertionVerifier(
      new ConfigService({ MCP_SERVICE_ASSERTION_SECRET: SECRET }),
    );

  it('accepts a signed short-lived service assertion', () => {
    const claims = verifier().verifyAuthorizationHeader(
      `Bearer ${mintAssertion()}`,
      NOW,
    );

    expect(claims.ownerId).toBe(42);
    expect(claims.subject).toBe('42');
    expect(claims.runId).toBe('11111111-1111-4111-8111-111111111111');
    expect(claims.attemptId).toBe('22222222-2222-4222-8222-222222222222');
    expect(claims.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(claims.capabilities).toEqual(['learning:evidence:search']);
  });

  it.each([
    ['missing bearer assertion', undefined],
    ['expired assertion', `Bearer ${mintAssertion({ issuedAt: NOW - 61 })}`],
    [
      'wrong issuer',
      `Bearer ${mintAssertion({ issuer: 'untrusted-service' })}`,
    ],
    ['wrong audience', `Bearer ${mintAssertion({ audience: 'another-api' })}`],
    ['missing scope', `Bearer ${mintAssertion({ scope: 'studytube:other' })}`],
    [
      'assertion lifetime over 120 seconds',
      `Bearer ${mintAssertion({ lifetimeSeconds: 121 })}`,
    ],
    [
      'assertion that is not active yet',
      `Bearer ${mintAssertion({ notBefore: NOW + 6 })}`,
    ],
    [
      'signature produced by another secret',
      `Bearer ${mintAssertion({ signingSecret: 'another-secret-that-is-at-least-thirty-two-bytes' })}`,
    ],
    ['shortened signature', `Bearer ${shortenSignature(mintAssertion())}`],
    [
      'non-canonical signature encoding',
      `Bearer ${makeSignatureNonCanonical(mintAssertion())}`,
    ],
  ])('rejects %s', (_caseName, authorization) => {
    expect(() =>
      verifier().verifyAuthorizationHeader(authorization, NOW),
    ).toThrow(UnauthorizedException);
  });
});

function mintAssertion(
  overrides: {
    issuedAt?: number;
    issuer?: string;
    audience?: string;
    scope?: string;
    lifetimeSeconds?: number;
    notBefore?: number;
    signingSecret?: string;
  } = {},
): string {
  const issuedAt = overrides.issuedAt ?? NOW;
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
    iss: overrides.issuer ?? 'studytube-mcp',
    aud: overrides.audience ?? 'studytube-api',
    sub: '42',
    iat: issuedAt,
    nbf: overrides.notBefore,
    exp: issuedAt + (overrides.lifetimeSeconds ?? 60),
    jti: randomUUID(),
    scope: overrides.scope ?? 'studytube:internal:mcp',
    run_id: '11111111-1111-4111-8111-111111111111',
    attempt_id: '22222222-2222-4222-8222-222222222222',
    lease_token: '33333333-3333-4333-8333-333333333333',
    context_snapshot_id: '11111111-1111-4111-8111-111111111111',
    capabilities: ['learning:evidence:search'],
  });
  const signingInput = `${header}.${payload}`;
  const signature = createHmac('sha256', overrides.signingSecret ?? SECRET)
    .update(signingInput, 'ascii')
    .digest('base64url');
  return `${signingInput}.${signature}`;
}

function makeSignatureNonCanonical(token: string): string {
  const segments = token.split('.');
  const signature = segments[2] ?? '';
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const last = alphabet.indexOf(signature.at(-1) ?? '');
  if (last < 0) {
    throw new Error('Expected a base64url signature');
  }
  const nonCanonicalLast = alphabet[(last & 0b111100) | 0b000001];
  segments[2] = `${signature.slice(0, -1)}${nonCanonicalLast}`;
  return segments.join('.');
}

function shortenSignature(token: string): string {
  const segments = token.split('.');
  segments[2] = (segments[2] ?? '').slice(0, -2);
  return segments.join('.');
}

function encode(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}
