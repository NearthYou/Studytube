import { createCorsOptions } from './cors-options';

describe('createCorsOptions', () => {
  function evaluateOrigin(
    origin: string | undefined,
    configuredOrigin = 'https://app.studytube.example',
  ) {
    const options = createCorsOptions(configuredOrigin);
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

  it('normalizes case and an explicit default port before comparison', async () => {
    await expect(
      evaluateOrigin(
        'HTTPS://APP.STUDYTUBE.EXAMPLE:443',
        'https://app.studytube.example',
      ),
    ).resolves.toBe(true);
    await expect(
      evaluateOrigin(
        'https://app.studytube.example',
        'HTTPS://APP.STUDYTUBE.EXAMPLE:443',
      ),
    ).resolves.toBe(true);
  });

  it.each([
    undefined,
    'null',
    'https://app.studytube.example.evil.test',
    'https://app.studytube.example, https://evil.example',
    'ftp://app.studytube.example',
    'https://user@app.studytube.example',
    'https://app.studytube.example/path',
    'https://app.studytube.example?query=yes',
    'https://app.studytube.example#fragment',
    'https://@app.studytube.example',
    'https://:@app.studytube.example',
    ' https://app.studytube.example',
    'https://app.studytube.example ',
    '\thttps://app.studytube.example',
    'https://app.studytube.example\t',
    'https://app.studytube.example\u0000',
    'https://app.studytube.example\\',
    'https://app.studytube.example\\path',
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
    expect(() => createCorsOptions('https://user@example.test')).toThrow(
      /origin/i,
    );
    expect(() => createCorsOptions('https://example.test/path')).toThrow(
      /origin/i,
    );
  });

  it.each([
    'https://@example.test',
    'https://:@example.test',
    ' https://example.test',
    'https://example.test ',
    '\thttps://example.test',
    'https://example.test\t',
    'https://example.test\u0000',
    'https://example.test\\',
    'https://example.test\\path',
  ])(
    'rejects raw userinfo, OWS, or controls in configured Origin: %p',
    (origin) => {
      expect(() => createCorsOptions(origin)).toThrow(/origin/i);
    },
  );
});
