import { resolveAuthMode } from './auth-mode';

describe('resolveAuthMode', () => {
  it.each(['legacy', 'google_only'] as const)(
    'accepts explicit mode %s',
    (mode) => {
      expect(resolveAuthMode({ NODE_ENV: 'production', AUTH_MODE: mode })).toBe(
        mode,
      );
    },
  );

  it('refuses production without an explicit mode', () => {
    expect(() => resolveAuthMode({ NODE_ENV: 'production' })).toThrow(
      'AUTH_MODE',
    );
  });

  it('defaults local and test environments to legacy during the cutover', () => {
    expect(resolveAuthMode({ NODE_ENV: 'test' })).toBe('legacy');
    expect(resolveAuthMode({ NODE_ENV: 'development' })).toBe('legacy');
  });

  it('rejects an unknown mode', () => {
    expect(() =>
      resolveAuthMode({ NODE_ENV: 'test', AUTH_MODE: 'passwordless' }),
    ).toThrow('AUTH_MODE');
  });
});
