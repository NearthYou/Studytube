import { isIP } from 'node:net';

export type RuntimeEnvironment = Record<string, string | undefined>;

export function resolveRuntimeListener(environment: RuntimeEnvironment): {
  host?: string;
  port: number;
} {
  const portText = environment.PORT ?? '3000';
  const port = Number(portText);
  if (!/^\d+$/u.test(portText) || port < 1 || port > 65_535) {
    throw new Error('API port must be an integer between 1 and 65535');
  }

  if (
    environment.NODE_ENV === 'production' &&
    !isLoopbackHost(environment.HOST)
  ) {
    throw new Error('Production API must bind to a loopback address');
  }

  return {
    host: environment.HOST,
    port,
  };
}

function isLoopbackHost(host: string | undefined): boolean {
  if (!host || host !== host.trim()) {
    return false;
  }
  if (host === '::1') {
    return true;
  }
  return isIP(host) === 4 && Number(host.split('.', 1)[0]) === 127;
}
