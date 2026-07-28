import { SocketAddress } from 'node:net';

export type ClientAddressResolverOptions = {
  trustProxyOneHop?: boolean;
  environment?: 'development' | 'test' | 'production';
  bindAddress?: string;
};

export type AddressRequest = {
  socket: {
    remoteAddress?: string;
  };
  headers: Record<string, string | string[] | undefined>;
};

export class ClientAddressResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClientAddressResolutionError';
  }
}

export class ClientAddressResolver {
  private readonly trustProxyOneHop: boolean;

  constructor(options: ClientAddressResolverOptions = {}) {
    this.trustProxyOneHop = options.trustProxyOneHop ?? false;
    if (
      options.environment === 'production' &&
      this.trustProxyOneHop &&
      (!options.bindAddress ||
        !isLoopback(canonicalizeAddress(options.bindAddress)))
    ) {
      throw new ClientAddressResolutionError(
        'Production one-hop proxy trust requires a loopback-only bind address',
      );
    }
  }

  resolve(request: AddressRequest): string {
    const directAddress = canonicalizeAddress(request.socket.remoteAddress);
    if (!this.trustProxyOneHop || !isLoopback(directAddress)) {
      return directAddress;
    }

    const forwarded = request.headers['x-forwarded-for'];
    if (forwarded === undefined) {
      return directAddress;
    }
    if (
      typeof forwarded !== 'string' ||
      forwarded.length === 0 ||
      forwarded !== forwarded.trim() ||
      forwarded.includes(',')
    ) {
      throw new ClientAddressResolutionError(
        'Trusted proxy must provide exactly one forwarded address',
      );
    }
    return canonicalizeAddress(forwarded);
  }
}

export function canonicalizeAddress(address: string | undefined): string {
  if (!address || address !== address.trim() || address.includes('%')) {
    throw new ClientAddressResolutionError('Client address is malformed');
  }

  const ipv4 = SocketAddress.parse(address);
  if (ipv4?.family === 'ipv4' && ipv4.address === address) {
    return ipv4.address;
  }

  const ipv6 = SocketAddress.parse(`[${address}]:0`);
  if (ipv6?.family !== 'ipv6') {
    throw new ClientAddressResolutionError('Client address is malformed');
  }
  const mappedIpv4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/iu.exec(ipv6.address);
  if (mappedIpv4) {
    const mapped = SocketAddress.parse(mappedIpv4[1]);
    if (mapped?.family !== 'ipv4') {
      throw new ClientAddressResolutionError('Client address is malformed');
    }
    return mapped.address;
  }
  return ipv6.address.toLowerCase();
}

function isLoopback(address: string): boolean {
  if (address === '::1') {
    return true;
  }
  const firstOctet = Number(address.split('.', 1)[0]);
  return Number.isInteger(firstOctet) && firstOctet === 127;
}
