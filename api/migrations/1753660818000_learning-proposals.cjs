/* eslint-disable camelcase */

exports.up = (pgm) => {
  pgm.sql(String.raw`
    SET LOCAL lock_timeout = '5s';
    SET LOCAL statement_timeout = '45s';

    CREATE TABLE learning_proposals (
      id UUID PRIMARY KEY,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      agent_run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE RESTRICT,
      video_source_id BIGINT NOT NULL REFERENCES video_sources(id) ON DELETE RESTRICT,
      proposal_version INTEGER NOT NULL DEFAULT 1,
      state TEXT NOT NULL DEFAULT 'pending',
      payload JSONB NOT NULL,
      payload_digest BYTEA NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ,
      approved_course_id INTEGER REFERENCES courses(id) ON DELETE RESTRICT,
      approved_course_version INTEGER,
      approval_target_digest BYTEA,
      dismissal_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
      CONSTRAINT learning_proposals_version_positive CHECK (proposal_version >= 1),
      CONSTRAINT learning_proposals_state_valid
        CHECK (state IN ('pending', 'approved', 'dismissed', 'expired')),
      CONSTRAINT learning_proposals_payload_object CHECK (jsonb_typeof(payload) = 'object'),
      CONSTRAINT learning_proposals_payload_digest_length
        CHECK (octet_length(payload_digest) = 32),
      CONSTRAINT learning_proposals_target_digest_length
        CHECK (approval_target_digest IS NULL OR octet_length(approval_target_digest) = 32),
      CONSTRAINT learning_proposals_expiry_valid CHECK (expires_at > created_at),
      CONSTRAINT learning_proposals_terminal_shape CHECK (
        (state = 'pending'
          AND consumed_at IS NULL
          AND approved_course_id IS NULL
          AND approved_course_version IS NULL
          AND approval_target_digest IS NULL
          AND dismissal_reason IS NULL)
        OR (state = 'approved'
          AND consumed_at IS NOT NULL
          AND approved_course_id IS NOT NULL
          AND approved_course_version IS NOT NULL
          AND approval_target_digest IS NOT NULL
          AND dismissal_reason IS NULL)
        OR (state = 'dismissed'
          AND consumed_at IS NOT NULL
          AND approved_course_id IS NULL
          AND approved_course_version IS NULL
          AND approval_target_digest IS NULL
          AND dismissal_reason IS NOT NULL)
        OR (state = 'expired'
          AND consumed_at IS NOT NULL
          AND approved_course_id IS NULL
          AND approved_course_version IS NULL
          AND approval_target_digest IS NULL
          AND dismissal_reason IS NULL)
      ),
      CONSTRAINT learning_proposals_run_key UNIQUE (agent_run_id)
    );

    CREATE INDEX learning_proposals_owner_created_idx
      ON learning_proposals (owner_id, created_at DESC, id DESC);
    CREATE INDEX learning_proposals_pending_expiry_idx
      ON learning_proposals (expires_at, id) WHERE state = 'pending';
  `);
};

exports.down = () => {
  throw new Error(
    'learning proposals rollback refused: roll forward or restore a verified pre-expand backup',
  );
};
