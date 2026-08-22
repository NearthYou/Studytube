/* eslint-disable camelcase */

exports.up = (pgm) => {
  pgm.sql(String.raw`
    SET LOCAL lock_timeout = '5s';
    SET LOCAL statement_timeout = '45s';

    ALTER TABLE learning_items
      ADD CONSTRAINT learning_items_id_user_video_key
      UNIQUE (id, user_id, video_source_id);
    ALTER TABLE study_contexts
      ADD COLUMN retrieval_version BIGINT NOT NULL DEFAULT 1,
      ADD CONSTRAINT study_contexts_id_user_item_key
      UNIQUE (id, user_id, learning_item_id),
      ADD CONSTRAINT study_contexts_retrieval_version_positive
      CHECK (retrieval_version >= 1);
    ALTER TABLE learning_notes
      ADD CONSTRAINT learning_notes_id_context_owner_key
      UNIQUE (id, study_context_id, user_id);
    ALTER TABLE caption_artifacts
      ADD CONSTRAINT caption_artifacts_id_video_generation_key
      UNIQUE (id, video_source_id, generation);
    ALTER TABLE caption_artifact_segments
      ADD CONSTRAINT caption_segments_id_artifact_key
      UNIQUE (id, artifact_id);
    ALTER TABLE quiz_attempts
      ADD CONSTRAINT quiz_attempts_id_context_owner_key
      UNIQUE (id, study_context_id, user_id);

    CREATE FUNCTION learning_watched_ranges_valid(ranges JSONB)
    RETURNS boolean
    LANGUAGE sql
    IMMUTABLE
    PARALLEL SAFE
    AS $$
      SELECT jsonb_typeof(ranges) = 'array'
        AND jsonb_array_length(ranges) BETWEEN 1 AND 128
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(ranges) AS range(value)
          WHERE jsonb_typeof(range.value) <> 'object'
             OR NOT (range.value ? 'start' AND range.value ? 'end')
             OR jsonb_typeof(range.value->'start') <> 'number'
             OR jsonb_typeof(range.value->'end') <> 'number'
             OR (range.value->>'start')::numeric < 0
             OR (range.value->>'end')::numeric <= (range.value->>'start')::numeric
        )
    $$;

    CREATE TABLE learning_retrieval_context_snapshots (
      agent_run_id UUID PRIMARY KEY
        REFERENCES agent_runs(id) ON DELETE CASCADE,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      study_context_id BIGINT NOT NULL,
      learning_item_id BIGINT NOT NULL,
      video_source_id BIGINT NOT NULL,
      course_id INTEGER REFERENCES courses(id) ON DELETE RESTRICT,
      profile_goal TEXT NOT NULL,
      watched_ranges JSONB NOT NULL,
      caption_artifact_id BIGINT NOT NULL,
      caption_generation INTEGER NOT NULL,
      context_retrieval_version BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
      CONSTRAINT learning_retrieval_snapshot_context_fk
        FOREIGN KEY (study_context_id, owner_id, learning_item_id)
        REFERENCES study_contexts(id, user_id, learning_item_id) ON DELETE RESTRICT,
      CONSTRAINT learning_retrieval_snapshot_item_fk
        FOREIGN KEY (learning_item_id, owner_id, video_source_id)
        REFERENCES learning_items(id, user_id, video_source_id) ON DELETE RESTRICT,
      CONSTRAINT learning_retrieval_snapshot_artifact_fk
        FOREIGN KEY (caption_artifact_id, video_source_id, caption_generation)
        REFERENCES caption_artifacts(id, video_source_id, generation) ON DELETE RESTRICT,
      CONSTRAINT learning_retrieval_snapshot_goal_bounded
        CHECK (length(profile_goal) <= 500),
      CONSTRAINT learning_retrieval_snapshot_ranges_valid
        CHECK (learning_watched_ranges_valid(watched_ranges)),
      CONSTRAINT learning_retrieval_snapshot_generation_positive
        CHECK (caption_generation > 0),
      CONSTRAINT learning_retrieval_snapshot_version_positive
        CHECK (context_retrieval_version >= 1)
    );

    ALTER TABLE retrieval_embeddings
      DROP CONSTRAINT retrieval_embeddings_source_kind_valid;
    ALTER TABLE retrieval_embeddings
      ADD CONSTRAINT retrieval_embeddings_source_kind_valid
        CHECK (source_kind IN ('post', 'course_step', 'learning_context')),
      ADD COLUMN evidence_kind TEXT,
      ADD COLUMN resource_id TEXT,
      ADD COLUMN readiness TEXT,
      ADD COLUMN evidence_artifact_id BIGINT,
      ADD COLUMN evidence_segment_id BIGINT,
      ADD COLUMN evidence_note_id BIGINT,
      ADD COLUMN evidence_quiz_attempt_id UUID,
      ADD COLUMN artifact_generation INTEGER;

    ALTER TABLE retrieval_embeddings
      ADD CONSTRAINT retrieval_embeddings_evidence_kind_valid
        CHECK (evidence_kind IS NULL OR evidence_kind IN (
          'caption_segment', 'learning_note', 'quiz_outcome'
        )),
      ADD CONSTRAINT retrieval_embeddings_resource_nonempty
        CHECK (resource_id IS NULL OR length(btrim(resource_id)) > 0),
      ADD CONSTRAINT retrieval_embeddings_readiness_valid
        CHECK (readiness IS NULL OR readiness IN ('partial', 'ready')),
      ADD CONSTRAINT retrieval_embeddings_generation_positive
        CHECK (artifact_generation IS NULL OR artifact_generation > 0),
      ADD CONSTRAINT retrieval_embeddings_caption_segment_fk
        FOREIGN KEY (evidence_segment_id, evidence_artifact_id)
        REFERENCES caption_artifact_segments(id, artifact_id) ON DELETE RESTRICT,
      ADD CONSTRAINT retrieval_embeddings_note_owner_fk
        FOREIGN KEY (evidence_note_id, source_id, owner_id)
        REFERENCES learning_notes(id, study_context_id, user_id) ON DELETE RESTRICT,
      ADD CONSTRAINT retrieval_embeddings_quiz_owner_fk
        FOREIGN KEY (evidence_quiz_attempt_id, source_id, owner_id)
        REFERENCES quiz_attempts(id, study_context_id, user_id) ON DELETE RESTRICT,
      ADD CONSTRAINT retrieval_embeddings_learning_shape CHECK (
        (source_kind <> 'learning_context'
          AND evidence_kind IS NULL AND resource_id IS NULL AND readiness IS NULL
          AND evidence_artifact_id IS NULL AND evidence_segment_id IS NULL
          AND evidence_note_id IS NULL AND evidence_quiz_attempt_id IS NULL
          AND artifact_generation IS NULL)
        OR
        (source_kind = 'learning_context'
          AND visibility = 'private' AND owner_id IS NOT NULL
          AND evidence_kind IS NOT NULL AND resource_id IS NOT NULL
          AND readiness IS NOT NULL AND artifact_generation IS NOT NULL
          AND (
            (evidence_kind = 'caption_segment'
              AND evidence_artifact_id IS NOT NULL
              AND evidence_segment_id IS NOT NULL
              AND evidence_note_id IS NULL
              AND evidence_quiz_attempt_id IS NULL)
            OR
            (evidence_kind = 'learning_note'
              AND evidence_artifact_id IS NULL
              AND evidence_segment_id IS NULL
              AND evidence_note_id IS NOT NULL
              AND evidence_quiz_attempt_id IS NULL)
            OR
            (evidence_kind = 'quiz_outcome'
              AND evidence_artifact_id IS NULL
              AND evidence_segment_id IS NULL
              AND evidence_note_id IS NULL
              AND evidence_quiz_attempt_id IS NOT NULL)
          ))
      );

    CREATE FUNCTION validate_learning_retrieval_embedding()
    RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE
      current_artifact_id BIGINT;
      current_generation INTEGER;
      current_version BIGINT;
    BEGIN
      IF NEW.source_kind <> 'learning_context' THEN
        RETURN NEW;
      END IF;

      SELECT COALESCE(
               context.current_translation_caption_artifact_id,
               context.current_source_caption_artifact_id
             ), context.retrieval_version
      INTO current_artifact_id, current_version
      FROM study_contexts AS context
      WHERE context.id = NEW.source_id AND context.user_id = NEW.owner_id;
      IF current_artifact_id IS NULL OR current_version IS NULL THEN
        RAISE EXCEPTION 'LEARNING_RETRIEVAL_CONTEXT_MISMATCH' USING ERRCODE = '23514';
      END IF;
      SELECT generation INTO current_generation
      FROM caption_artifacts WHERE id = current_artifact_id;
      IF NEW.source_version <> current_version
         OR NEW.artifact_generation <> current_generation THEN
        RAISE EXCEPTION 'LEARNING_RETRIEVAL_VERSION_MISMATCH' USING ERRCODE = '23514';
      END IF;
      IF NEW.evidence_kind = 'caption_segment'
         AND NEW.evidence_artifact_id <> current_artifact_id THEN
        RAISE EXCEPTION 'LEARNING_RETRIEVAL_ARTIFACT_MISMATCH' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER retrieval_embeddings_learning_invariant
      BEFORE INSERT OR UPDATE ON retrieval_embeddings
      FOR EACH ROW EXECUTE FUNCTION validate_learning_retrieval_embedding();

    CREATE FUNCTION bump_study_context_retrieval_version()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      NEW.retrieval_version := OLD.retrieval_version + 1;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER study_context_caption_retrieval_version
      BEFORE UPDATE OF current_source_caption_artifact_id,
                       current_translation_caption_artifact_id,
                       source_language_override
      ON study_contexts
      FOR EACH ROW
      WHEN (
        OLD.current_source_caption_artifact_id IS DISTINCT FROM NEW.current_source_caption_artifact_id
        OR OLD.current_translation_caption_artifact_id IS DISTINCT FROM NEW.current_translation_caption_artifact_id
        OR OLD.source_language_override IS DISTINCT FROM NEW.source_language_override
      )
      EXECUTE FUNCTION bump_study_context_retrieval_version();

    CREATE FUNCTION bump_study_context_from_learning_evidence()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      UPDATE study_contexts
      SET retrieval_version = retrieval_version + 1,
          updated_at = statement_timestamp()
      WHERE id = COALESCE(NEW.study_context_id, OLD.study_context_id);
      RETURN COALESCE(NEW, OLD);
    END;
    $$;
    CREATE TRIGGER learning_notes_retrieval_version
      AFTER INSERT OR UPDATE OR DELETE ON learning_notes
      FOR EACH ROW EXECUTE FUNCTION bump_study_context_from_learning_evidence();
    CREATE TRIGGER quiz_attempts_retrieval_version
      AFTER INSERT OR UPDATE OF study_context_id OR DELETE ON quiz_attempts
      FOR EACH ROW EXECUTE FUNCTION bump_study_context_from_learning_evidence();

    CREATE INDEX learning_retrieval_snapshots_owner_context_idx
      ON learning_retrieval_context_snapshots (owner_id, study_context_id, agent_run_id);
    CREATE INDEX retrieval_embeddings_learning_context_idx
      ON retrieval_embeddings (
        owner_id, source_id, artifact_generation, evidence_kind, start_seconds
      ) WHERE source_kind = 'learning_context';
  `);
};

exports.down = () => {
  throw new Error(
    'learning evidence sources rollback refused: roll forward or restore a verified pre-expand backup',
  );
};
