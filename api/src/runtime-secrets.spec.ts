import { assertProductionRuntimeSecrets } from './runtime-secrets';

const validProductionSecrets = {
  NODE_ENV: 'production',
  INTERNAL_AI_API_KEY: 'a'.repeat(32),
  AUTH_VERIFICATION_PEPPER: 'b'.repeat(32),
  AUTH_RATE_LIMIT_PEPPER: 'c'.repeat(32),
} satisfies NodeJS.ProcessEnv;

describe('production runtime secrets', () => {
  it('accepts distinct non-placeholder secrets', () => {
    expect(() =>
      assertProductionRuntimeSecrets(validProductionSecrets),
    ).not.toThrow();
  });

  it.each([
    ['missing', undefined],
    ['short', 'too-short'],
    ['placeholder', 'replace-with-a-random-production-secret'],
  ])('rejects a %s secret', (_case, secret) => {
    expect(() =>
      assertProductionRuntimeSecrets({
        ...validProductionSecrets,
        INTERNAL_AI_API_KEY: secret,
      }),
    ).toThrow(/INTERNAL_AI_API_KEY/u);
  });

  it('rejects reuse across independent security boundaries', () => {
    expect(() =>
      assertProductionRuntimeSecrets({
        ...validProductionSecrets,
        AUTH_RATE_LIMIT_PEPPER: validProductionSecrets.AUTH_VERIFICATION_PEPPER,
      }),
    ).toThrow(/different production secrets/u);
  });

  it('does not impose production requirements on tests or local development', () => {
    expect(() =>
      assertProductionRuntimeSecrets({ NODE_ENV: 'test' }),
    ).not.toThrow();
  });
});
