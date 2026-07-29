import { resolveRuntimeListener } from './runtime-listener';

describe('runtime listener', () => {
  it('binds the production API to a permissioned Unix socket', () => {
    expect(
      resolveRuntimeListener({
        NODE_ENV: 'production',
        API_SOCKET_PATH: '/run/studytube/api.sock',
      }),
    ).toEqual({ socketPath: '/run/studytube/api.sock' });
  });

  it.each([
    undefined,
    '',
    'api.sock',
    '/tmp/api.sock',
    '/run/studytube/../api.sock',
  ])('rejects an unsafe production socket path: %p', (socketPath) => {
    expect(() =>
      resolveRuntimeListener({
        NODE_ENV: 'production',
        API_SOCKET_PATH: socketPath,
      }),
    ).toThrow(/production.*socket/i);
  });

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
