import { createCorsOptions } from './cors-options';

describe('createCorsOptions', () => {
  function evaluateOrigin(origin: string | undefined) {
    const options = createCorsOptions('https://app.studytube.example');
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

  it('enables credentials for the one exact configured origin', async () => {
    const options = createCorsOptions('https://app.studytube.example');

    expect(options.credentials).toBe(true);
    await expect(evaluateOrigin('https://app.studytube.example')).resolves.toBe(
      true,
    );
  });

  it.each([
    undefined,
    'null',
    'https://app.studytube.example.evil.test',
    'https://app.studytube.example, https://evil.example',
  ])(
    'rejects every origin other than the exact configured one: %p',
    async (origin) => {
      await expect(evaluateOrigin(origin)).resolves.toBe(false);
    },
  );

  it('rejects absent, multiple, and malformed configured origins at startup', () => {
    expect(() => createCorsOptions()).toThrow(/origin/i);
    expect(() =>
      createCorsOptions('https://one.test,https://two.test'),
    ).toThrow(/one.*origin/i);
    expect(() => createCorsOptions('not a url')).toThrow(/origin/i);
  });
});
