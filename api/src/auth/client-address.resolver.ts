import { SocketAddress } from 'node:net';
import { isProductionApiSocketPath } from '../runtime-listener';

export type ClientAddressResolverOptions = {
  trustProxyOneHop?: boolean;
  environment?: 'development' | 'test' | 'production';
  bindAddress?: string;
  trustedProxySocketPath?: string;
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
  private readonly proxyTransport: 'direct' | 'loopback' | 'unix';

  constructor(options: ClientAddressResolverOptions = {}) {
    const trustProxyOneHop = options.trustProxyOneHop ?? false;
    if (options.trustedProxySocketPath !== undefined) {
      if (
        options.environment !== 'production' ||
        !isProductionApiSocketPath(options.trustedProxySocketPath)
      ) {
        throw new ClientAddressResolutionError(
          'Trusted proxy socket path is invalid',
        );
      }
      if (!trustProxyOneHop) {
        throw new ClientAddressResolutionError(
          'Unix socket listener requires explicit proxy trust',
        );
      }
      this.proxyTransport = 'unix';
      return;
    }
    if (!trustProxyOneHop) {
      this.proxyTransport = 'direct';
      return;
    }
    if (!options.environment) {
      throw new ClientAddressResolutionError(
        'One-hop proxy trust requires an explicit environment',
      );
    }
    if (!isLoopbackBind(options.bindAddress)) {
      throw new ClientAddressResolutionError(
        'One-hop proxy trust requires a loopback-only bind address',
      );
    }
    this.proxyTransport = 'loopback';
  }

  resolve(request: AddressRequest): string {
    if (this.proxyTransport === 'unix') {
      if (request.socket.remoteAddress !== undefined) {
        throw new ClientAddressResolutionError(
          'Trusted proxy transport does not match the Unix socket listener',
        );
      }
      return forwardedAddress(request.headers['x-forwarded-for']);
    }

    const directAddress = canonicalizeAddress(request.socket.remoteAddress);
    if (this.proxyTransport === 'direct' || !isLoopback(directAddress)) {
      return directAddress;
    }
    return forwardedAddress(request.headers['x-forwarded-for']);
  }
}

function forwardedAddress(forwarded: string | string[] | undefined): string {
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

function isLoopbackBind(bindAddress: string | undefined): boolean {
  if (!bindAddress) {
    return false;
  }
  try {
    return isLoopback(canonicalizeAddress(bindAddress));
  } catch {
    return false;
  }
}
