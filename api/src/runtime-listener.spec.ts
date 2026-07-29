import { resolveRuntimeListener } from './runtime-listener';

describe('runtime listener', () => {
  it('binds the production API to the configured loopback address', () => {
    expect(
      resolveRuntimeListener({
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: '3100',
      }),
    ).toEqual({ host: '127.0.0.1', port: 3100 });
  });

  it('accepts the IPv6 loopback address in production', () => {
    expect(
      resolveRuntimeListener({
        NODE_ENV: 'production',
        HOST: '::1',
        PORT: '3000',
      }),
    ).toEqual({ host: '::1', port: 3000 });
  });

  it.each([undefined, '0.0.0.0', '192.0.2.10'])(
    'rejects a production bind outside loopback: %p',
    (host) => {
      expect(() =>
        resolveRuntimeListener({
          NODE_ENV: 'production',
          HOST: host,
          PORT: '3000',
        }),
      ).toThrow(/production.*loopback/i);
    },
  );

  it.each(['0', '65536', '3000.5', 'not-a-number'])(
    'rejects an invalid API port: %p',
    (port) => {
      expect(() =>
        resolveRuntimeListener({
          NODE_ENV: 'development',
          PORT: port,
        }),
      ).toThrow(/port.*1.*65535/i);
    },
  );

  it('keeps the development listener compatible with the existing default', () => {
    expect(resolveRuntimeListener({ NODE_ENV: 'development' })).toEqual({
      host: undefined,
      port: 3000,
    });
  });
});
