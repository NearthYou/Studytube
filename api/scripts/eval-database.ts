export function requireEvaluationDatabaseUrl(
  value = process.env.DATABASE_URL,
  environment = process.env.NODE_ENV,
): string {
  if (!value || environment === 'production') {
    throw new Error(
      'Evaluation requires a local DATABASE_URL outside production',
    );
  }
  const url = new URL(value);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !/^\/[a-z0-9_]+_eval$/u.test(url.pathname)
  ) {
    throw new Error(
      'Evaluation database must be local and its name must end in _eval',
    );
  }
  return value;
}
