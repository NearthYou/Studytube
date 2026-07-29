import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClientAddressResolver } from './client-address.resolver';

const describeUnix = process.platform === 'win32' ? describe.skip : describe;

describeUnix('ClientAddressResolver Unix socket boundary', () => {
  it('accepts only one Caddy-style forwarded address over an actual Unix socket', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'studytube-unix-'));
    const socketPath = join(directory, 'api.sock');
    const resolver = new ClientAddressResolver({
      trustProxyOneHop: true,
      environment: 'production',
      trustedProxySocketPath: '/run/studytube/api.sock',
    });
    const server = createServer((incoming, response) => {
      try {
        const address = resolver.resolve({
          socket: incoming.socket,
          headers: incoming.headers,
        });
        response.statusCode = 200;
        response.end(address);
      } catch {
        response.statusCode = 400;
        response.end('rejected');
      }
    });

    try {
      await listen(server, socketPath);

      await expect(call(socketPath, '203.0.113.90')).resolves.toEqual({
        status: 200,
        body: '203.0.113.90',
      });
      await expect(call(socketPath)).resolves.toEqual({
        status: 400,
        body: 'rejected',
      });
      await expect(
        call(socketPath, '203.0.113.90, 198.51.100.5'),
      ).resolves.toEqual({ status: 400, body: 'rejected' });
    } finally {
      if (server.listening) {
        await close(server);
      }
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function listen(server: Server, socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function call(
  socketPath: string,
  forwarded?: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      {
        socketPath,
        path: '/',
        ...(forwarded ? { headers: { 'x-forwarded-for': forwarded } } : {}),
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    outgoing.once('error', reject);
    outgoing.end();
  });
}
