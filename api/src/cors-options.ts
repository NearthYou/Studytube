import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

export function createCorsOptions(configuredOrigin?: string): CorsOptions {
  const allowedOrigin = requireConfiguredOrigin(configuredOrigin);

  return {
    credentials: true,
    origin(origin, callback) {
      const normalizedOrigin = normalizeHttpOrigin(origin);
      callback(
        null,
        normalizedOrigin !== undefined && normalizedOrigin === allowedOrigin,
      );
    },
  };
}

export function normalizeHttpOrigin(
  candidate: string | undefined,
): string | undefined {
  if (
    !candidate ||
    candidate.includes(',') ||
    candidate.includes('@') ||
    candidate.includes('\\') ||
    containsHttpOriginControlCharacter(candidate) ||
    !/^https?:\/\/[^/?#]+$/iu.test(candidate)
  ) {
    return undefined;
  }
  try {
    const parsed = new URL(candidate);
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.username ||
      parsed.password
    ) {
      return undefined;
    }
    return parsed.origin;
  } catch {
    return undefined;
  }
}

function containsHttpOriginControlCharacter(candidate: string): boolean {
  for (let index = 0; index < candidate.length; index += 1) {
    const codeUnit = candidate.charCodeAt(index);
    if (codeUnit <= 0x20 || (codeUnit >= 0x7f && codeUnit <= 0x9f)) {
      return true;
    }
  }
  return false;
}

function requireConfiguredOrigin(configuredOrigin?: string): string {
  const normalizedOrigin = normalizeHttpOrigin(configuredOrigin);
  if (!normalizedOrigin) {
    throw new RangeError('Exactly one valid web Origin is required');
  }
  return normalizedOrigin;
}
