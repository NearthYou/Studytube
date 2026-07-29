import {
  ClientAddressResolutionError,
  ClientAddressResolver,
} from './client-address.resolver';

describe('ClientAddressResolver', () => {
  it.each([
    ['192.0.2.12', '192.0.2.12'],
    ['2001:0db8:0:0:0:0:0:1', '2001:db8::1'],
    ['::ffff:192.0.2.44', '192.0.2.44'],
  ])('canonicalizes direct address %s as %s', (remoteAddress, expected) => {
    const resolver = new ClientAddressResolver();

    expect(resolver.resolve(request(remoteAddress))).toBe(expected);
  });

  it('ignores a forged forwarding header from a non-loopback direct peer', () => {
    const resolver = new ClientAddressResolver({
      trustProxyOneHop: true,
      environment: 'development',
      bindAddress: '127.0.0.1',
    });

    expect(resolver.resolve(request('198.51.100.10', '203.0.113.90'))).toBe(
      '198.51.100.10',
    );
  });

  it('trusts exactly one canonical forwarded address from a loopback peer', () => {
    const resolver = new ClientAddressResolver({
      trustProxyOneHop: true,
      environment: 'production',
      bindAddress: '::1',
    });

    expect(resolver.resolve(request('::ffff:127.0.0.1', '2001:0db8::5'))).toBe(
      '2001:db8::5',
    );
  });

  it('restores one canonical forwarded address from the configured production Unix socket', () => {
    const resolver = new ClientAddressResolver({
      trustProxyOneHop: true,
      environment: 'production',
      trustedProxySocketPath: '/run/studytube/api.sock',
    });

    expect(resolver.resolve(request(undefined, '203.0.113.90'))).toBe(
      '203.0.113.90',
    );
  });

  it.each([undefined, '', '203.0.113.1, 203.0.113.2', ['203.0.113.1']])(
    'fails closed for a missing or malformed Unix-proxy address: %p',
    (forwarded) => {
      const resolver = new ClientAddressResolver({
        trustProxyOneHop: true,
        environment: 'production',
        trustedProxySocketPath: '/run/studytube/api.sock',
      });

      expect(() => resolver.resolve(request(undefined, forwarded))).toThrow(
        ClientAddressResolutionError,
      );
    },
  );

  it('rejects a TCP peer when configured for the production Unix socket', () => {
    const resolver = new ClientAddressResolver({
      trustProxyOneHop: true,
      environment: 'production',
      trustedProxySocketPath: '/run/studytube/api.sock',
    });

    expect(() =>
      resolver.resolve(request('127.0.0.1', '203.0.113.90')),
    ).toThrow(/transport/i);
  });

  it.each([
    '203.0.113.1, 203.0.113.2',
    '203.0.113.1:8080',
    'not-an-address',
    '',
    ['203.0.113.1', '203.0.113.2'],
  ])(
    'fails closed for an invalid trusted forwarding header: %p',
    (forwarded) => {
      const resolver = new ClientAddressResolver({
        trustProxyOneHop: true,
        environment: 'development',
        bindAddress: '127.0.0.1',
      });

      expect(() => resolver.resolve(request('127.0.0.1', forwarded))).toThrow(
        ClientAddressResolutionError,
      );
    },
  );

  it('fails closed for a malformed direct peer address', () => {
    expect(() =>
      new ClientAddressResolver().resolve(request('not-an-address')),
    ).toThrow(ClientAddressResolutionError);
  });

  it('rejects production proxy trust before loopback-only binding is declared', () => {
    expect(
      () =>
        new ClientAddressResolver({
          trustProxyOneHop: true,
          environment: 'production',
        }),
    ).toThrow(/loopback.*bind/i);
    expect(
      () =>
        new ClientAddressResolver({
          trustProxyOneHop: true,
          environment: 'production',
          bindAddress: '0.0.0.0',
        }),
    ).toThrow(/loopback.*bind/i);
  });

  it('rejects proxy trust when environment or loopback bind is omitted', () => {
    expect(
      () =>
        new ClientAddressResolver({
          trustProxyOneHop: true,
          bindAddress: '127.0.0.1',
        }),
    ).toThrow(/environment/i);
    expect(
      () =>
        new ClientAddressResolver({
          trustProxyOneHop: true,
          environment: 'development',
        }),
    ).toThrow(/loopback.*bind/i);
  });

  it.each(['/tmp/api.sock', '/run/studytube/../api.sock', 'relative.sock'])(
    'rejects an unsafe trusted proxy socket path: %p',
    (socketPath) => {
      expect(
        () =>
          new ClientAddressResolver({
            trustProxyOneHop: true,
            environment: 'production',
            trustedProxySocketPath: socketPath,
          }),
      ).toThrow(/socket/i);
    },
  );

  it('rejects a production Unix listener without explicit proxy trust', () => {
    expect(
      () =>
        new ClientAddressResolver({
          trustProxyOneHop: false,
          environment: 'production',
          trustedProxySocketPath: '/run/studytube/api.sock',
        }),
    ).toThrow(/socket.*proxy trust/i);
  });

  it.each(['development', 'test'] as const)(
    'allows explicit %s one-hop policy only with a loopback bind',
    (environment) => {
      expect(
        () =>
          new ClientAddressResolver({
            trustProxyOneHop: true,
            environment,
            bindAddress: '::1',
          }),
      ).not.toThrow();
    },
  );

  it('allows direct-peer mode without proxy environment or bind settings', () => {
    expect(() => new ClientAddressResolver()).not.toThrow();
  });
});

function request(
  remoteAddress: string | undefined,
  forwarded?: string | string[],
) {
  return {
    socket: { remoteAddress },
    headers: {
      'x-forwarded-for': forwarded,
    },
  };
}
