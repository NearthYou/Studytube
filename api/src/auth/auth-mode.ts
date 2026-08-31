export type AuthMode = 'legacy' | 'google_only';

export function resolveAuthMode(environment: NodeJS.ProcessEnv): AuthMode {
  const value = environment.AUTH_MODE?.trim();
  if (value === 'legacy' || value === 'google_only') return value;
  if (!value && environment.NODE_ENV !== 'production') return 'legacy';
  throw new RangeError('AUTH_MODE must be legacy or google_only');
}
