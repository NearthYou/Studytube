import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const EXPECTED_ISSUER = 'studytube-mcp';
const EXPECTED_AUDIENCE = 'studytube-api';
const REQUIRED_SCOPE = 'studytube:internal:mcp';
const MAX_ASSERTION_LIFETIME_SECONDS = 120;
const MAX_CLOCK_SKEW_SECONDS = 5;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type McpServiceClaims = Readonly<{
  ownerId: number;
  subject: string;
  runId: string;
  attemptId: string;
  requestId: string;
  leaseToken: string;
  contextSnapshotId: string;
  capabilities: readonly McpLearningCapability[];
}>;

export const MCP_LEARNING_CAPABILITIES = [
  'learning:evidence:search',
  'learning:state:read',
  'learning:metadata:verify',
  'learning:quiz:request',
  'learning:proposal:create',
] as const;

export type McpLearningCapability = (typeof MCP_LEARNING_CAPABILITIES)[number];

@Injectable()
export class McpServiceAssertionVerifier {
  private readonly secret: string;

  constructor(config: ConfigService) {
    this.secret =
      config.get<string>('MCP_SERVICE_ASSERTION_SECRET')?.trim() ?? '';
  }

  verifyAuthorizationHeader(
    authorization: string | undefined,
    now = Math.floor(Date.now() / 1000),
  ): McpServiceClaims {
    try {
      return this.verify(authorization, now);
    } catch {
      throw new UnauthorizedException('Valid MCP service assertion required');
    }
  }

  private verify(
    authorization: string | undefined,
    now: number,
  ): McpServiceClaims {
    if (Buffer.byteLength(this.secret, 'utf8') < 32) {
      throw new Error('MCP assertion verification unavailable');
    }
    if (!Number.isInteger(now)) {
      throw new Error('Invalid verification time');
    }
    const match =
      /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/u.exec(
        authorization ?? '',
      );
    if (!match) {
      throw new Error('Invalid authorization header');
    }

    const token = match[1];
    const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
    if (!encodedHeader || !encodedPayload || !encodedSignature) {
      throw new Error('Invalid assertion');
    }
    const header = decodeObject(encodedHeader);
    const payload = decodeObject(encodedPayload);
    if (header.alg !== 'HS256' || header.typ !== 'JWT') {
      throw new Error('Invalid assertion header');
    }

    const suppliedSignature = decodeSegment(encodedSignature);
    const expectedSignature = createHmac('sha256', this.secret)
      .update(`${encodedHeader}.${encodedPayload}`, 'ascii')
      .digest();
    if (
      suppliedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(suppliedSignature, expectedSignature)
    ) {
      throw new Error('Invalid assertion signature');
    }

    const issuedAt = integerClaim(payload.iat);
    const expiresAt = integerClaim(payload.exp);
    const notBefore =
      payload.nbf === undefined ? issuedAt : integerClaim(payload.nbf);
    if (
      issuedAt > now + MAX_CLOCK_SKEW_SECONDS ||
      notBefore > now + MAX_CLOCK_SKEW_SECONDS ||
      expiresAt <= now ||
      expiresAt <= issuedAt ||
      expiresAt - issuedAt > MAX_ASSERTION_LIFETIME_SECONDS
    ) {
      throw new Error('Invalid assertion lifetime');
    }
    if (payload.iss !== EXPECTED_ISSUER) {
      throw new Error('Invalid assertion issuer');
    }
    if (!containsAudience(payload.aud, EXPECTED_AUDIENCE)) {
      throw new Error('Invalid assertion audience');
    }
    if (!scopes(payload.scope).includes(REQUIRED_SCOPE)) {
      throw new Error('Invalid assertion scope');
    }

    const subject = stringClaim(payload.sub, 32);
    if (!/^[1-9][0-9]*$/u.test(subject)) {
      throw new Error('Invalid assertion subject');
    }
    const ownerId = Number(subject);
    if (!Number.isSafeInteger(ownerId)) {
      throw new Error('Invalid assertion subject');
    }
    const runId = uuidClaim(payload.run_id);
    const attemptId = uuidClaim(payload.attempt_id);
    const requestId = stringClaim(payload.jti, 128);
    const leaseToken = uuidClaim(payload.lease_token);
    const contextSnapshotId = uuidClaim(payload.context_snapshot_id);
    const capabilities = capabilityClaims(payload.capabilities);

    return Object.freeze({
      ownerId,
      subject,
      runId,
      attemptId,
      requestId,
      leaseToken,
      contextSnapshotId,
      capabilities,
    });
  }
}

function capabilityClaims(value: unknown): readonly McpLearningCapability[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Invalid assertion capabilities');
  }
  const allowed = new Set<string>(MCP_LEARNING_CAPABILITIES);
  const unique = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || !allowed.has(item) || unique.has(item)) {
      throw new Error('Invalid assertion capabilities');
    }
    unique.add(item);
  }
  return Object.freeze([...unique] as McpLearningCapability[]);
}

function decodeObject(segment: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(decodeSegment(segment).toString('utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid assertion object');
  }
  return parsed as Record<string, unknown>;
}

function decodeSegment(segment: string): Buffer {
  if (!segment || !/^[A-Za-z0-9_-]+$/u.test(segment)) {
    throw new Error('Invalid assertion encoding');
  }
  const decoded = Buffer.from(segment, 'base64url');
  if (decoded.toString('base64url') !== segment) {
    throw new Error('Non-canonical assertion encoding');
  }
  return decoded;
}

function integerClaim(value: unknown): number {
  if (!Number.isSafeInteger(value)) {
    throw new Error('Invalid integer claim');
  }
  return value as number;
}

function stringClaim(value: unknown, maximumLength: number): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumLength
  ) {
    throw new Error('Invalid string claim');
  }
  return value;
}

function uuidClaim(value: unknown): string {
  const uuid = stringClaim(value, 64);
  if (!UUID_PATTERN.test(uuid)) {
    throw new Error('Invalid UUID claim');
  }
  return uuid.toLowerCase();
}

function containsAudience(value: unknown, expected: string): boolean {
  return (
    value === expected ||
    (Array.isArray(value) &&
      value.every((item) => typeof item === 'string') &&
      value.includes(expected))
  );
}

function scopes(value: unknown): string[] {
  if (typeof value === 'string') {
    return value.split(/\s+/u).filter(Boolean);
  }
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value;
  }
  throw new Error('Invalid assertion scope');
}
