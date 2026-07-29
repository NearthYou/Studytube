import { type INestApplication, type LoggerService } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/configure-application';
import {
  rateLimitSubjectDigest,
  reconstructVerificationToken,
} from '../src/auth/auth-token';
import { VerificationEmailOutboxWorker } from '../src/auth/verification-email-outbox.worker';
import { PostgresVerificationEmailOutboxRepository } from '../src/auth/verification-email-outbox.repository';
import type {
  VerificationEmailMessage,
  VerificationEmailSender,
} from '../src/auth/verification-email-sender';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://app:app@localhost:5432/app_dev';
const WEB_ORIGIN =
  process.env.WEB_ORIGIN ?? 'https://app.studytube.example.test';
const VERIFICATION_PEPPER =
  process.env.AUTH_VERIFICATION_PEPPER ??
  'studytube-e2e-verification-pepper-32-bytes';
const RATE_LIMIT_PEPPER =
  process.env.AUTH_RATE_LIMIT_PEPPER ??
  'studytube-e2e-rate-limit-pepper-32-bytes';
const SESSION_COOKIE = 'studytube_session';
const ENROLLMENT_COOKIE = 'studytube_enrollment';
const RUN_ID = randomUUID();

type PendingIdentity = {
  pendingId: string;
  keyVersion: number;
};

type PublicUser = {
  id: number;
  name: string;
  email: string;
  createdAt: string;
};

type RegisteredUser = {
  agent: ReturnType<typeof request.agent>;
  password: string;
  sessionCookie: string;
  user: PublicUser;
};

type ResponseShape = {
  status: number;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
};

