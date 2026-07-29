import { assertProductionRuntimeSecrets } from './runtime-secrets';

const validProductionSecrets = {
  NODE_ENV: 'production',
  INTERNAL_AI_API_KEY: 'a'.repeat(32),
  AUTH_VERIFICATION_PEPPER: 'b'.repeat(32),
  AUTH_RATE_LIMIT_PEPPER: 'c'.repeat(32),
  MCP_SERVICE_ASSERTION_SECRET: 'd'.repeat(32),
} satisfies NodeJS.ProcessEnv;

describe('production runtime secrets', () => {
  it('does not require the API-only MCP secret for the worker runtime', () => {
    expect(() =>
      assertProductionRuntimeSecrets(
        {
          NODE_ENV: 'production',
          INTERNAL_AI_API_KEY: validProductionSecrets.INTERNAL_AI_API_KEY,
          AUTH_VERIFICATION_PEPPER:
            validProductionSecrets.AUTH_VERIFICATION_PEPPER,
          AUTH_RATE_LIMIT_PEPPER: validProductionSecrets.AUTH_RATE_LIMIT_PEPPER,
        },
        'worker',
      ),
    ).not.toThrow();
  });

  it('accepts distinct non-placeholder secrets', () => {
    expect(() =>
      assertProductionRuntimeSecrets(validProductionSecrets, 'api'),
    ).not.toThrow();
  });

  it.each([
    ['missing', undefined],
    ['short', 'too-short'],
    ['placeholder', 'replace-with-a-random-production-secret'],
  ])('rejects a %s secret', (_case, secret) => {
    expect(() =>
      assertProductionRuntimeSecrets(
        {
          ...validProductionSecrets,
          INTERNAL_AI_API_KEY: secret,
        },
        'api',
      ),
    ).toThrow(/INTERNAL_AI_API_KEY/u);
  });

  it('rejects reuse across independent security boundaries', () => {
    expect(() =>
      assertProductionRuntimeSecrets(
        {
          ...validProductionSecrets,
          AUTH_RATE_LIMIT_PEPPER:
            validProductionSecrets.AUTH_VERIFICATION_PEPPER,
        },
        'api',
      ),
    ).toThrow(/different production secrets/u);
  });

  it.each([
    ['missing', undefined],
    ['short', 'too-short'],
    ['placeholder', 'replace-with-a-random-production-secret'],
  ])('rejects a %s MCP service assertion secret', (_case, secret) => {
    expect(() =>
      assertProductionRuntimeSecrets(
        {
          ...validProductionSecrets,
          MCP_SERVICE_ASSERTION_SECRET: secret,
        },
        'api',
      ),
    ).toThrow(/MCP_SERVICE_ASSERTION_SECRET/u);
  });

  it.each([
    ['INTERNAL_AI_API_KEY', validProductionSecrets.INTERNAL_AI_API_KEY],
    [
      'AUTH_VERIFICATION_PEPPER',
      validProductionSecrets.AUTH_VERIFICATION_PEPPER,
    ],
    ['AUTH_RATE_LIMIT_PEPPER', validProductionSecrets.AUTH_RATE_LIMIT_PEPPER],
  ])('rejects MCP secret reuse with %s', (_name, secret) => {
    expect(() =>
      assertProductionRuntimeSecrets(
        {
          ...validProductionSecrets,
          MCP_SERVICE_ASSERTION_SECRET: secret,
        },
        'api',
      ),
    ).toThrow(/different production secrets/u);
  });

  it('does not impose production requirements on tests or local development', () => {
    expect(() =>
      assertProductionRuntimeSecrets({ NODE_ENV: 'test' }, 'api'),
    ).not.toThrow();
  });
});
