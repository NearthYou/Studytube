/* eslint-disable camelcase */

exports.up = (pgm) => {
  pgm.sql(String.raw`
    SET LOCAL lock_timeout = '5s';
    SET LOCAL statement_timeout = '30s';

    ALTER TABLE sessions
      ADD COLUMN google_reauthenticated_at TIMESTAMPTZ,
      ADD CONSTRAINT sessions_google_reauthenticated_order CHECK (
        google_reauthenticated_at IS NULL
        OR google_reauthenticated_at >= created_at
      );

    CREATE INDEX sessions_google_reauthenticated_idx
      ON sessions (user_id, google_reauthenticated_at DESC, id)
      WHERE google_reauthenticated_at IS NOT NULL
        AND revoked_at IS NULL;
  `);
};

exports.down = () => {
  throw new Error(
    'Google account deletion rollback refused: restore the verified pre-expand backup or roll forward',
  );
};
