/* eslint-disable camelcase */

exports.up = (pgm) => {
  pgm.sql(String.raw`
    SET LOCAL lock_timeout = '5s';
    SET LOCAL statement_timeout = '120s';

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
           1,
           1,
           jsonb_build_object('postId', post.id)
    FROM posts AS post
    WHERE NOT EXISTS (
      SELECT 1
      FROM retrieval_embeddings AS retrieval
      WHERE retrieval.source_kind = 'post'
        AND retrieval.source_id = post.id
        AND retrieval.model = 'text-embedding-3-small'
    )
      AND NOT EXISTS (
        SELECT 1
        FROM work_outbox_events AS event
        WHERE event.event_type = 'retrieval_embedding.requested'
          AND event.aggregate_type = 'post'
          AND event.aggregate_id = post.id::text
      );
  `);
};

exports.down = () => {
  throw new Error(
    'retrieval backfill rollback refused: restore a verified backup or roll forward',
  );
};
