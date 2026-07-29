import { posix } from 'node:path';

export type RuntimeEnvironment = Record<string, string | undefined>;

export function resolveRuntimeListener(environment: RuntimeEnvironment):
  | {
      host?: string;
      port: number;
    }
  | {
      socketPath: string;
    } {
  if (environment.NODE_ENV === 'production') {
    const socketPath = environment.API_SOCKET_PATH;
    if (!isProductionApiSocketPath(socketPath)) {
      throw new Error(
        'Production API socket must be an absolute .sock path under /run/studytube',
      );
    }
    return { socketPath };
  }

  const portText = environment.PORT ?? '3000';
  const port = Number(portText);
  if (!/^\d+$/u.test(portText) || port < 1 || port > 65_535) {
    throw new Error('API port must be an integer between 1 and 65535');
  }

  return {
    host: environment.HOST,
    port,
  };
}

export function isProductionApiSocketPath(
  socketPath: string | undefined,
): socketPath is string {
  return Boolean(
    socketPath &&
    posix.normalize(socketPath) === socketPath &&
    /^\/run\/studytube\/[A-Za-z0-9._-]+\.sock$/u.test(socketPath),
  );
}
