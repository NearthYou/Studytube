/* eslint-disable camelcase */

const AUTH_MIGRATION_NAME = 'auth-hardening';

exports.up = (pgm) => {
  pgm.sql(String.raw`
    DO $auth_preflight$
    DECLARE
      invalid_user_ids INTEGER[];
      collision_details TEXT;
      unknown_password_user_ids INTEGER[];
    BEGIN
      SELECT array_agg(id ORDER BY id)
      INTO invalid_user_ids
      FROM users
      WHERE email COLLATE "C" !~ '^[ -~]+$';

      IF invalid_user_ids IS NOT NULL THEN
        RAISE EXCEPTION
          'Auth migration aborted: invalid legacy email user IDs (non-ASCII or control characters): %',
          invalid_user_ids;
      END IF;

      SELECT array_agg(id ORDER BY id)
      INTO invalid_user_ids
      FROM users
      WHERE btrim(email, ' ') = ''
         OR /* invalid_email_grammar */
            length(btrim(email, ' ')) > 254
         OR btrim(email, ' ') COLLATE "C" !~
            '^[A-Za-z0-9!#$%&''*+/=?^_{|}~-]+(\.[A-Za-z0-9!#$%&''*+/=?^_{|}~-]+)*@[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$';

      IF invalid_user_ids IS NOT NULL THEN
        RAISE EXCEPTION
          'Auth migration aborted: invalid legacy email user IDs (after ASCII-space trim and explicit grammar validation): %',
          invalid_user_ids;
      END IF;

      SELECT string_agg(
               format('%s -> user IDs %s', email_canonical, user_ids),
               '; '
               ORDER BY email_canonical
             )
      INTO collision_details
      FROM (
        SELECT lower(btrim(email, ' ') COLLATE "C") AS email_canonical,
               array_agg(id ORDER BY id) AS user_ids
        FROM users
        GROUP BY lower(btrim(email, ' ') COLLATE "C")
        HAVING count(*) > 1
      ) AS canonical_collision_rows; /* canonical_collision */

      IF collision_details IS NOT NULL THEN
        RAISE EXCEPTION
          'Auth migration aborted: canonical email collisions: %',
          collision_details;
      END IF;

      SELECT array_agg(id ORDER BY id)
      INTO unknown_password_user_ids
      FROM users
      WHERE password_hash <> 'disabled:demo-seed-login'
        AND password_hash !~ '^[0-9a-f]{64}$';

      IF unknown_password_user_ids IS NOT NULL THEN
        RAISE EXCEPTION
          'Auth migration aborted: unknown password representation user IDs: %',
          unknown_password_user_ids;
      END IF;
    END
    $auth_preflight$;
  `);

  pgm.sql(String.raw`
    ALTER TABLE users
      ADD COLUMN email_canonical TEXT,
      ADD COLUMN password_algorithm TEXT,
      ADD COLUMN password_parameters JSONB,
      ADD COLUMN password_version INTEGER,
      ADD COLUMN identity_assurance TEXT,
      ADD COLUMN email_verified_at TIMESTAMPTZ;

    UPDATE users
    SET email = btrim(email, ' '),
        email_canonical = lower(btrim(email, ' ') COLLATE "C"),
        password_algorithm = CASE
          WHEN password_hash = 'disabled:demo-seed-login' THEN 'disabled'
          WHEN password_hash ~ '^[0-9a-f]{64}$' THEN 'legacy_sha256'
        END,
        password_parameters = CASE
          WHEN password_hash = 'disabled:demo-seed-login'
            THEN '{"reason":"demo_seed_login"}'::jsonb
          ELSE '{"digest":"sha256","encoding":"lower_hex"}'::jsonb
        END,
        password_version = 1,
        identity_assurance = 'legacy_grandfathered',
        email_verified_at = NULL;

    ALTER TABLE users
      ALTER COLUMN email_canonical SET NOT NULL,
      ALTER COLUMN password_algorithm SET NOT NULL,
      ALTER COLUMN password_parameters SET NOT NULL,
      ALTER COLUMN password_version SET NOT NULL,
      ALTER COLUMN password_version SET DEFAULT 1,
      ALTER COLUMN identity_assurance SET NOT NULL,
      ADD CONSTRAINT users_email_canonical_key UNIQUE (email_canonical),
      ADD CONSTRAINT users_password_version_positive
        CHECK (password_version >= 1),
      ADD CONSTRAINT users_password_parameters_object
        CHECK (jsonb_typeof(password_parameters) = 'object'),
      ADD CONSTRAINT users_password_algorithm_valid
        CHECK (
          (password_algorithm = 'legacy_sha256'
            AND password_hash ~ '^[0-9a-f]{64}$')
          OR (password_algorithm = 'disabled'
            AND password_hash = 'disabled:demo-seed-login')
          OR (password_algorithm = 'argon2id'
            AND password_hash LIKE '$argon2id$%')
        ),
      ADD CONSTRAINT users_identity_assurance_valid
        CHECK (identity_assurance IN ('legacy_grandfathered', 'email_verified')),
      ADD CONSTRAINT users_email_verification_claim_valid
        CHECK (
          (identity_assurance = 'legacy_grandfathered'
            AND email_verified_at IS NULL)
          OR (identity_assurance = 'email_verified'
            AND email_verified_at IS NOT NULL)
        );

    DROP INDEX IF EXISTS users_lower_email_idx;

    DROP TABLE sessions;

    CREATE TABLE sessions (
      id UUID PRIMARY KEY,
      token_digest BYTEA NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      absolute_expires_at TIMESTAMPTZ NOT NULL,
      idle_expires_at TIMESTAMPTZ NOT NULL,
      last_seen_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      revoke_reason TEXT,
      CONSTRAINT sessions_token_digest_key UNIQUE (token_digest),
      CONSTRAINT sessions_token_digest_length
        CHECK (octet_length(token_digest) = 32),
      CONSTRAINT sessions_expiry_order
        CHECK (
          absolute_expires_at > created_at
          AND idle_expires_at > created_at
          AND idle_expires_at <= absolute_expires_at
          AND last_seen_at >= created_at
          AND last_seen_at <= absolute_expires_at
        ),
      CONSTRAINT sessions_revocation_state
        CHECK (
          (revoked_at IS NULL AND revoke_reason IS NULL)
          OR (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)
        )
    );

    CREATE TABLE pending_registrations (
      id UUID PRIMARY KEY,
      email TEXT NOT NULL,
      email_canonical TEXT NOT NULL,
      key_version SMALLINT NOT NULL,
      verification_digest BYTEA NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      verification_expires_at TIMESTAMPTZ NOT NULL,
      verified_at TIMESTAMPTZ,
      enrollment_digest BYTEA,
      enrollment_expires_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      CONSTRAINT pending_registrations_verification_digest_key
        UNIQUE (verification_digest),
      CONSTRAINT pending_registrations_enrollment_digest_key
        UNIQUE (enrollment_digest),
      CONSTRAINT pending_registrations_verification_digest_length
        CHECK (octet_length(verification_digest) = 32),
      CONSTRAINT pending_registrations_enrollment_digest_length
        CHECK (
          enrollment_digest IS NULL
          OR octet_length(enrollment_digest) = 32
        ),
      CONSTRAINT pending_registrations_key_version_positive
        CHECK (key_version >= 1),
      CONSTRAINT pending_registrations_attempts_valid
        CHECK (
          max_attempts > 0
          AND attempt_count >= 0
          AND attempt_count <= max_attempts
        ),
      CONSTRAINT pending_registrations_verification_expiry_order
        CHECK (verification_expires_at > created_at),
      CONSTRAINT pending_registrations_verified_state
        CHECK (
          verified_at IS NULL
          OR (verified_at >= created_at
            AND verified_at <= verification_expires_at)
        ),
      CONSTRAINT pending_registrations_enrollment_state
        CHECK (
          (enrollment_digest IS NULL AND enrollment_expires_at IS NULL)
          OR (enrollment_digest IS NOT NULL
            AND enrollment_expires_at IS NOT NULL
            AND verified_at IS NOT NULL
            AND enrollment_expires_at > verified_at)
        ),
      CONSTRAINT pending_registrations_completion_state
        CHECK (
          completed_at IS NULL
          OR (verified_at IS NOT NULL
            AND enrollment_digest IS NOT NULL
            AND completed_at >= verified_at)
        )
    );

    CREATE TABLE auth_rate_limits (
      action TEXT NOT NULL,
      subject_digest BYTEA NOT NULL,
      window_start TIMESTAMPTZ NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      expires_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (action, subject_digest, window_start),
      CONSTRAINT auth_rate_limits_subject_digest_length
        CHECK (octet_length(subject_digest) = 32),
      CONSTRAINT auth_rate_limits_attempts_nonnegative
        CHECK (attempts >= 0),
      CONSTRAINT auth_rate_limits_expiry_order
        CHECK (expires_at > window_start)
    );

    CREATE TABLE verification_email_outbox (
      id UUID PRIMARY KEY,
      pending_registration_id UUID NOT NULL
        REFERENCES pending_registrations(id) ON DELETE CASCADE,
      recipient TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      sender TEXT NOT NULL,
      public_origin TEXT NOT NULL,
      template_version TEXT NOT NULL,
      locale TEXT NOT NULL,
      subject TEXT NOT NULL,
      payload_hash BYTEA NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      lease_token UUID,
      lease_expires_at TIMESTAMPTZ,
      provider_message_id TEXT,
      sent_at TIMESTAMPTZ,
      failed_at TIMESTAMPTZ,
      last_error_code TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT verification_email_outbox_idempotency_key
        UNIQUE (idempotency_key),
      CONSTRAINT verification_email_outbox_payload_hash_length
        CHECK (octet_length(payload_hash) = 32),
      CONSTRAINT verification_email_outbox_attempts_nonnegative
        CHECK (attempts >= 0),
      CONSTRAINT verification_email_outbox_lease_state
        CHECK (
          (lease_token IS NULL AND lease_expires_at IS NULL)
          OR (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
        ),
      CONSTRAINT verification_email_outbox_terminal_state
        CHECK (sent_at IS NULL OR failed_at IS NULL),
      CONSTRAINT verification_email_outbox_provider_state
        CHECK (sent_at IS NULL OR provider_message_id IS NOT NULL)
    );

    CREATE INDEX sessions_user_id_active_idx
      ON sessions (user_id, absolute_expires_at, idle_expires_at)
      WHERE revoked_at IS NULL;
    CREATE INDEX pending_registrations_email_canonical_idx
      ON pending_registrations (email_canonical, verification_expires_at);
    CREATE INDEX pending_registrations_claim_idx
      ON pending_registrations (verification_expires_at, id)
      WHERE completed_at IS NULL;
    CREATE INDEX auth_rate_limits_expires_at_idx
      ON auth_rate_limits (expires_at);
    CREATE INDEX verification_email_outbox_pending_registration_idx
      ON verification_email_outbox (pending_registration_id);
  `);

  pgm.sql(String.raw`
    CREATE INDEX verification_email_outbox_claim_idx
      ON verification_email_outbox (available_at, lease_expires_at, id)
      WHERE sent_at IS NULL
        AND failed_at IS NULL;
  `);
};

exports.down = () => {
  throw new Error(
    `${AUTH_MIGRATION_NAME} is irreversible: restore the verified pre-cutover backup before deploying the prior application`,
  );
};
