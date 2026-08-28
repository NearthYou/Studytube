import { redactTelemetryValue } from './redaction';
import { StructuredJsonLogger } from './structured-logger';

describe('telemetry redaction', () => {
  it('removes secret canaries from a normal request log path', () => {
    const canary = 'CANARY_normal_never_log';
    const value = redactTelemetryValue({
      method: 'POST',
      route: '/auth/verify',
      headers: {
        Authorization: `Bearer ${canary}`,
        Cookie: `study_session=${canary}`,
        accept: 'application/json',
      },
      body: { verificationToken: canary, email: 'learner@example.com' },
      databaseUrl: `postgresql://studytube:${canary}@db.internal/studytube`,
      valkeyUrl: `redis://default:${canary}@cache.internal:6379`,
    });
    const serialized = JSON.stringify(value);

    expect(serialized).not.toContain(canary);
    expect(value).toEqual({
      method: 'POST',
      route: '/auth/verify',
      headers: {
        Authorization: '[REDACTED]',
        Cookie: '[REDACTED]',
        accept: 'application/json',
      },
      body: '[REDACTED]',
      databaseUrl: 'postgresql://[REDACTED]@db.internal/studytube',
      valkeyUrl: 'redis://[REDACTED]@cache.internal:6379',
    });
  });

  it('removes a secret canary from an error and its surrounding context', () => {
    const canary = 'CANARY_error_never_log';
    const lines: string[] = [];
    const logger = new StructuredJsonLogger({
      service: 'studytube-api',
      write: (line) => lines.push(line),
      clock: () => new Date('2026-07-29T00:00:00.000Z'),
    });
    const error = Object.assign(
      new Error(`upstream rejected verification_token=${canary}`),
      {
        code: 'UPSTREAM_REJECTED',
        authorization: `Bearer ${canary}`,
      },
    );

    logger.error('AI request failed', error, {
      verificationToken: canary,
      upstream: `redis://default:${canary}@valkey.internal:6379`,
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(canary);
    expect(JSON.parse(lines[0])).toMatchObject({
      timestamp: '2026-07-29T00:00:00.000Z',
      level: 'error',
      service: 'studytube-api',
      message: 'AI request failed',
      verificationToken: '[REDACTED]',
      upstream: 'redis://[REDACTED]@valkey.internal:6379',
      error: {
        name: 'Error',
        message: 'upstream rejected verification_token=[REDACTED]',
        code: 'UPSTREAM_REJECTED',
        authorization: '[REDACTED]',
      },
    });
  });

  it('redacts credentials from database and cache URLs embedded in text', () => {
    const value = redactTelemetryValue(
      'connections postgresql://app:db-secret@db:5432/app and valkey://cache-secret@cache:6379',
    );

    expect(value).toBe(
      'connections postgresql://[REDACTED]@db:5432/app and valkey://[REDACTED]@cache:6379',
    );
  });

  it('redacts a custom API key header inside an Axios-style error', () => {
    const canary = 'CANARY_internal_api_key_never_log';
    const error = Object.assign(new Error('upstream returned 500'), {
      config: {
        headers: {
          'X-INTERNAL-API-KEY': canary,
          Accept: 'application/json',
        },
      },
    });

    const serialized = JSON.stringify(redactTelemetryValue(error));

    expect(serialized).not.toContain(canary);
    expect(redactTelemetryValue(error)).toMatchObject({
      config: {
        headers: {
          'X-INTERNAL-API-KEY': '[REDACTED]',
          Accept: 'application/json',
        },
      },
    });
  });
});
