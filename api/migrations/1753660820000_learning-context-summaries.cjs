/* eslint-disable camelcase */

exports.up = (pgm) => {
  pgm.sql(String.raw`
    SET LOCAL lock_timeout = '5s';
    SET LOCAL statement_timeout = '45s';

    CREATE TABLE learning_context_summaries (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      study_context_id BIGINT NOT NULL
        REFERENCES study_contexts(id) ON DELETE CASCADE,
      caption_artifact_id BIGINT NOT NULL
        REFERENCES caption_artifacts(id) ON DELETE RESTRICT,
      caption_generation INTEGER NOT NULL,
      coverage_scope TEXT NOT NULL,
      coverage_start_seconds DOUBLE PRECISION NOT NULL,
      coverage_end_seconds DOUBLE PRECISION NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      payload JSONB,
      safe_error_code TEXT,
      event_id UUID NOT NULL UNIQUE
        REFERENCES work_outbox_events(id) DEFERRABLE INITIALLY DEFERRED,
      created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
      CONSTRAINT learning_context_summaries_generation_positive
        CHECK (caption_generation > 0),
      CONSTRAINT learning_context_summaries_scope_valid
        CHECK (coverage_scope IN ('full_video', 'study_range')),
      CONSTRAINT learning_context_summaries_range_valid
        CHECK (coverage_start_seconds >= 0 AND coverage_end_seconds > coverage_start_seconds),
      CONSTRAINT learning_context_summaries_status_valid
        CHECK (status IN ('pending', 'ready', 'failed')),
      CONSTRAINT learning_context_summaries_payload_state
        CHECK (
          (status = 'ready' AND payload IS NOT NULL AND safe_error_code IS NULL)
          OR (status = 'failed' AND payload IS NULL AND safe_error_code IS NOT NULL)
          OR (status = 'pending' AND payload IS NULL AND safe_error_code IS NULL)
        ),
      CONSTRAINT learning_context_summaries_artifact_range_key UNIQUE (
        study_context_id, caption_artifact_id, caption_generation,
        coverage_start_seconds, coverage_end_seconds
      )
    );

    CREATE INDEX learning_context_summaries_context_status_idx
      ON learning_context_summaries (study_context_id, status, updated_at DESC);
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS learning_context_summaries');
};
