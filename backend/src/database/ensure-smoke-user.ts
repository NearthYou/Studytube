import { Client } from 'pg';
import { loadRuntimeEnv } from '../config/runtime-config';
import { hashPassword } from '../users/password';

interface ExistingUserRow {
  email: string;
  id: string;
  nickname: string;
}

export interface EnsureSmokeUserOptions {
  databaseUrl?: string;
  email?: string;
  enabled?: boolean;
  log?: (message: string) => void;
  nickname?: string;
  nodeEnv?: string;
  password?: string;
  resetPassword?: boolean;
}

export async function ensureSmokeUser(options: EnsureSmokeUserOptions = {}) {
  const config = normalizeOptions(options);
  validateProvisionInput(config);

  const client = new Client({ connectionString: config.databaseUrl });

  await client.connect();

  try {
    await client.query('BEGIN');
    await assertUsersTableExists(client);

    const existingByEmail = await findUserByEmail(client, config.email);
    const existingByNickname = await findUserByNickname(
      client,
      config.nickname,
    );

    if (existingByNickname && existingByNickname.email !== config.email) {
      throw new Error(
        'SMOKE_ACCOUNT_NICKNAME is already used by another account.',
      );
    }

    if (existingByEmail) {
      if (existingByEmail.nickname !== config.nickname) {
        throw new Error(
          'SMOKE_ACCOUNT_EMAIL already exists with a different nickname.',
        );
      }

      if (config.resetPassword) {
        await client.query(
          `UPDATE users
           SET password_hash = $1
           WHERE user_id = $2`,
          [await hashPassword(config.password), existingByEmail.id],
        );
      }
    } else {
      await client.query(
        `INSERT INTO users (email, password_hash, nickname, profile_image_url)
         VALUES ($1, $2, $3, NULL)`,
        [config.email, await hashPassword(config.password), config.nickname],
      );
    }

    await client.query('COMMIT');
    config.log('Smoke account ready.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

export async function deleteSmokeUser(options: EnsureSmokeUserOptions = {}) {
  const config = normalizeOptions(options);
  validateDeleteInput(config);

  const client = new Client({ connectionString: config.databaseUrl });

  await client.connect();

  try {
    await client.query('BEGIN');
    await assertUsersTableExists(client);

    const existingByEmail = await findUserByEmail(client, config.email);

    if (!existingByEmail) {
      await client.query('COMMIT');
      config.log('Smoke account absent.');
      return;
    }

    if (existingByEmail.nickname !== config.nickname) {
      throw new Error(
        'SMOKE_ACCOUNT_EMAIL already exists with a different nickname.',
      );
    }

    const remainingData = await findRemainingSmokeAccountData(
      client,
      existingByEmail.id,
    );

    if (remainingData.length) {
      throw new Error(
        `Smoke account has remaining data: ${remainingData.join(', ')}.`,
      );
    }

    await client.query(`DELETE FROM users WHERE user_id = $1`, [
      existingByEmail.id,
    ]);
    await client.query('COMMIT');
    config.log('Smoke account deleted.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

function normalizeOptions(options: EnsureSmokeUserOptions) {
  return {
    databaseUrl: options.databaseUrl ?? process.env.DATABASE_URL ?? '',
    email: normalizeEmail(
      options.email ??
        process.env.SMOKE_ACCOUNT_EMAIL ??
        process.env.LIVE_SMOKE_EMAIL ??
        '',
    ),
    enabled: options.enabled ?? process.env.SMOKE_ACCOUNT_ENABLED === 'true',
    log:
      options.log ??
      ((message: string) => {
        process.stdout.write(`${message}\n`);
      }),
    nickname: normalizeNickname(
      options.nickname ??
        process.env.SMOKE_ACCOUNT_NICKNAME ??
        process.env.LIVE_SMOKE_NICKNAME ??
        'TailTalkSmoke',
    ),
    nodeEnv: options.nodeEnv ?? process.env.NODE_ENV,
    password:
      options.password ??
      process.env.SMOKE_ACCOUNT_PASSWORD ??
      process.env.LIVE_SMOKE_PASSWORD ??
      '',
    resetPassword:
      options.resetPassword ??
      process.env.SMOKE_ACCOUNT_RESET_PASSWORD !== 'false',
  };
}

function validateBaseInput(config: ReturnType<typeof normalizeOptions>) {
  if (!config.databaseUrl.trim()) {
    throw new Error('DATABASE_URL is required.');
  }

  if (config.nodeEnv === 'production') {
    if (!config.enabled) {
      throw new Error(
        'SMOKE_ACCOUNT_ENABLED=true is required to provision a smoke account in production.',
      );
    }
  }

  if (!config.email) {
    throw new Error('SMOKE_ACCOUNT_EMAIL or LIVE_SMOKE_EMAIL is required.');
  }

  if (!config.nickname) {
    throw new Error('SMOKE_ACCOUNT_NICKNAME must not be empty.');
  }
}

function validateProvisionInput(config: ReturnType<typeof normalizeOptions>) {
  validateBaseInput(config);

  if (!config.password) {
    throw new Error(
      'SMOKE_ACCOUNT_PASSWORD or LIVE_SMOKE_PASSWORD is required.',
    );
  }

  if (config.password.length < 8) {
    throw new Error('Smoke account password must be at least 8 characters.');
  }

  if (!/[!@#$%^&*(),.?":{}|<>_\-\\[\];'/`~+=]/.test(config.password)) {
    throw new Error('Smoke account password must include a special character.');
  }
}

function validateDeleteInput(config: ReturnType<typeof normalizeOptions>) {
  validateBaseInput(config);
}

async function assertUsersTableExists(client: Client) {
  const result = await client.query<{ exists: boolean }>(
    `SELECT to_regclass('users') IS NOT NULL AS exists`,
  );

  if (!result.rows[0]?.exists) {
    throw new Error('users table is missing. Run migrations first.');
  }
}

async function findUserByEmail(client: Client, userEmail: string) {
  const result = await client.query<ExistingUserRow>(
    `SELECT user_id::text AS id, email, nickname
     FROM users
     WHERE email = $1`,
    [userEmail],
  );

  return result.rows[0] ?? null;
}

async function findUserByNickname(client: Client, userNickname: string) {
  const result = await client.query<ExistingUserRow>(
    `SELECT user_id::text AS id, email, nickname
     FROM users
     WHERE nickname = $1`,
    [userNickname],
  );

  return result.rows[0] ?? null;
}

const smokeAccountDataChecks = [
  ['posts', 'user_id'],
  ['comments', 'user_id'],
  ['post_images', 'user_id'],
  ['post_likes', 'user_id'],
  ['comment_likes', 'user_id'],
  ['social_accounts', 'user_id'],
  ['rag_queries', 'user_id'],
  ['rag_answers', 'user_id'],
] as const;

async function findRemainingSmokeAccountData(client: Client, userId: string) {
  const remaining: string[] = [];

  for (const [tableName, columnName] of smokeAccountDataChecks) {
    if (!(await tableExists(client, tableName))) {
      continue;
    }

    const result = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM ${tableName} WHERE ${columnName} = $1`,
      [userId],
    );
    const count = Number(result.rows[0]?.count ?? 0);

    if (count > 0) {
      remaining.push(`${tableName}=${count}`);
    }
  }

  return remaining;
}

async function tableExists(client: Client, tableName: string) {
  const result = await client.query<{ exists: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    [tableName],
  );

  return result.rows[0]?.exists === true;
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function normalizeNickname(value: string) {
  return value.trim().replace(/\s+/g, ' ').slice(0, 50);
}

if (require.main === module) {
  loadRuntimeEnv();
  const action = process.env.SMOKE_ACCOUNT_ACTION?.trim().toLowerCase();
  const command = action === 'delete' ? deleteSmokeUser : ensureSmokeUser;

  command().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Unknown error');
    process.exitCode = 1;
  });
}
