import {
  resolveVerificationEmailConfig,
  resolveVerificationPepper,
} from './verification-email.config';

describe('verification email configuration', () => {
  it('uses instance-role SES in production and requires its deployment identity', () => {
    expect(
      resolveVerificationEmailConfig({
        NODE_ENV: 'production',
        WEB_ORIGIN: 'https://studytube.example',
        AUTH_EMAIL_SENDER: 'no-reply@studytube.example',
        AWS_REGION: 'ap-northeast-2',
        AUTH_EMAIL_SES_CONFIGURATION_SET: 'studytube-transactional',
      }),
    ).toMatchObject({
      provider: 'ses',
      sender: 'no-reply@studytube.example',
      publicOrigin: 'https://studytube.example',
      region: 'ap-northeast-2',
      configurationSetName: 'studytube-transactional',
    });

    for (const [name, environment] of [
      [
        'AUTH_EMAIL_SENDER',
        {
          NODE_ENV: 'production',
          WEB_ORIGIN: 'https://studytube.example',
          AWS_REGION: 'ap-northeast-2',
        },
      ],
      [
        'AWS_REGION',
        {
          NODE_ENV: 'production',
          WEB_ORIGIN: 'https://studytube.example',
          AUTH_EMAIL_SENDER: 'no-reply@studytube.example',
        },
      ],
      [
        'WEB_ORIGIN',
        {
          NODE_ENV: 'production',
          AUTH_EMAIL_SENDER: 'no-reply@studytube.example',
          AWS_REGION: 'ap-northeast-2',
        },
      ],
    ] as const) {
      expect(() => resolveVerificationEmailConfig(environment)).toThrow(name);
    }
  });

  it('rejects capture and insecure origins in production', () => {
    expect(() =>
      resolveVerificationEmailConfig({
        NODE_ENV: 'production',
        AUTH_EMAIL_PROVIDER: 'capture',
        AUTH_EMAIL_SENDER: 'no-reply@studytube.example',
        AWS_REGION: 'ap-northeast-2',
        WEB_ORIGIN: 'https://studytube.example',
      }),
    ).toThrow(/capture.*production/i);
    expect(() =>
      resolveVerificationEmailConfig({
        NODE_ENV: 'production',
        AUTH_EMAIL_SENDER: 'no-reply@studytube.example',
        AWS_REGION: 'ap-northeast-2',
        WEB_ORIGIN: 'http://studytube.example',
      }),
    ).toThrow(/https/i);
  });

  it('uses an isolated capture adapter in development and test', () => {
    expect(
      resolveVerificationEmailConfig({
        NODE_ENV: 'test',
        AUTH_EMAIL_CAPTURE_DIR: '.tmp/auth-email-captures',
      }),
    ).toMatchObject({
      provider: 'capture',
      captureDirectory: '.tmp/auth-email-captures',
      sender: 'no-reply@studytube.local',
      publicOrigin: 'http://localhost:5173',
    });
  });

  it('rejects a lease that does not safely exceed the provider timeout', () => {
    expect(() =>
      resolveVerificationEmailConfig({
        NODE_ENV: 'test',
        AUTH_EMAIL_SEND_TIMEOUT_MS: '10000',
        AUTH_EMAIL_LEASE_MS: '10000',
      }),
    ).toThrow(/lease.*timeout/i);
  });

  it('rejects an invalid SES configuration set before startup', () => {
    expect(() =>
      resolveVerificationEmailConfig({
        NODE_ENV: 'production',
        AUTH_EMAIL_SENDER: 'no-reply@studytube.example',
        AWS_REGION: 'ap-northeast-2',
        WEB_ORIGIN: 'https://studytube.example',
        AUTH_EMAIL_SES_CONFIGURATION_SET: 'invalid configuration set',
      }),
    ).toThrow(/configuration set/i);
  });

  it('uses the exact same verification pepper in API and worker processes', () => {
    expect(
      resolveVerificationPepper({
        NODE_ENV: 'production',
        AUTH_VERIFICATION_PEPPER: ' padded-but-intentional ',
      }),
    ).toBe(' padded-but-intentional ');
    expect(() =>
      resolveVerificationPepper({
        NODE_ENV: 'production',
        AUTH_VERIFICATION_PEPPER: '   ',
      }),
    ).toThrow(/AUTH_VERIFICATION_PEPPER/u);
    expect(resolveVerificationPepper({ NODE_ENV: 'test' })).toBe(
      'development-verification-pepper',
    );
  });
});
