import { createCorsOptions } from './cors-options';

describe('createCorsOptions', () => {
  function evaluateOrigin(origin: string | undefined) {
    const options = createCorsOptions('http://localhost:5173');
    const originHandler = options.origin;

    if (typeof originHandler !== 'function') {
      throw new Error('Expected CORS origin to be handled by a function');
    }

    return new Promise<boolean>((resolve, reject) => {
      originHandler(origin, (error, allowed) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(Boolean(allowed));
      });
    });
  }

  it('allows Vite loopback origins used by browser login and signup', async () => {
    await expect(evaluateOrigin('http://localhost:5173')).resolves.toBe(true);
    await expect(evaluateOrigin('http://127.0.0.1:5173')).resolves.toBe(true);
    await expect(evaluateOrigin('http://[::1]:5173')).resolves.toBe(true);
  });

  it('allows same-machine requests without an Origin header', async () => {
    await expect(evaluateOrigin(undefined)).resolves.toBe(true);
  });

  it('rejects unrelated browser origins', async () => {
    await expect(evaluateOrigin('https://example.com')).resolves.toBe(false);
  });
});