describe('cookie authentication with PostgreSQL (e2e)', () => {
  jest.setTimeout(60_000);

  let logger: CapturingLogger;
  const trackedEmails = new Set<string>();
  const trackedRateLimits: Array<{ action: string; digest: Buffer }> = [];
  let app: INestApplication<App>;
  let pool: Pool;

  beforeAll(async () => {
    logger = new CapturingLogger();
    app = await createApplication(logger);
    pool = new Pool({
      connectionString: DATABASE_URL,
      connectionTimeoutMillis: 3000,
    });
  });

  it('accepts email-only signup and commits pending delivery without credentials', async () => {
    const email = testEmail('signup');
    trackedEmails.add(email);

    const response = await request(app.getHttpServer())
      .post('/auth/signup')
      .set('Origin', WEB_ORIGIN)
      .send({ email })
      .expect(202);

    expect(response.body).toEqual({ status: 'accepted' });

    const persisted = await pool.query<{
      pendingCount: number;
      outboxCount: number;
      userCount: number;
      verificationDigestBytes: number;
    }>(
      `
        SELECT count(DISTINCT p.id)::integer AS "pendingCount",
               count(DISTINCT o.id)::integer AS "outboxCount",
               count(DISTINCT u.id)::integer AS "userCount",
               max(octet_length(p.verification_digest))::integer
                 AS "verificationDigestBytes"
        FROM pending_registrations p
        LEFT JOIN verification_email_outbox o
          ON o.pending_registration_id = p.id
        LEFT JOIN users u ON u.email_canonical = p.email_canonical
        WHERE p.email_canonical = $1
      `,
      [email],
    );

    expect(persisted.rows[0]).toEqual({
      pendingCount: 1,
      outboxCount: 1,
      userCount: 0,
      verificationDigestBytes: 32,
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /password|verification|enrollment|session|token|digest/iu,
    );
  });

  it('claims, delivers, and acknowledges the durable verification email', async () => {
    const email = testEmail('delivery');
    const delivered: VerificationEmailMessage[] = [];
    const sender: VerificationEmailSender = {
      send: jest.fn((message: VerificationEmailMessage) => {
        delivered.push(message);
        return Promise.resolve({ providerMessageId: 'e2e-provider-message' });
      }),
    };
    trackedEmails.add(email);

    await signup(request.agent(app.getHttpServer()), email);
    const pending = await latestPending(pool, email);
    const verificationToken = reconstructVerificationToken(
      pending.pendingId,
      databaseKeyVersion(pending.keyVersion),
      VERIFICATION_PEPPER,
    );
    await pool.query(
      `
          UPDATE verification_email_outbox
          SET available_at = '2000-01-01T00:00:00.000Z'
          WHERE pending_registration_id = $1
        `,
      [pending.pendingId],
    );
    const worker = new VerificationEmailOutboxWorker(
      new PostgresVerificationEmailOutboxRepository(pool),
      sender,
      {
        verificationPepper: VERIFICATION_PEPPER,
        clock: () => new Date(),
        random: () => 0.5,
        pollIntervalMs: 1_000,
        leaseMs: 30_000,
        sendTimeoutMs: 10_000,
        maxAttempts: 5,
        retryBaseMs: 1_000,
        retryMaxMs: 60_000,
      },
    );

    await expect(worker.deliverOnce()).resolves.toBe('sent');

    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.verificationUrl).toContain(
      `/signup/verify#verification=${verificationToken}`,
    );
    expect(delivered[0]?.verificationUrl).not.toContain('?verification=');

    const persisted = await pool.query<{
      attempts: number;
      lastErrorCode: string | null;
      providerMessageId: string;
      sent: boolean;
      storedFields: string;
    }>(
      `
          SELECT o.attempts,
                 o.last_error_code AS "lastErrorCode",
                 o.provider_message_id AS "providerMessageId",
                 o.sent_at IS NOT NULL AS sent,
                 concat_ws('|',
                   o.recipient,
                   o.idempotency_key,
                   o.sender,
                   o.public_origin,
                   o.template_version,
                   o.locale,
                   o.subject,
                   encode(o.payload_hash, 'hex')
                 ) AS "storedFields"
          FROM verification_email_outbox o
          WHERE o.pending_registration_id = $1
        `,
      [pending.pendingId],
    );
    expect(persisted.rows).toEqual([
      {
        attempts: 1,
        lastErrorCode: null,
        providerMessageId: 'e2e-provider-message',
        sent: true,
        storedFields: expect.any(String) as unknown,
      },
    ]);
    expect(JSON.stringify(persisted.rows)).not.toContain(verificationToken);
  });

  it('coalesces concurrent resend and preserves the live single-use token', async () => {
    const email = testEmail('resend-race');
    const browser = request.agent(app.getHttpServer());
    const barrierClient = await pool.connect();
    let transactionOpen = false;
    let resendRequests: Array<Promise<ResponseShape>> = [];
    trackedEmails.add(email);

    try {
      await signup(browser, email);
      const pending = await latestPending(pool, email);
      const verificationToken = reconstructVerificationToken(
        pending.pendingId,
        databaseKeyVersion(pending.keyVersion),
        VERIFICATION_PEPPER,
      );
      const original = await pool.query<{ payloadHash: Buffer }>(
        `
          UPDATE verification_email_outbox
          SET attempts = 1,
              provider_message_id = 'e2e-delivered-message',
              sent_at = statement_timestamp()
          WHERE pending_registration_id = $1
          RETURNING payload_hash AS "payloadHash"
        `,
        [pending.pendingId],
      );

      await barrierClient.query('BEGIN');
      transactionOpen = true;
      await barrierClient.query(
        `
          SELECT pg_advisory_xact_lock(
            hashtextextended('auth-registration:' || $1, 0)
          )
        `,
        [email],
      );
      resendRequests = [0, 1].map(() =>
        request(app.getHttpServer())
          .post('/auth/email-verifications/resend')
          .set('Origin', WEB_ORIGIN)
          .send({ email })
          .then((response) => response),
      );

      await waitForBlockedStatements(
        pool,
        '%pg_advisory_xact_lock%auth-registration:%',
        2,
      );
      await barrierClient.query('COMMIT');
      transactionOpen = false;

      const responses = await Promise.all(resendRequests);
      expect(responses.map(({ status }) => status)).toEqual([202, 202]);
      const state = await pool.query<{
        pendingCount: number;
        outboxCount: number;
        liveOutboxCount: number;
        payloadHashesMatch: boolean;
      }>(
        `
          SELECT count(DISTINCT pending.id)::integer AS "pendingCount",
                 count(outbox.id)::integer AS "outboxCount",
                 count(outbox.id) FILTER (
                   WHERE outbox.sent_at IS NULL AND outbox.failed_at IS NULL
                 )::integer AS "liveOutboxCount",
                 bool_and(outbox.payload_hash = $2::bytea)
                   AS "payloadHashesMatch"
          FROM pending_registrations AS pending
          JOIN verification_email_outbox AS outbox
            ON outbox.pending_registration_id = pending.id
          WHERE pending.email_canonical = $1
        `,
        [email, original.rows[0]?.payloadHash],
      );
      expect(state.rows[0]).toEqual({
        pendingCount: 1,
        outboxCount: 2,
        liveOutboxCount: 1,
        payloadHashesMatch: true,
      });

      await browser
        .post('/auth/email-verifications/consume')
        .set('Origin', WEB_ORIGIN)
        .send({ verificationToken })
        .expect(204);

      const replay = await request(app.getHttpServer())
        .post('/auth/email-verifications/consume')
        .set('Origin', WEB_ORIGIN)
        .send({ verificationToken })
        .expect(401);
      expect(setCookieLines(replay)).toEqual([]);
    } finally {
      if (transactionOpen) {
        await barrierClient.query('ROLLBACK');
      }
      await Promise.allSettled(resendRequests);
      barrierClient.release();
    }
  });

  it('requeues the preserved token after final-attempt lease expiry', async () => {
    const email = testEmail('resend-final');
    const browser = request.agent(app.getHttpServer());
    trackedEmails.add(email);

    await signup(browser, email);
    const pending = await latestPending(pool, email);
    const verificationToken = reconstructVerificationToken(
      pending.pendingId,
      databaseKeyVersion(pending.keyVersion),
      VERIFICATION_PEPPER,
    );
    const exhausted = await pool.query<{ id: string; payloadHash: Buffer }>(
      `
        UPDATE verification_email_outbox
        SET attempts = 5,
            lease_token = $2,
            lease_expires_at = statement_timestamp() - interval '1 second'
        WHERE pending_registration_id = $1
        RETURNING id, payload_hash AS "payloadHash"
      `,
      [pending.pendingId, randomUUID()],
    );
    expect(exhausted.rows).toHaveLength(1);

    await browser
      .post('/auth/email-verifications/resend')
      .set('Origin', WEB_ORIGIN)
      .send({ email })
      .expect(202, { status: 'accepted' });

    const state = await pool.query<{
      outboxCount: number;
      terminalizedCount: number;
      liveOutboxCount: number;
      payloadHashesMatch: boolean;
    }>(
      `
        SELECT count(*)::integer AS "outboxCount",
               count(*) FILTER (
                 WHERE failed_at IS NOT NULL
                   AND last_error_code = 'delivery_attempts_exhausted'
               )::integer AS "terminalizedCount",
               count(*) FILTER (
                 WHERE sent_at IS NULL AND failed_at IS NULL
               )::integer AS "liveOutboxCount",
               bool_and(payload_hash = $2::bytea) AS "payloadHashesMatch"
        FROM verification_email_outbox
        WHERE pending_registration_id = $1
      `,
      [pending.pendingId, exhausted.rows[0]?.payloadHash],
    );
    expect(state.rows).toEqual([
      {
        outboxCount: 2,
        terminalizedCount: 1,
        liveOutboxCount: 1,
        payloadHashesMatch: true,
      },
    ]);

    await browser
      .post('/auth/email-verifications/consume')
      .set('Origin', WEB_ORIGIN)
      .send({ verificationToken })
      .expect(204);
  });

  it('issues a fresh full-window intent near expiry without revoking the old token', async () => {
    const email = testEmail('resend-near-expiry');
    const browser = request.agent(app.getHttpServer());
    trackedEmails.add(email);

    await signup(browser, email);
    const oldPending = await latestPending(pool, email);
    const oldToken = reconstructVerificationToken(
      oldPending.pendingId,
      databaseKeyVersion(oldPending.keyVersion),
      VERIFICATION_PEPPER,
    );
    await pool.query(
      `
        UPDATE pending_registrations
        SET verification_expires_at = statement_timestamp() + interval '1 minute'
        WHERE id = $1
      `,
      [oldPending.pendingId],
    );

    await browser
      .post('/auth/email-verifications/resend')
      .set('Origin', WEB_ORIGIN)
      .send({ email })
      .expect(202, { status: 'accepted' });

    const pending = await pool.query<{ count: number }>(
      `
        SELECT count(*)::integer AS count
        FROM pending_registrations
        WHERE email_canonical = $1
      `,
      [email],
    );
    expect(pending.rows).toEqual([{ count: 2 }]);
    await browser
      .post('/auth/email-verifications/consume')
      .set('Origin', WEB_ORIGIN)
      .send({ verificationToken: oldToken })
      .expect(204);
  });

  it('does not create another token while a verified enrollment remains live', async () => {
    const email = testEmail('resend-verified');
    const browser = request.agent(app.getHttpServer());
    trackedEmails.add(email);

    await signup(browser, email);
    const verified = await consumeVerification(browser, email);
    await pool.query(
      `
        UPDATE pending_registrations
        SET verification_expires_at = verified_at
        WHERE id = $1
      `,
      [verified.pendingId],
    );

    await browser
      .post('/auth/email-verifications/resend')
      .set('Origin', WEB_ORIGIN)
      .send({ email })
      .expect(202, { status: 'accepted' });

    const state = await pool.query<{
      pendingCount: number;
      outboxCount: number;
    }>(
      `
        SELECT count(DISTINCT pending.id)::integer AS "pendingCount",
               count(outbox.id)::integer AS "outboxCount"
        FROM pending_registrations AS pending
        JOIN verification_email_outbox AS outbox
          ON outbox.pending_registration_id = pending.id
        WHERE pending.email_canonical = $1
      `,
      [email],
    );
    expect(state.rows).toEqual([{ pendingCount: 1, outboxCount: 1 }]);
  });

  it('consumes verification and completes a digest-only Argon2id registration', async () => {
    const email = testEmail('registration');
    const password = 'portfolio-proof-password';
    const browser = request.agent(app.getHttpServer());
    trackedEmails.add(email);

    await signup(browser, email);
    const verification = await consumeVerification(browser, email);

    await browser
      .get('/auth/registrations/current')
      .expect(200)
      .expect({ status: 'ready' });

    const completion = await browser
      .post('/auth/registrations/complete')
      .set('Origin', WEB_ORIGIN)
      .send({ name: 'Ada Proof', password })
      .expect(201);
    const body = completion.body as { user: PublicUser };

    expect(body).toEqual({
      user: {
        id: expect.any(Number) as unknown,
        name: 'Ada Proof',
        email,
        createdAt: expect.any(String) as unknown,
      },
    });
    expectSensitiveKeysAbsent(completion.body);
    expect(setCookieLines(completion)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^studytube_session=[A-Za-z0-9_-]{43};/u),
        expect.stringMatching(/^studytube_enrollment=;/u),
      ]),
    );

    await browser.get('/me').expect(200).expect(body.user);

    const persisted = await pool.query<{
      passwordHash: string;
      passwordAlgorithm: string;
      passwordParameters: Record<string, unknown>;
      passwordVersion: number;
      sessionDigestBytes: number;
      verificationDigestBytes: number;
      enrollmentDigestBytes: number;
    }>(
      `
        SELECT u.password_hash AS "passwordHash",
               u.password_algorithm AS "passwordAlgorithm",
               u.password_parameters AS "passwordParameters",
               u.password_version AS "passwordVersion",
               octet_length(s.token_digest)::integer AS "sessionDigestBytes",
               octet_length(p.verification_digest)::integer
                 AS "verificationDigestBytes",
               octet_length(p.enrollment_digest)::integer
                 AS "enrollmentDigestBytes"
        FROM users u
        JOIN sessions s ON s.user_id = u.id
        JOIN pending_registrations p
          ON p.email_canonical = u.email_canonical
        WHERE u.email_canonical = $1
          AND p.id = $2
      `,
      [email, verification.pendingId],
    );

    expect(persisted.rows).toEqual([
      {
        passwordHash: expect.stringMatching(/^\$argon2id\$/u) as unknown,
        passwordAlgorithm: 'argon2id',
        passwordParameters: {
          memoryKiB: 65_536,
          timeCost: 3,
          parallelism: 1,
        },
        passwordVersion: 1,
        sessionDigestBytes: 32,
        verificationDigestBytes: 32,
        enrollmentDigestBytes: 32,
      },
    ]);
    expect(JSON.stringify(persisted.rows)).not.toContain(password);
  });

  it('linearizes competing completion requests to one user and first session', async () => {
    const email = testEmail('completion-race');
    const password = 'completion-race-password';
    const enrollmentBrowser = request.agent(app.getHttpServer());
    trackedEmails.add(email);

    await signup(enrollmentBrowser, email);
    const verification = await consumeVerification(enrollmentBrowser, email);
    const barrierClient = await pool.connect();
    let transactionOpen = false;
    let completionRequests: Array<Promise<ResponseShape>> = [];

    try {
      await barrierClient.query('BEGIN');
      transactionOpen = true;
      await barrierClient.query(
        'SELECT id FROM pending_registrations WHERE id = $1 FOR UPDATE',
        [verification.pendingId],
      );

      completionRequests = ['First Winner', 'Second Winner'].map((name) =>
        request(app.getHttpServer())
          .post('/auth/registrations/complete')
          .set('Origin', WEB_ORIGIN)
          .set('Cookie', verification.enrollmentCookie)
          .send({ name, password })
          .then((response) => response),
      );

      await waitForBlockedStatements(
        pool,
        '%FROM pending_registrations%FOR UPDATE%',
        2,
      );
      await barrierClient.query('COMMIT');
      transactionOpen = false;

      const responses = await Promise.all(completionRequests);
      expect(responses.map(({ status }) => status).sort()).toEqual([201, 401]);
    } finally {
      if (transactionOpen) {
        await barrierClient.query('ROLLBACK');
      }
      await Promise.allSettled(completionRequests);
      barrierClient.release();
    }

    const state = await pool.query<{
      users: number;
      sessions: number;
      completed: number;
    }>(
      `
        SELECT count(DISTINCT u.id)::integer AS users,
               count(DISTINCT s.id)::integer AS sessions,
               count(DISTINCT p.id) FILTER (
                 WHERE p.completed_at IS NOT NULL
               )::integer AS completed
        FROM pending_registrations p
        LEFT JOIN users u ON u.email_canonical = p.email_canonical
        LEFT JOIN sessions s ON s.user_id = u.id
        WHERE p.email_canonical = $1
      `,
      [email],
    );
    expect(state.rows[0]).toEqual({ users: 1, sessions: 1, completed: 1 });
  });

  it('shares one atomic rate window across instances and survives rebuilding', async () => {
    const email = testEmail('multi-instance-rate');
    const digest = rateLimitSubjectDigest(
      'signup_identity',
      email,
      RATE_LIMIT_PEPPER,
    );
    trackedEmails.add(email);
    trackedRateLimits.push({ action: 'signup_identity', digest });

    const first = await createApplication(new CapturingLogger());
    const second = await createApplication(new CapturingLogger());
    let rebuilt: INestApplication<App> | undefined;
    let firstClosed = false;
    let secondClosed = false;

    try {
      await Promise.all([
        signup(request.agent(first.getHttpServer()), email),
        signup(request.agent(second.getHttpServer()), email),
      ]);

      await expectRateAttempts(pool, 'signup_identity', digest, 2);
      await first.close();
      firstClosed = true;
      await second.close();
      secondClosed = true;

      rebuilt = await createApplication(new CapturingLogger());
      await signup(request.agent(rebuilt.getHttpServer()), email);
      await expectRateAttempts(pool, 'signup_identity', digest, 3);

      const pending = await pool.query<{ count: number }>(
        `
          SELECT count(*)::integer AS count
          FROM pending_registrations
          WHERE email_canonical = $1
        `,
        [email],
      );
      expect(pending.rows[0]?.count).toBeGreaterThanOrEqual(1);
    } finally {
      if (rebuilt) {
        await rebuilt.close();
      }
      if (!firstClosed) {
        await first.close();
      }
      if (!secondClosed) {
        await second.close();
      }
    }
  });

  it('rejects idle, absolute-expired, and logged-out sessions', async () => {
    const email = testEmail('session-lifecycle');
    trackedEmails.add(email);
    const registered = await registerUser(email, 'Session Proof');

    await expireSession(registered.sessionCookie, 'idle');
    await request(app.getHttpServer())
      .get('/me')
      .set('Cookie', registered.sessionCookie)
      .expect(401);

    const absoluteLogin = await login(email, registered.password);
    await expireSession(absoluteLogin.sessionCookie, 'absolute');
    await request(app.getHttpServer())
      .get('/me')
      .set('Cookie', absoluteLogin.sessionCookie)
      .expect(401);

    const logoutLogin = await login(email, registered.password);
    await logoutLogin.agent
      .post('/auth/logout')
      .set('Origin', WEB_ORIGIN)
      .expect(204);
    await request(app.getHttpServer())
      .get('/me')
      .set('Cookie', logoutLogin.sessionCookie)
      .expect(401);

    const revoked = await pool.query<{
      revokeReason: string | null;
      revoked: boolean;
    }>(
      `
        SELECT revoke_reason AS "revokeReason",
               revoked_at IS NOT NULL AS revoked
        FROM sessions
        WHERE token_digest = $1
      `,
      [cookieDigest(logoutLogin.sessionCookie)],
    );
    expect(revoked.rows).toEqual([{ revokeReason: 'logout', revoked: true }]);
  });

  it('rejects unsafe boundaries without reflecting or logging credentials', async () => {
    const email = testEmail('boundary');
    const passwordCanary = 'password-canary-never-reflect';
    const cookieCanary = randomBytes(32).toString('base64url');
    const verificationCanary = `v1.${randomUUID()}.${randomBytes(32).toString(
      'base64url',
    )}`;
    const logStart = logger.entries.length;
    trackedEmails.add(email);

    const wrongOrigin = await request(app.getHttpServer())
      .post('/auth/email-verifications/consume')
      .set('Origin', 'https://attacker.example.test')
      .send({ verificationToken: verificationCanary });
    const wrongContentType = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', WEB_ORIGIN)
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ email, password: passwordCanary }));
    const extraField = await request(app.getHttpServer())
      .post('/auth/signup')
      .set('Origin', WEB_ORIGIN)
      .send({ email, password: passwordCanary });
    const bearerOnly = await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', `Bearer ${cookieCanary}`);

    expectStableError(wrongOrigin, 403);
    expectStableError(wrongContentType, 415);
    expectStableError(extraField, 400);
    expectStableError(bearerOnly, 401);

    const mutation = await pool.query<{ pendingCount: number }>(
      `
        SELECT count(*)::integer AS "pendingCount"
        FROM pending_registrations
        WHERE email_canonical = $1
      `,
      [email],
    );
    expect(mutation.rows[0]).toEqual({ pendingCount: 0 });

    const observable = JSON.stringify({
      responses: [
        wrongOrigin.body,
        wrongContentType.body,
        extraField.body,
        bearerOnly.body,
      ],
      logs: logger.entries.slice(logStart),
    });
    for (const canary of [passwordCanary, cookieCanary, verificationCanary]) {
      expect(observable).not.toContain(canary);
    }
  });

  afterAll(async () => {
    try {
      if (pool) {
        const emails = [...trackedEmails];
        if (emails.length > 0) {
          await pool.query(
            'DELETE FROM users WHERE email_canonical = ANY($1::text[])',
            [emails],
          );
          await pool.query(
            'DELETE FROM pending_registrations WHERE email_canonical = ANY($1::text[])',
            [emails],
          );
        }
        for (const rate of trackedRateLimits) {
          await pool.query(
            'DELETE FROM auth_rate_limits WHERE action = $1 AND subject_digest = $2',
            [rate.action, rate.digest],
          );
        }
        await pool.end();
      }
    } finally {
      if (app) {
        await app.close();
      }
    }
  });

  async function signup(
    browser: ReturnType<typeof request.agent>,
    email: string,
  ) {
    return browser
      .post('/auth/signup')
      .set('Origin', WEB_ORIGIN)
      .send({ email })
      .expect(202)
      .expect({ status: 'accepted' });
  }

  async function consumeVerification(
    browser: ReturnType<typeof request.agent>,
    email: string,
  ): Promise<PendingIdentity & { enrollmentCookie: string }> {
    const pending = await latestPending(pool, email);
    const verificationToken = reconstructVerificationToken(
      pending.pendingId,
      databaseKeyVersion(pending.keyVersion),
      VERIFICATION_PEPPER,
    );
    const response = await browser
      .post('/auth/email-verifications/consume')
      .set('Origin', WEB_ORIGIN)
      .send({ verificationToken })
      .expect(204);
    expect(response.body).toEqual({});

    const enrollmentCookie = cookiePair(response, ENROLLMENT_COOKIE);
    expect(enrollmentCookie).toMatch(
      /^studytube_enrollment=[A-Za-z0-9_-]{43}$/u,
    );
    expect(setCookieLines(response)).toHaveLength(1);
    return { ...pending, enrollmentCookie };
  }

  async function registerUser(
    email: string,
    name: string,
  ): Promise<RegisteredUser> {
    const password = 'registered-user-password';
    const browser = request.agent(app.getHttpServer());
    await signup(browser, email);
    await consumeVerification(browser, email);
    const completion = await browser
      .post('/auth/registrations/complete')
      .set('Origin', WEB_ORIGIN)
      .send({ name, password })
      .expect(201);
    return {
      agent: browser,
      password,
      sessionCookie: cookiePair(completion, SESSION_COOKIE),
      user: (completion.body as { user: PublicUser }).user,
    };
  }

  async function login(email: string, password: string) {
    const browser = request.agent(app.getHttpServer());
    const response = await browser
      .post('/auth/login')
      .set('Origin', WEB_ORIGIN)
      .send({ email, password })
      .expect(200);
    return {
      agent: browser,
      sessionCookie: cookiePair(response, SESSION_COOKIE),
      user: (response.body as { user: PublicUser }).user,
    };
  }

  async function expireSession(cookie: string, expiry: 'idle' | 'absolute') {
    const digest = cookieDigest(cookie);
    if (expiry === 'idle') {
      await pool.query(
        `
          UPDATE sessions
          SET created_at = statement_timestamp() - interval '2 days',
              last_seen_at = statement_timestamp() - interval '25 hours',
              idle_expires_at = statement_timestamp() - interval '1 second'
          WHERE token_digest = $1
        `,
        [digest],
      );
      return;
    }
    await pool.query(
      `
        UPDATE sessions
        SET created_at = statement_timestamp() - interval '8 days',
            last_seen_at = statement_timestamp() - interval '2 days',
            idle_expires_at = statement_timestamp() - interval '1 second',
            absolute_expires_at = statement_timestamp() - interval '1 second'
        WHERE token_digest = $1
      `,
      [digest],
    );
  }
});

