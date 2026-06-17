import { createCorsOptions } from './cors-options';

describe('createCorsOptions', () => {
  it('allows credentialed local frontend origins by default', () => {
    const options = createCorsOptions();

    expect(options.credentials).toBe(true);
    expect(options.origin).toEqual([
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ]);
  });

  it('parses a comma-separated origin allowlist', () => {
    const options = createCorsOptions(
      'https://app.example.com, http://localhost:5173 ',
    );

    expect(options.origin).toEqual([
      'https://app.example.com',
      'http://localhost:5173',
    ]);
  });
});
