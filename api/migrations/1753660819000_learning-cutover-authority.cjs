/* eslint-disable camelcase */

exports.up = (pgm) => {
  pgm.sql(String.raw`
    SET LOCAL lock_timeout = '5s';
    SET LOCAL statement_timeout = '45s';

    CREATE TABLE learning_cutover_source_changes (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      entity_kind TEXT NOT NULL,
      legacy_entity_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
      CONSTRAINT learning_cutover_source_kind_nonempty
        CHECK (length(btrim(entity_kind)) > 0),
      CONSTRAINT learning_cutover_source_id_nonempty
        CHECK (length(btrim(legacy_entity_id)) > 0),
      CONSTRAINT learning_cutover_source_operation_valid
        CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE'))
    );

    CREATE INDEX learning_cutover_source_changes_kind_id_idx
      ON learning_cutover_source_changes (entity_kind, id);

    CREATE TABLE learning_cutover_runs (
      id UUID PRIMARY KEY,
      state TEXT NOT NULL DEFAULT 'backfilling',
      source_watermark BIGINT NOT NULL,
      processed_watermark BIGINT NOT NULL,
      writer_release TEXT NOT NULL,
      migration_version TEXT NOT NULL,
      cursors JSONB NOT NULL DEFAULT '{}'::jsonb,
      source_count BIGINT,
      target_count BIGINT,
      source_fingerprint TEXT,
      target_fingerprint TEXT,
      diagnostics JSONB NOT NULL DEFAULT '{}'::jsonb,
      started_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
      activated_at TIMESTAMPTZ,
      CONSTRAINT learning_cutover_runs_state_valid
        CHECK (state IN ('backfilling', 'ready', 'frozen', 'aborted', 'activated')),
      CONSTRAINT learning_cutover_runs_watermarks_valid
        CHECK (source_watermark >= 0 AND processed_watermark >= source_watermark),
      CONSTRAINT learning_cutover_runs_writer_release_nonempty
        CHECK (length(btrim(writer_release)) > 0),
      CONSTRAINT learning_cutover_runs_migration_nonempty
        CHECK (length(btrim(migration_version)) > 0),
      CONSTRAINT learning_cutover_runs_cursors_object
        CHECK (jsonb_typeof(cursors) = 'object'),
      CONSTRAINT learning_cutover_runs_diagnostics_object
        CHECK (jsonb_typeof(diagnostics) = 'object')
    );

    CREATE TABLE learning_cutover_authority (
      singleton BOOLEAN PRIMARY KEY DEFAULT true,
      run_id UUID NOT NULL UNIQUE REFERENCES learning_cutover_runs(id) ON DELETE RESTRICT,
      source_watermark BIGINT NOT NULL,
      freeze_watermark BIGINT NOT NULL,
      source_count BIGINT NOT NULL,
      target_count BIGINT NOT NULL,
      source_fingerprint TEXT NOT NULL,
      target_fingerprint TEXT NOT NULL,
      migration_version TEXT NOT NULL,
      writer_release TEXT NOT NULL,
      activated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
      CONSTRAINT learning_cutover_authority_singleton CHECK (singleton),
      CONSTRAINT learning_cutover_authority_watermarks_valid
        CHECK (source_watermark >= 0 AND freeze_watermark >= source_watermark),
      CONSTRAINT learning_cutover_authority_counts_valid
        CHECK (source_count >= 0 AND source_count = target_count),
      CONSTRAINT learning_cutover_authority_fingerprints_match
        CHECK (source_fingerprint = target_fingerprint),
      CONSTRAINT learning_cutover_authority_migration_nonempty
        CHECK (length(btrim(migration_version)) > 0),
      CONSTRAINT learning_cutover_authority_release_nonempty
        CHECK (length(btrim(writer_release)) > 0)
    );

    CREATE FUNCTION record_learning_cutover_source_change()
    RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE
      source_row RECORD;
      source_id TEXT;
    BEGIN
      source_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
      IF TG_TABLE_NAME = 'playlist_items' THEN
        source_id := (to_jsonb(source_row)->>'playlist_id') || ':' ||
          (to_jsonb(source_row)->>'post_id');
      ELSE
        source_id := to_jsonb(source_row)->>'id';
      END IF;
      INSERT INTO learning_cutover_source_changes (
        entity_kind, legacy_entity_id, operation
      ) VALUES (TG_TABLE_NAME, source_id, TG_OP);
      RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END;
    $$;

    CREATE TRIGGER posts_learning_cutover_delta
      AFTER INSERT OR UPDATE OR DELETE ON posts
      FOR EACH ROW EXECUTE FUNCTION record_learning_cutover_source_change();
    CREATE TRIGGER courses_learning_cutover_delta
      AFTER INSERT OR UPDATE OR DELETE ON courses
      FOR EACH ROW EXECUTE FUNCTION record_learning_cutover_source_change();
    CREATE TRIGGER course_steps_learning_cutover_delta
      AFTER INSERT OR UPDATE OR DELETE ON course_steps
      FOR EACH ROW EXECUTE FUNCTION record_learning_cutover_source_change();
    CREATE TRIGGER learning_progress_cutover_delta
      AFTER INSERT OR UPDATE OR DELETE ON learning_progress
      FOR EACH ROW EXECUTE FUNCTION record_learning_cutover_source_change();
    CREATE TRIGGER learning_progress_events_cutover_delta
      AFTER INSERT OR UPDATE OR DELETE ON learning_progress_events
      FOR EACH ROW EXECUTE FUNCTION record_learning_cutover_source_change();
    CREATE TRIGGER quiz_attempts_learning_cutover_delta
      AFTER INSERT OR UPDATE OR DELETE ON quiz_attempts
      FOR EACH ROW EXECUTE FUNCTION record_learning_cutover_source_change();
    CREATE TRIGGER playlists_learning_cutover_delta
      AFTER INSERT OR UPDATE OR DELETE ON playlists
      FOR EACH ROW EXECUTE FUNCTION record_learning_cutover_source_change();
    CREATE TRIGGER playlist_items_learning_cutover_delta
      AFTER INSERT OR UPDATE OR DELETE ON playlist_items
      FOR EACH ROW EXECUTE FUNCTION record_learning_cutover_source_change();

    CREATE FUNCTION refuse_learning_cutover_authority_change()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'LEARNING_CUTOVER_AUTHORITY_IMMUTABLE' USING ERRCODE = '55000';
    END;
    $$;
    CREATE TRIGGER learning_cutover_authority_immutable
      BEFORE UPDATE OR DELETE ON learning_cutover_authority
      FOR EACH ROW EXECUTE FUNCTION refuse_learning_cutover_authority_change();
  `);
};

exports.down = () => {
  throw new Error(
    'learning cutover authority rollback refused: roll forward or restore a verified pre-cutover backup',
  );
};
