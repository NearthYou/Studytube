const workerProductionSecretNames = [
  'INTERNAL_AI_API_KEY',
  'MCP_SERVICE_ASSERTION_SECRET',
] as const;

const apiProductionSecretNames = [
  ...workerProductionSecretNames,
  'AUTH_VERIFICATION_PEPPER',
  'AUTH_RATE_LIMIT_PEPPER',
] as const;

const forbiddenMarkers = [
  'change-me',
  'replace-with',
  'example',
  'placeholder',
] as const;

export function assertProductionRuntimeSecrets(
  environment: NodeJS.ProcessEnv,
  runtimeRole: 'api' | 'worker',
): void {
  if (environment.NODE_ENV !== 'production') {
    return;
  }
  const productionSecretNames =
    runtimeRole === 'api'
      ? apiProductionSecretNames
      : environment.AUTH_MODE === 'legacy'
        ? [...workerProductionSecretNames, 'AUTH_VERIFICATION_PEPPER']
        : workerProductionSecretNames;
  const values = productionSecretNames.map((name) => {
    const value = environment[name]?.trim() ?? '';
    const normalized = value.toLowerCase();
    if (
      value.length < 32 ||
      forbiddenMarkers.some((marker) => normalized.includes(marker))
    ) {
      throw new RangeError(
        `${name} must be a non-placeholder secret of at least 32 characters in production`,
      );
    }
    return { name, value };
  });

  for (let left = 0; left < values.length; left += 1) {
    for (let right = left + 1; right < values.length; right += 1) {
      if (values[left].value === values[right].value) {
        throw new RangeError(
          `${values[left].name} and ${values[right].name} must use different production secrets`,
        );
      }
    }
  }
}
