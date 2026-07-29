const REDACTED = '[REDACTED]';

const SENSITIVE_KEYS = new Set([
  'authorization',
  'cookie',
  'setcookie',
  'password',
  'passphrase',
  'secret',
  'apikey',
  'session',
  'sessionid',
  'sessiontoken',
  'verificationcode',
  'verificationtoken',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'clientsecret',
  'privatekey',
]);

const REQUEST_BODY_KEYS = new Set(['body', 'requestbody']);
const CREDENTIAL_URL_PATTERN =
  /((?:postgres(?:ql)?|redis(?:s)?|valkey(?:s)?):\/\/)([^@\s/]+)@/giu;
const SENSITIVE_ASSIGNMENT_PATTERN =
  /\b(authorization|cookie|set-cookie|password|passphrase|secret|api[_-]?key|session(?:[_-]?(?:id|token))?|verification[_-]?(?:code|token)|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|private[_-]?key)(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu;
const AUTH_SCHEME_PATTERN = /\b(Bearer|Basic)\s+[^\s,;]+/giu;

export function redactTelemetryValue(value: unknown): unknown {
  const secrets = collectSecretValues(value);
  return redactValue(value, secrets, new WeakSet<object>());
}

function collectSecretValues(value: unknown): readonly string[] {
  const secrets = new Set<string>();
  collect(value, undefined, secrets, new WeakSet<object>());
  return [...secrets].sort((left, right) => right.length - left.length);
}

function collect(
  value: unknown,
  key: string | undefined,
  secrets: Set<string>,
  seen: WeakSet<object>,
): void {
  if (typeof value === 'string') {
    if (key && isSensitiveKey(key)) {
      addSecretCandidates(value, secrets);
    }
    for (const match of value.matchAll(CREDENTIAL_URL_PATTERN)) {
      addUrlCredentialSecret(match[2] ?? '', secrets);
    }
    return;
  }
  if (value === null || typeof value !== 'object' || seen.has(value)) {
    return;
  }
  seen.add(value);

  if (value instanceof Error) {
    collect(value.message, undefined, secrets, seen);
    for (const property of Object.getOwnPropertyNames(value)) {
      collect(
        (value as unknown as Record<string, unknown>)[property],
        property,
        secrets,
        seen,
      );
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collect(item, key, secrets, seen);
    }
    return;
  }

  for (const [property, child] of Object.entries(value)) {
    collect(child, property, secrets, seen);
  }
}

function addUrlCredentialSecret(
  credentials: string,
  secrets: Set<string>,
): void {
  const separator = credentials.indexOf(':');
  const encodedSecret =
    separator >= 0 ? credentials.slice(separator + 1) : credentials;
  addSecret(encodedSecret, secrets);
  try {
    addSecret(decodeURIComponent(encodedSecret), secrets);
  } catch {
    // Invalid URL encoding is still redacted by the credential URL pattern.
  }
}

function addSecretCandidates(value: string, secrets: Set<string>): void {
  const trimmed = value.trim();
  addSecret(trimmed, secrets);

  const authToken = /^(?:Bearer|Basic)\s+(.+)$/iu.exec(trimmed)?.[1];
  if (authToken) {
    addSecret(authToken, secrets);
  }

  for (const part of trimmed.split(/[=:;]/u)) {
    addSecret(part.trim(), secrets);
  }
}

function addSecret(value: string, secrets: Set<string>): void {
  if (value.length >= 4 && value !== REDACTED) {
    secrets.add(value);
  }
}

function redactValue(
  value: unknown,
  secrets: readonly string[],
  seen: WeakSet<object>,
): unknown {
  if (typeof value === 'string') {
    return redactString(value, secrets);
  }
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'undefined'
  ) {
    return value;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'symbol' || typeof value === 'function') {
    return String(value);
  }
  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);

  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Error) {
    return redactError(value, secrets, seen);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, secrets, seen));
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveKey(key) || REQUEST_BODY_KEYS.has(normalizeKey(key))) {
      redacted[key] = REDACTED;
    } else {
      redacted[key] = redactValue(child, secrets, seen);
    }
  }
  return redacted;
}

function redactError(
  error: Error,
  secrets: readonly string[],
  seen: WeakSet<object>,
): Record<string, unknown> {
  const serialized: Record<string, unknown> = {
    name: redactString(error.name, secrets),
    message: redactString(error.message, secrets),
  };
  if (error.stack) {
    serialized.stack = redactString(error.stack, secrets);
  }
  if (error.cause !== undefined) {
    serialized.cause = redactValue(error.cause, secrets, seen);
  }

  for (const property of Object.getOwnPropertyNames(error)) {
    if (property === 'name' || property === 'message' || property === 'stack') {
      continue;
    }
    if (isSensitiveKey(property)) {
      serialized[property] = REDACTED;
    } else {
      serialized[property] = redactValue(
        (error as unknown as Record<string, unknown>)[property],
        secrets,
        seen,
      );
    }
  }
  return serialized;
}

function redactString(value: string, secrets: readonly string[]): string {
  let redacted = value
    .replace(CREDENTIAL_URL_PATTERN, `$1${REDACTED}@`)
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, `$1$2${REDACTED}`)
    .replace(AUTH_SCHEME_PATTERN, `$1 ${REDACTED}`);

  for (const secret of secrets) {
    redacted = redacted.replaceAll(secret, REDACTED);
  }
  return redacted;
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(normalizeKey(key));
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/gu, '');
}
