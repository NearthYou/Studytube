/* eslint-disable camelcase */

exports.up = (pgm) => {
  pgm.sql(String.raw`
    SET LOCAL lock_timeout = '5s';
    SET LOCAL statement_timeout = '45s';

    CREATE TABLE adaptive_quiz_loops (
      id UUID PRIMARY KEY,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      study_context_id BIGINT NOT NULL,
      learning_item_id BIGINT NOT NULL,
      video_source_id BIGINT NOT NULL,
      caption_artifact_id BIGINT NOT NULL,
      caption_generation INTEGER NOT NULL,
      watched_ranges JSONB NOT NULL,
      state TEXT NOT NULL DEFAULT 'generating',
      idempotency_key_digest BYTEA NOT NULL,
      payload_hash BYTEA NOT NULL,
      generation_event_id UUID NOT NULL UNIQUE,
      generator_version TEXT,
      failure_code TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
      evaluated_at TIMESTAMPTZ,
      CONSTRAINT adaptive_quiz_loops_context_fk
        FOREIGN KEY (study_context_id, owner_id, learning_item_id)
        REFERENCES study_contexts(id, user_id, learning_item_id) ON DELETE CASCADE,
      CONSTRAINT adaptive_quiz_loops_item_fk
        FOREIGN KEY (learning_item_id, owner_id, video_source_id)
        REFERENCES learning_items(id, user_id, video_source_id) ON DELETE CASCADE,
      CONSTRAINT adaptive_quiz_loops_artifact_fk
        FOREIGN KEY (caption_artifact_id, video_source_id, caption_generation)
        REFERENCES caption_artifacts(id, video_source_id, generation) ON DELETE RESTRICT,
      CONSTRAINT adaptive_quiz_loops_state_valid
        CHECK (state IN ('generating', 'ready', 'evaluated', 'failed', 'stale')),
      CONSTRAINT adaptive_quiz_loops_ranges_valid
        CHECK (learning_watched_ranges_valid(watched_ranges)),
      CONSTRAINT adaptive_quiz_loops_generation_positive CHECK (caption_generation > 0),
      CONSTRAINT adaptive_quiz_loops_digest_length
        CHECK (octet_length(idempotency_key_digest) = 32),
      CONSTRAINT adaptive_quiz_loops_payload_hash_length
        CHECK (octet_length(payload_hash) = 32),
      CONSTRAINT adaptive_quiz_loops_generator_nonempty
        CHECK (generator_version IS NULL OR length(btrim(generator_version)) > 0),
      CONSTRAINT adaptive_quiz_loops_failure_safe
        CHECK (failure_code IS NULL OR failure_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
      CONSTRAINT adaptive_quiz_loops_owner_key
        UNIQUE (owner_id, study_context_id, idempotency_key_digest)
    );

    CREATE TABLE adaptive_quiz_evidence (
      loop_id UUID NOT NULL REFERENCES adaptive_quiz_loops(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      resource_id TEXT NOT NULL,
      content TEXT NOT NULL,
      source_url TEXT NOT NULL,
      start_seconds INTEGER NOT NULL,
      end_seconds INTEGER NOT NULL,
      artifact_id BIGINT NOT NULL,
      artifact_generation INTEGER NOT NULL,
      PRIMARY KEY (loop_id, position),
      CONSTRAINT adaptive_quiz_evidence_position_valid CHECK (position BETWEEN 1 AND 5),
      CONSTRAINT adaptive_quiz_evidence_resource_nonempty CHECK (length(btrim(resource_id)) > 0),
      CONSTRAINT adaptive_quiz_evidence_content_bounded
        CHECK (length(btrim(content)) BETWEEN 1 AND 12000),
      CONSTRAINT adaptive_quiz_evidence_source_nonempty CHECK (length(btrim(source_url)) > 0),
      CONSTRAINT adaptive_quiz_evidence_range_valid
        CHECK (start_seconds >= 0 AND end_seconds > start_seconds),
      CONSTRAINT adaptive_quiz_evidence_generation_positive CHECK (artifact_generation > 0)
    );

    CREATE TABLE adaptive_quiz_questions (
      id UUID PRIMARY KEY,
      loop_id UUID NOT NULL REFERENCES adaptive_quiz_loops(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      prompt TEXT NOT NULL,
      choices JSONB NOT NULL,
      correct_choice_index INTEGER NOT NULL,
      explanation TEXT NOT NULL,
      evidence_position INTEGER NOT NULL,
      CONSTRAINT adaptive_quiz_questions_position_key UNIQUE (loop_id, position),
      CONSTRAINT adaptive_quiz_questions_evidence_fk
        FOREIGN KEY (loop_id, evidence_position)
        REFERENCES adaptive_quiz_evidence(loop_id, position) ON DELETE RESTRICT,
      CONSTRAINT adaptive_quiz_questions_position_valid CHECK (position BETWEEN 1 AND 5),
      CONSTRAINT adaptive_quiz_questions_choices_valid
        CHECK (jsonb_typeof(choices) = 'array'
          AND jsonb_array_length(choices) BETWEEN 2 AND 8
          AND correct_choice_index >= 0
          AND correct_choice_index < jsonb_array_length(choices)),
      CONSTRAINT adaptive_quiz_questions_text_nonempty
        CHECK (length(btrim(prompt)) > 0 AND length(btrim(explanation)) > 0)
    );

    CREATE TABLE adaptive_quiz_attempts (
      id UUID PRIMARY KEY,
      loop_id UUID NOT NULL UNIQUE REFERENCES adaptive_quiz_loops(id) ON DELETE RESTRICT,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      idempotency_key_digest BYTEA NOT NULL,
      payload_hash BYTEA NOT NULL,
      score NUMERIC(5, 2) NOT NULL,
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
      CONSTRAINT adaptive_quiz_attempts_digest_length
        CHECK (octet_length(idempotency_key_digest) = 32),
      CONSTRAINT adaptive_quiz_attempts_payload_hash_length
        CHECK (octet_length(payload_hash) = 32),
      CONSTRAINT adaptive_quiz_attempts_score_valid CHECK (score BETWEEN 0 AND 100),
      CONSTRAINT adaptive_quiz_attempts_idempotency_key
        UNIQUE (loop_id, owner_id, idempotency_key_digest)
    );

    CREATE TABLE adaptive_quiz_answers (
      attempt_id UUID NOT NULL REFERENCES adaptive_quiz_attempts(id) ON DELETE CASCADE,
      question_id UUID NOT NULL REFERENCES adaptive_quiz_questions(id) ON DELETE RESTRICT,
      selected_choice_index INTEGER NOT NULL,
      correct BOOLEAN NOT NULL,
      PRIMARY KEY (attempt_id, question_id),
      CONSTRAINT adaptive_quiz_answers_choice_nonnegative CHECK (selected_choice_index >= 0)
    );

    CREATE TABLE adaptive_quiz_review_proposals (
      id UUID PRIMARY KEY,
      loop_id UUID NOT NULL UNIQUE REFERENCES adaptive_quiz_loops(id) ON DELETE CASCADE,
      attempt_id UUID NOT NULL UNIQUE REFERENCES adaptive_quiz_attempts(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      reason_code TEXT NOT NULL,
      source_url TEXT NOT NULL,
      start_seconds INTEGER NOT NULL,
      end_seconds INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
      CONSTRAINT adaptive_quiz_review_kind_valid CHECK (kind = 'review_range'),
      CONSTRAINT adaptive_quiz_review_reason_safe CHECK (reason_code = 'INCORRECT_ANSWER'),
      CONSTRAINT adaptive_quiz_review_range_valid
        CHECK (start_seconds >= 0 AND end_seconds > start_seconds)
    );

    CREATE INDEX adaptive_quiz_loops_owner_context_idx
      ON adaptive_quiz_loops (owner_id, study_context_id, created_at DESC);
    CREATE INDEX adaptive_quiz_evidence_range_idx
      ON adaptive_quiz_evidence (loop_id, start_seconds, end_seconds);
  `);
};

exports.down = () => {
  throw new Error(
    'adaptive learning loop rollback refused: roll forward or restore a verified pre-expand backup',
  );
};
