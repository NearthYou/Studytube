/* eslint-disable camelcase */

exports.up = (pgm) => {
  pgm.sql(String.raw`
    SET LOCAL lock_timeout = '5s';
    SET LOCAL statement_timeout = '45s';

    ALTER TABLE posts
      ADD COLUMN retrieval_version BIGINT NOT NULL DEFAULT 1;

    ALTER TABLE posts
      ADD CONSTRAINT posts_retrieval_version_positive
      CHECK (retrieval_version >= 1) NOT VALID;

    ALTER TABLE retrieval_embeddings
      ADD COLUMN chunk_index INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN start_seconds INTEGER,
      ADD COLUMN end_seconds INTEGER,
      ADD COLUMN source_version BIGINT NOT NULL DEFAULT 0;

    ALTER TABLE retrieval_embeddings
      ALTER COLUMN source_version SET DEFAULT 1;

    ALTER TABLE retrieval_embeddings
      ADD CONSTRAINT retrieval_embeddings_chunk_index_nonnegative
        CHECK (chunk_index >= 0) NOT VALID,
      ADD CONSTRAINT retrieval_embeddings_chunk_range_valid
        CHECK (
          (start_seconds IS NULL AND end_seconds IS NULL)
          OR (
            start_seconds IS NOT NULL
            AND end_seconds IS NOT NULL
            AND start_seconds >= 0
            AND end_seconds > start_seconds
          )
        ) NOT VALID,
      ADD CONSTRAINT retrieval_embeddings_source_version_nonnegative
        CHECK (source_version >= 0) NOT VALID;

    ALTER TABLE retrieval_embeddings
      DROP CONSTRAINT retrieval_embeddings_source_model_key;

    ALTER TABLE retrieval_embeddings
      ADD CONSTRAINT retrieval_embeddings_source_model_chunk_key
      UNIQUE (source_kind, source_id, model, chunk_index);

    CREATE INDEX retrieval_embeddings_source_version_idx
      ON retrieval_embeddings (
        source_kind,
        source_id,
        model,
        source_version,
        chunk_index
      );

    CREATE TABLE retrieval_embedding_cache (
      model TEXT NOT NULL,
      content_hash BYTEA NOT NULL,
      dimensions INTEGER NOT NULL,
      embedding vector(1536) NOT NULL,
      input_tokens INTEGER,
      estimated_cost_usd NUMERIC(12, 8),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (model, content_hash),
      CONSTRAINT retrieval_embedding_cache_hash_length
        CHECK (octet_length(content_hash) = 32),
      CONSTRAINT retrieval_embedding_cache_dimensions
        CHECK (dimensions = 1536),
      CONSTRAINT retrieval_embedding_cache_tokens_nonnegative
        CHECK (input_tokens IS NULL OR input_tokens >= 0),
      CONSTRAINT retrieval_embedding_cache_cost_nonnegative
        CHECK (estimated_cost_usd IS NULL OR estimated_cost_usd >= 0)
    );

    CREATE FUNCTION bump_post_retrieval_version_on_content_change()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $bump_post_retrieval_version_on_content_change$
    BEGIN
      IF ROW(
        NEW.author_id,
        NEW.title,
        NEW.video_url,
        NEW.summary,
        NEW.translated_notes
      ) IS DISTINCT FROM ROW(
        OLD.author_id,
        OLD.title,
        OLD.video_url,
        OLD.summary,
        OLD.translated_notes
      ) THEN
        NEW.retrieval_version := OLD.retrieval_version + 1;
      END IF;
      RETURN NEW;
    END
    $bump_post_retrieval_version_on_content_change$;

    CREATE TRIGGER posts_bump_retrieval_version
      BEFORE UPDATE OF author_id, title, video_url, summary, translated_notes
      ON posts
      FOR EACH ROW
      EXECUTE FUNCTION bump_post_retrieval_version_on_content_change();

    CREATE FUNCTION bump_post_retrieval_version_from_relation()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $bump_post_retrieval_version_from_relation$
    DECLARE
      old_post_id INTEGER;
      new_post_id INTEGER;
    BEGIN
      IF TG_TABLE_NAME = 'post_tags' THEN
        IF TG_OP IN ('UPDATE', 'DELETE') THEN
          old_post_id := OLD.post_id;
        END IF;
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
          new_post_id := NEW.post_id;
        END IF;
      ELSE
        IF TG_OP IN ('UPDATE', 'DELETE') THEN
          old_post_id := OLD.post_id;
        END IF;
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
          new_post_id := NEW.post_id;
        END IF;

        IF TG_OP = 'UPDATE' AND ROW(
          NEW.video_id,
          NEW.video_url,
          NEW.language,
          NEW.source_language,
          NEW.status,
          NEW.source_caption_status,
          NEW.translation_status,
          NEW.summary_status,
          NEW.source_segments,
          NEW.translated_segments,
          NEW.summary_sections,
          NEW.transcript_body
        ) IS NOT DISTINCT FROM ROW(
          OLD.video_id,
          OLD.video_url,
          OLD.language,
          OLD.source_language,
          OLD.status,
          OLD.source_caption_status,
          OLD.translation_status,
          OLD.summary_status,
          OLD.source_segments,
          OLD.translated_segments,
          OLD.summary_sections,
          OLD.transcript_body
        ) THEN
          RETURN NEW;
        END IF;
      END IF;

      IF old_post_id IS NOT NULL THEN
        UPDATE posts
        SET retrieval_version = retrieval_version + 1
        WHERE id = old_post_id;
      END IF;

      IF new_post_id IS NOT NULL
        AND new_post_id IS DISTINCT FROM old_post_id
      THEN
        UPDATE posts
        SET retrieval_version = retrieval_version + 1
        WHERE id = new_post_id;
      END IF;

      RETURN COALESCE(NEW, OLD);
    END
    $bump_post_retrieval_version_from_relation$;

    CREATE TRIGGER post_tags_bump_retrieval_version
      AFTER INSERT OR UPDATE OR DELETE ON post_tags
      FOR EACH ROW
      EXECUTE FUNCTION bump_post_retrieval_version_from_relation();

    CREATE TRIGGER video_assets_bump_retrieval_version
      AFTER INSERT OR UPDATE OR DELETE ON video_assets
      FOR EACH ROW
      EXECUTE FUNCTION bump_post_retrieval_version_from_relation();

    CREATE FUNCTION bump_post_retrieval_version_from_tag_name()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $bump_post_retrieval_version_from_tag_name$
    BEGIN
      IF NEW.name IS DISTINCT FROM OLD.name THEN
        UPDATE posts
        SET retrieval_version = retrieval_version + 1
        WHERE id IN (
          SELECT post_id
          FROM post_tags
          WHERE tag_id = NEW.id
        );
      END IF;
      RETURN NEW;
    END
    $bump_post_retrieval_version_from_tag_name$;

    CREATE TRIGGER tags_bump_post_retrieval_version
      AFTER UPDATE OF name ON tags
      FOR EACH ROW
      EXECUTE FUNCTION bump_post_retrieval_version_from_tag_name();

    CREATE FUNCTION delete_retrieval_source_chunks()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $delete_retrieval_source_chunks$
    BEGIN
      DELETE FROM retrieval_embeddings
      WHERE source_kind = TG_ARGV[0]
        AND source_id = OLD.id;
      RETURN OLD;
    END
    $delete_retrieval_source_chunks$;

    CREATE TRIGGER posts_delete_retrieval_chunks
      AFTER DELETE ON posts
      FOR EACH ROW
      EXECUTE FUNCTION delete_retrieval_source_chunks('post');

    CREATE TRIGGER course_steps_delete_retrieval_chunks
      AFTER DELETE ON course_steps
      FOR EACH ROW
      EXECUTE FUNCTION delete_retrieval_source_chunks('course_step');

    INSERT INTO work_outbox_events (
      id,
      event_type,
      aggregate_type,
      aggregate_id,
      aggregate_version,
      payload_schema_version,
      payload
    )
    SELECT gen_random_uuid(),
           'retrieval_embedding.requested',
           'post',
           post.id::text,
           LEAST(post.retrieval_version, 2147483647)::integer,
           1,
           jsonb_build_object(
             'sourceKind', 'post',
             'sourceId', post.id::text,
             'sourceVersion', post.retrieval_version::text
           )
    FROM posts AS post
    WHERE NOT EXISTS (
      SELECT 1
      FROM retrieval_embeddings AS retrieval
      WHERE retrieval.source_kind = 'post'
        AND retrieval.source_id = post.id
        AND retrieval.model = 'text-embedding-3-small'
        AND retrieval.source_version = post.retrieval_version
    )
      AND NOT EXISTS (
        SELECT 1
        FROM work_outbox_events AS event
        WHERE event.event_type = 'retrieval_embedding.requested'
          AND event.aggregate_type = 'post'
          AND event.aggregate_id = post.id::text
          AND event.published_at IS NULL
          AND event.terminal_at IS NULL
      );

    INSERT INTO work_outbox_events (
      id,
      event_type,
      aggregate_type,
      aggregate_id,
      aggregate_version,
      payload_schema_version,
      payload
    )
    SELECT gen_random_uuid(),
           'retrieval_embedding.requested',
           'course_step',
           step.id::text,
           LEAST(course.version, 2147483647)::integer,
           1,
           jsonb_build_object(
             'sourceKind', 'course_step',
             'sourceId', step.id::text,
             'courseStepId', step.id::text,
             'sourceVersion', course.version::text,
             'courseId', course.id
           )
    FROM course_steps AS step
    INNER JOIN courses AS course ON course.id = step.course_id
    WHERE NOT EXISTS (
      SELECT 1
      FROM retrieval_embeddings AS retrieval
      WHERE retrieval.source_kind = 'course_step'
        AND retrieval.source_id = step.id
        AND retrieval.model = 'text-embedding-3-small'
        AND retrieval.source_version = course.version
    )
      AND NOT EXISTS (
        SELECT 1
        FROM work_outbox_events AS event
        WHERE event.event_type = 'retrieval_embedding.requested'
          AND event.aggregate_type = 'course_step'
          AND event.aggregate_id = step.id::text
          AND event.published_at IS NULL
          AND event.terminal_at IS NULL
      );

    ALTER TABLE posts
      VALIDATE CONSTRAINT posts_retrieval_version_positive;
    ALTER TABLE retrieval_embeddings
      VALIDATE CONSTRAINT retrieval_embeddings_chunk_index_nonnegative;
    ALTER TABLE retrieval_embeddings
      VALIDATE CONSTRAINT retrieval_embeddings_chunk_range_valid;
    ALTER TABLE retrieval_embeddings
      VALIDATE CONSTRAINT retrieval_embeddings_source_version_nonnegative;
  `);
};

exports.down = () => {
  throw new Error(
    'retrieval chunk rollback refused: restore a verified backup or roll forward',
  );
};