async function createApplication(
  logger: LoggerService,
): Promise<INestApplication<App>> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const application = moduleFixture.createNestApplication();
  application.useLogger(logger);
  configureApplication(application);
  await application.init();
  return application;
}

async function latestPending(pool: Pool, email: string) {
  const result = await pool.query<PendingIdentity>(
    `
      SELECT id AS "pendingId", key_version AS "keyVersion"
      FROM pending_registrations
      WHERE email_canonical = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `,
    [email],
  );
  const pending = result.rows[0];
  if (!pending) {
    throw new Error(`No pending registration exists for ${email}`);
  }
  return pending;
}

async function waitForBlockedStatements(
  pool: Pool,
  queryPattern: string,
  expectedCount: number,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  const pollIntervalMs = 25;

  while (Date.now() < deadline) {
    const result = await pool.query<{ blockedCount: number }>(
      `
        SELECT count(*)::integer AS "blockedCount"
        FROM pg_stat_activity
        WHERE pid <> pg_backend_pid()
          AND datname = current_database()
          AND state = 'active'
          AND wait_event_type = 'Lock'
          AND query LIKE $1
      `,
      [queryPattern],
    );
    if ((result.rows[0]?.blockedCount ?? 0) >= expectedCount) {
      return;
    }

    await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error(
    `Database barrier did not observe ${expectedCount} blocked statements`,
  );
}

async function expectRateAttempts(
  pool: Pool,
  action: string,
  digest: Buffer,
  attempts: number,
) {
  const result = await pool.query<{ attempts: number }>(
    `
      SELECT attempts
      FROM auth_rate_limits
      WHERE action = $1
        AND subject_digest = $2
        AND expires_at > statement_timestamp()
    `,
    [action, digest],
  );
  expect(result.rows).toEqual([{ attempts }]);
}

function expectSensitiveKeysAbsent(body: unknown): void {
  expect(JSON.stringify(body)).not.toMatch(
    /passwordHash|passwordAlgorithm|passwordParameters|passwordVersion|sessionToken|enrollmentToken|verificationToken|tokenDigest/iu,
  );
}

function expectStableError(response: ResponseShape, status: number): void {
  expect(response.status).toBe(status);
  expect(Object.keys(response.body as Record<string, unknown>).sort()).toEqual([
    'code',
    'message',
    'requestId',
  ]);
  expect(response.body).toEqual({
    code: expect.any(String) as unknown,
    message: expect.any(String) as unknown,
    requestId: expect.any(String) as unknown,
  });
}

function setCookieLines(response: ResponseShape): string[] {
  const value = response.headers['set-cookie'];
  if (Array.isArray(value)) {
    return value;
  }
  return value ? [value] : [];
}

function cookiePair(response: ResponseShape, name: string): string {
  const line = setCookieLines(response).find((candidate) =>
    candidate.startsWith(`${name}=`),
  );
  if (!line) {
    throw new Error(`Response did not set ${name}`);
  }
  return line.split(';', 1)[0];
}

function cookieDigest(cookiePairValue: string): Buffer {
  const separator = cookiePairValue.indexOf('=');
  if (separator < 0) {
    throw new Error('Cookie pair is malformed');
  }
  return createHash('sha256')
    .update(cookiePairValue.slice(separator + 1), 'utf8')
    .digest();
}

function databaseKeyVersion(value: number): 'v1' {
  if (value !== 1) {
    throw new Error(`Unsupported verification key version ${value}`);
  }
  return 'v1';
}

function testEmail(label: string): string {
  return `auth-${label}-${RUN_ID}@example.test`;
}

class CapturingLogger implements LoggerService {
  readonly entries: string[] = [];

  log(message: unknown, ...optional: unknown[]): void {
    this.capture(message, ...optional);
  }

  error(message: unknown, ...optional: unknown[]): void {
    this.capture(message, ...optional);
  }

  warn(message: unknown, ...optional: unknown[]): void {
    this.capture(message, ...optional);
  }

  debug(message: unknown, ...optional: unknown[]): void {
    this.capture(message, ...optional);
  }

  verbose(message: unknown, ...optional: unknown[]): void {
    this.capture(message, ...optional);
  }

  fatal(message: unknown, ...optional: unknown[]): void {
    this.capture(message, ...optional);
  }

  private capture(message: unknown, ...optional: unknown[]): void {
    this.entries.push(
      [message, ...optional]
        .map((value) => {
          if (typeof value === 'string') {
            return value;
          }
          try {
            return JSON.stringify(value);
          } catch {
            return String(value);
          }
        })
        .join(' '),
    );
  }
}
