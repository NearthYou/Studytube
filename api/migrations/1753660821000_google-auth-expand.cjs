/* eslint-disable camelcase */

exports.up = (pgm) => {
  pgm.sql(String.raw`
    SET LOCAL lock_timeout = '5s';
    SET LOCAL statement_timeout = '45s';

    ALTER TABLE users
      ADD COLUMN google_subject TEXT,
      ADD COLUMN profile_image_url TEXT,
      ADD COLUMN last_login_at TIMESTAMPTZ,
      ALTER COLUMN password_hash DROP NOT NULL,
      ALTER COLUMN password_algorithm DROP NOT NULL,
      ALTER COLUMN password_parameters DROP NOT NULL,
      ALTER COLUMN password_version DROP NOT NULL,
      ALTER COLUMN password_version DROP DEFAULT,
      DROP CONSTRAINT users_email_key,
      DROP CONSTRAINT users_email_canonical_key,
      DROP CONSTRAINT users_password_version_positive,
      DROP CONSTRAINT users_password_parameters_object,
      DROP CONSTRAINT users_password_algorithm_valid,
      DROP CONSTRAINT users_identity_assurance_valid,
      DROP CONSTRAINT users_email_verification_claim_valid,
      ADD CONSTRAINT users_google_subject_key UNIQUE (google_subject),
      ADD CONSTRAINT users_google_subject_nonempty CHECK (
        google_subject IS NULL OR length(btrim(google_subject)) > 0
      ),
      ADD CONSTRAINT users_profile_image_url_nonempty CHECK (
        profile_image_url IS NULL OR length(btrim(profile_image_url)) > 0
      ),
      ADD CONSTRAINT users_auth_shape CHECK (
        (
          google_subject IS NOT NULL
          AND password_hash IS NULL
          AND password_algorithm IS NULL
          AND password_parameters IS NULL
          AND password_version IS NULL
          AND identity_assurance = 'google_verified'
          AND email_verified_at IS NOT NULL
        )
        OR
        (
          google_subject IS NULL
          AND password_hash IS NOT NULL
          AND password_algorithm IS NOT NULL
          AND password_parameters IS NOT NULL
          AND jsonb_typeof(password_parameters) = 'object'
          AND password_version IS NOT NULL
          AND password_version >= 1
          AND (
            (password_algorithm = 'legacy_sha256'
              AND password_hash ~ '^[0-9a-f]{64}$')
            OR (password_algorithm = 'disabled'
              AND password_hash = 'disabled:demo-seed-login')
            OR (password_algorithm = 'argon2id'
              AND password_hash LIKE '$argon2id$%')
          )
          AND (
            (identity_assurance = 'legacy_grandfathered'
              AND email_verified_at IS NULL)
            OR (identity_assurance = 'email_verified'
              AND email_verified_at IS NOT NULL)
          )
        )
      );

    ALTER TABLE sessions
      ADD CONSTRAINT sessions_id_user_key UNIQUE (id, user_id);

    CREATE TABLE google_auth_attempts (
      id UUID PRIMARY KEY,
      purpose TEXT NOT NULL,
      state_digest BYTEA NOT NULL,
      nonce_digest BYTEA NOT NULL,
      encrypted_code_verifier BYTEA NOT NULL,
      user_id INTEGER,
      session_id UUID,
      return_path TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
      expires_at TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ,
      CONSTRAINT google_auth_attempts_purpose_valid
        CHECK (purpose IN ('login', 'delete_account')),
      CONSTRAINT google_auth_attempts_state_key UNIQUE (state_digest),
      CONSTRAINT google_auth_attempts_state_digest_length
        CHECK (octet_length(state_digest) = 32),
      CONSTRAINT google_auth_attempts_nonce_digest_length
        CHECK (octet_length(nonce_digest) = 32),
      CONSTRAINT google_auth_attempts_verifier_nonempty
        CHECK (octet_length(encrypted_code_verifier) > 0),
      CONSTRAINT google_auth_attempts_user_fk
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT google_auth_attempts_session_owner_fk
        FOREIGN KEY (session_id, user_id)
        REFERENCES sessions(id, user_id) ON DELETE CASCADE,
      CONSTRAINT google_auth_attempts_return_path_nonempty
        CHECK (return_path IS NULL OR length(btrim(return_path)) > 0),
      CONSTRAINT google_auth_attempts_expiry_order
        CHECK (expires_at > created_at),
      CONSTRAINT google_auth_attempts_consumed_order
        CHECK (consumed_at IS NULL OR consumed_at >= created_at),
      CONSTRAINT google_auth_attempts_owner_shape CHECK (
        (purpose = 'login' AND user_id IS NULL AND session_id IS NULL)
        OR
        (purpose = 'delete_account' AND user_id IS NOT NULL AND session_id IS NOT NULL)
      )
    );

    CREATE INDEX google_auth_attempts_expiry_idx
      ON google_auth_attempts (expires_at, id)
      WHERE consumed_at IS NULL;
    CREATE INDEX google_auth_attempts_user_idx
      ON google_auth_attempts (user_id, expires_at, id)
      WHERE user_id IS NOT NULL;
  `);
};

exports.down = () => {
  throw new Error(
    'Google authentication expansion rollback refused: restore the verified pre-expand backup or roll forward',
  );
};
