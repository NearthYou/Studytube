export type VerificationEmailConfig = Readonly<{
  provider: 'ses' | 'capture';
  sender: string;
  publicOrigin: string;
  region?: string;
  sesCredentialSource?: 'instance-role';
  configurationSetName?: string;
  captureDirectory?: string;
  pollIntervalMs: number;
  leaseMs: number;
  sendTimeoutMs: number;
  maxAttempts: number;
  retryBaseMs: number;
  retryMaxMs: number;
}>;

export function resolveVerificationEmailConfig(
  environment: NodeJS.ProcessEnv,
): VerificationEmailConfig {
  const production = environment.NODE_ENV === 'production';
  const provider = providerValue(environment.AUTH_EMAIL_PROVIDER, production);
  if (production && provider === 'capture') {
    throw new RangeError('Capture email provider is forbidden in production');
  }

  const sender = requiredOrDefault(
    environment.AUTH_EMAIL_SENDER,
    production,
    'AUTH_EMAIL_SENDER',
    'no-reply@studytube.local',
  );
  if (!/^[^\s@]+@[^\s@]+$/u.test(sender)) {
    throw new RangeError('AUTH_EMAIL_SENDER must be a valid mailbox');
  }
  const publicOrigin = requiredOrDefault(
    environment.WEB_ORIGIN,
    production,
    'WEB_ORIGIN',
    'http://localhost:5173',
  );
  const parsedOrigin = parseOrigin(publicOrigin);
  if (production && parsedOrigin.protocol !== 'https:') {
    throw new RangeError('WEB_ORIGIN must use HTTPS in production');
  }

  const region = firstValue(
    environment.AUTH_EMAIL_AWS_REGION,
    environment.AWS_REGION,
  );
  if (provider === 'ses' && !region) {
    throw new RangeError('AWS_REGION must be configured for SES email');
  }
  const sesCredentialSource =
    provider === 'ses' ? resolveSesCredentialSource(environment) : undefined;
  const configurationSetName = firstValue(
    environment.AUTH_EMAIL_SES_CONFIGURATION_SET,
  );
  if (
    configurationSetName &&
    !/^[A-Za-z0-9_-]{1,64}$/u.test(configurationSetName)
  ) {
    throw new RangeError(
      'AUTH_EMAIL_SES_CONFIGURATION_SET must be a valid configuration set',
    );
  }

  const sendTimeoutMs = positiveInteger(
    environment.AUTH_EMAIL_SEND_TIMEOUT_MS,
    10_000,
    'AUTH_EMAIL_SEND_TIMEOUT_MS',
  );
  const leaseMs = positiveInteger(
    environment.AUTH_EMAIL_LEASE_MS,
    30_000,
    'AUTH_EMAIL_LEASE_MS',
  );
  if (leaseMs < sendTimeoutMs + 1_000) {
    throw new RangeError(
      'AUTH_EMAIL_LEASE_MS must safely exceed the provider timeout',
    );
  }

  return Object.freeze({
    provider,
    sender,
    publicOrigin: parsedOrigin.origin,
    ...(region ? { region } : {}),
    ...(sesCredentialSource ? { sesCredentialSource } : {}),
    ...(configurationSetName ? { configurationSetName } : {}),
    ...(provider === 'capture'
      ? {
          captureDirectory:
            firstValue(environment.AUTH_EMAIL_CAPTURE_DIR) ??
            'api/.captures/verification-emails',
        }
      : {}),
    pollIntervalMs: positiveInteger(
      environment.AUTH_EMAIL_POLL_INTERVAL_MS,
      1_000,
      'AUTH_EMAIL_POLL_INTERVAL_MS',
    ),
    leaseMs,
    sendTimeoutMs,
    maxAttempts: positiveInteger(
      environment.AUTH_EMAIL_MAX_ATTEMPTS,
      5,
      'AUTH_EMAIL_MAX_ATTEMPTS',
    ),
    retryBaseMs: positiveInteger(
      environment.AUTH_EMAIL_RETRY_BASE_MS,
      1_000,
      'AUTH_EMAIL_RETRY_BASE_MS',
    ),
    retryMaxMs: positiveInteger(
      environment.AUTH_EMAIL_RETRY_MAX_MS,
      60_000,
      'AUTH_EMAIL_RETRY_MAX_MS',
    ),
  });
}

function resolveSesCredentialSource(
  environment: NodeJS.ProcessEnv,
): NonNullable<VerificationEmailConfig['sesCredentialSource']> {
  if (
    firstValue(
      environment.AUTH_EMAIL_AWS_ACCESS_KEY_ID,
      environment.AUTH_EMAIL_AWS_SECRET_ACCESS_KEY,
      environment.AUTH_EMAIL_AWS_SESSION_TOKEN,
      environment.AWS_ACCESS_KEY_ID,
      environment.AWS_SECRET_ACCESS_KEY,
      environment.AWS_SESSION_TOKEN,
    )
  ) {
    throw new RangeError(
      'Static SES credentials are forbidden; use the EC2 instance role',
    );
  }
  const source = firstValue(environment.AUTH_EMAIL_AWS_CREDENTIAL_SOURCE);
  if (source !== 'instance-role') {
    throw new RangeError(
      'AUTH_EMAIL_AWS_CREDENTIAL_SOURCE must be instance-role for SES email',
    );
  }
  return source;
}

export function resolveVerificationPepper(
  environment: NodeJS.ProcessEnv,
): string {
  const value = environment.AUTH_VERIFICATION_PEPPER;
  if (value?.trim()) {
    return value;
  }
  if (environment.NODE_ENV === 'production') {
    throw new RangeError(
      'AUTH_VERIFICATION_PEPPER must be configured in production',
    );
  }
  return 'development-verification-pepper';
}

function providerValue(
  value: string | undefined,
  production: boolean,
): 'ses' | 'capture' {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return production ? 'ses' : 'capture';
  }
  if (normalized === 'ses' || normalized === 'capture') {
    return normalized;
  }
  throw new RangeError('AUTH_EMAIL_PROVIDER must be ses or capture');
}

function requiredOrDefault(
  value: string | undefined,
  required: boolean,
  name: string,
  fallback: string,
): string {
  const normalized = value?.trim();
  if (normalized) {
    return normalized;
  }
  if (required) {
    throw new RangeError(`${name} must be configured in production`);
  }
  return fallback;
}

function parseOrigin(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new RangeError('WEB_ORIGIN must be an absolute origin');
  }
  if (
    parsed.origin !== value ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new RangeError('WEB_ORIGIN must be an exact origin');
  }
  return parsed;
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return parsed;
}

function firstValue(...values: Array<string | undefined>): string | undefined {
  return values.map((value) => value?.trim()).find(Boolean);
}
