import { Client } from 'pg';
import { loadRuntimeEnv } from '../src/config/runtime-config';
import {
  deleteSmokeUser,
  ensureSmokeUser,
} from '../src/database/ensure-smoke-user';
import { verifyPassword } from '../src/users/password';

interface UserRow {
  email: string;
  id: string;
  nickname: string;
  password_hash: string;
}

describe('smoke user provisioning (e2e)', () => {
  let baseDatabaseUrl: string;
  let databaseUrl: string;
  let schemaName: string;

  beforeAll(async () => {
    loadRuntimeEnv();
    baseDatabaseUrl = getDatabaseUrl();
    schemaName = `e2e_smoke_user_${Date.now()}`;
    await createSchema(baseDatabaseUrl, schemaName);
    databaseUrl = withSearchPath(baseDatabaseUrl, schemaName);
    await createUsersTable(databaseUrl);
  });

  afterAll(async () => {
    await dropSchema(baseDatabaseUrl, schemaName);
  });

  it('creates and rotates a normal smoke account without logging secrets', async () => {
    const logs: string[] = [];

    await ensureSmokeUser({
      databaseUrl,
      email: 'Smoke.User@Example.Test',
      log: (message) => logs.push(message),
      nickname: 'SmokeUser',
      nodeEnv: 'test',
      password: 'Password1!',
    });

    let user = await findUser(databaseUrl, 'smoke.user@example.test');

    expect(user?.nickname).toBe('SmokeUser');
    await expect(
      verifyPassword('Password1!', user?.password_hash ?? ''),
    ).resolves.toBe(true);
    expect(logs.join('\n')).toBe('Smoke account ready.');
    expect(logs.join('\n')).not.toContain('Password1!');

    await ensureSmokeUser({
      databaseUrl,
      email: 'smoke.user@example.test',
      log: (message) => logs.push(message),
      nickname: 'SmokeUser',
      nodeEnv: 'test',
      password: 'Password2!',
    });

    user = await findUser(databaseUrl, 'smoke.user@example.test');

    await expect(
      verifyPassword('Password1!', user?.password_hash ?? ''),
    ).resolves.toBe(false);
    await expect(
      verifyPassword('Password2!', user?.password_hash ?? ''),
    ).resolves.toBe(true);
  });

  it('requires explicit production opt-in before connecting to the database', async () => {
    await expect(
      ensureSmokeUser({
        databaseUrl: 'postgres://invalid-host.invalid/tailtalk',
        email: 'smoke@example.test',
        enabled: false,
        log: () => undefined,
        nickname: 'SmokeUser',
        nodeEnv: 'production',
        password: 'Password1!',
      }),
    ).rejects.toThrow('SMOKE_ACCOUNT_ENABLED=true is required');
  });

  it('deletes a clean smoke account without logging secrets', async () => {
    const logs: string[] = [];

    await ensureSmokeUser({
      databaseUrl,
      email: 'delete.smoke@example.test',
      log: (message) => logs.push(message),
      nickname: 'DeleteSmokeUser',
      nodeEnv: 'test',
      password: 'Password1!',
    });

    await deleteSmokeUser({
      databaseUrl,
      email: 'delete.smoke@example.test',
      log: (message) => logs.push(message),
      nickname: 'DeleteSmokeUser',
      nodeEnv: 'test',
    });

    await expect(findUser(databaseUrl, 'delete.smoke@example.test')).resolves.toBeNull();
    expect(logs.join('\n')).toContain('Smoke account deleted.');
    expect(logs.join('\n')).not.toContain('Password1!');
  });

  it('refuses to delete a smoke account with remaining authored data', async () => {
    await ensureSmokeUser({
      databaseUrl,
      email: 'dirty.smoke@example.test',
      log: () => undefined,
      nickname: 'DirtySmokeUser',
      nodeEnv: 'test',
      password: 'Password1!',
    });
    const user = await findUser(databaseUrl, 'dirty.smoke@example.test');

    await insertPost(databaseUrl, user?.id ?? '');

    await expect(
      deleteSmokeUser({
        databaseUrl,
        email: 'dirty.smoke@example.test',
        log: () => undefined,
        nickname: 'DirtySmokeUser',
        nodeEnv: 'test',
      }),
    ).rejects.toThrow('Smoke account has remaining data: posts=1.');
    await expect(findUser(databaseUrl, 'dirty.smoke@example.test')).resolves.not.toBeNull();
  });
});

async function findUser(databaseUrl: string, email: string) {
  const client = new Client({ connectionString: databaseUrl });

  await client.connect();

  try {
    const result = await client.query<UserRow>(
      `SELECT user_id::text AS id, email, nickname, password_hash
       FROM users
       WHERE email = $1`,
      [email],
    );

    return result.rows[0] ?? null;
  } finally {
    await client.end();
  }
}

async function insertPost(databaseUrl: string, userId: string) {
  const client = new Client({ connectionString: databaseUrl });

  await client.connect();

  try {
    await client.query(
      `INSERT INTO posts (user_id, title, content)
       VALUES ($1, 'dirty smoke post', 'delete guard fixture')`,
      [userId],
    );
  } finally {
    await client.end();
  }
}

function getDatabaseUrl() {
  const databaseUrl =
    process.env.E2E_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgres://tailtalk:tailtalk@localhost:5432/tailtalk';
  const parsedUrl = new URL(databaseUrl);

  if (!['localhost', '127.0.0.1', '::1'].includes(parsedUrl.hostname)) {
    throw new Error(
      'Smoke user e2e tests require a local PostgreSQL database URL.',
    );
  }

  return databaseUrl;
}

async function createSchema(databaseUrl: string, schemaName: string) {
  const client = new Client({ connectionString: databaseUrl });

  await client.connect();

  try {
    await client.query(`CREATE SCHEMA ${schemaName}`);
  } finally {
    await client.end();
  }
}

async function createUsersTable(databaseUrl: string) {
  const client = new Client({ connectionString: databaseUrl });

  await client.connect();

  try {
    await client.query(`
      CREATE TABLE users (
        user_id bigserial PRIMARY KEY,
        email varchar(255) NOT NULL UNIQUE,
        password_hash varchar(255) NOT NULL,
        nickname varchar(50) NOT NULL UNIQUE,
        created_at timestamp NOT NULL DEFAULT now(),
        profile_image_url text
      )
    `);
    await client.query(`
      CREATE TABLE posts (
        post_id bigserial PRIMARY KEY,
        user_id bigint NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        title varchar(255) NOT NULL,
        content text NOT NULL,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
  } finally {
    await client.end();
  }
}

async function dropSchema(databaseUrl: string, schemaName: string) {
  const client = new Client({ connectionString: databaseUrl });

  await client.connect();

  try {
    await client.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  } finally {
    await client.end();
  }
}

function withSearchPath(databaseUrl: string, schemaName: string) {
  const url = new URL(databaseUrl);

  url.searchParams.set('options', `-c search_path=${schemaName}`);

  return url.toString();
}
