import { requireEvaluationDatabaseUrl } from '../../scripts/eval-database';

describe('evaluation database boundary', () => {
  it('accepts a dedicated local evaluation database', () => {
    const url = 'postgresql://app:app@127.0.0.1:55432/app_eval';
    expect(requireEvaluationDatabaseUrl(url, 'development')).toBe(url);
  });

  it.each([
    'postgresql://app:app@production.example.com/app_eval',
    'postgresql://app:app@localhost/production',
    'postgresql://app:app@localhost/app_eval/extra',
    'https://localhost/app_eval',
  ])('rejects a non-evaluation target', (url) => {
    expect(() => requireEvaluationDatabaseUrl(url, 'development')).toThrow();
  });

  it('rejects production mode even for a local database', () => {
    expect(() =>
      requireEvaluationDatabaseUrl(
        'postgresql://localhost/app_eval',
        'production',
      ),
    ).toThrow();
  });
});
