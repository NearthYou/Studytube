/* eslint-disable camelcase */

exports.up = (pgm) => {
  pgm.sql(String.raw`
    SET LOCAL lock_timeout = '5s';
    SET LOCAL statement_timeout = '30s';

    CREATE TABLE work_job_claims (
      event_id UUID NOT NULL
        REFERENCES work_outbox_events(id) ON DELETE RESTRICT,
      handler_version TEXT NOT NULL,
      lease_owner TEXT NOT NULL,
      lease_token UUID NOT NULL,
      lease_expires_at TIMESTAMPTZ NOT NULL,
      claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      renewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (event_id, handler_version),
      CONSTRAINT work_job_claims_handler_version_present
        CHECK (btrim(handler_version) <> ''),
      CONSTRAINT work_job_claims_lease_owner_present
        CHECK (btrim(lease_owner) <> '')
    );

    CREATE INDEX work_job_claims_lease_expiry_idx
      ON work_job_claims (lease_expires_at, event_id, handler_version);
  `);
};

exports.down = () => {
  throw new Error(
    'work job claims rollback refused: roll forward after worker drain',
  );
};
