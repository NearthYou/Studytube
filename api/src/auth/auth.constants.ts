export const ARGON2_ALGORITHM = 'argon2id' as const;
export const ARGON2_VERSION = 19;
export const ARGON2_MEMORY_KIB = 65_536;
export const ARGON2_MEMORY_PER_JOB_MIB = 64;
export const ARGON2_TIME_COST = 3;
export const ARGON2_PARALLELISM = 1;
export const ARGON2_TAG_BYTES = 32;
export const ARGON2_SALT_BYTES = 16;

export const AUTH_ARGON2_MEMORY_BUDGET_MIB = 192;
export const AUTH_ARGON2_DEFAULT_CONCURRENCY = 2;
export const AUTH_ARGON2_DEFAULT_QUEUE_SIZE = 16;
export const AUTH_ARGON2_RETRY_AFTER_SECONDS = 1;

export const PASSWORD_MIN_UTF8_BYTES = 8;
export const PASSWORD_MAX_UTF8_BYTES = 128;
export const PASSWORD_HASH_MAX_CHARACTERS = 256;
