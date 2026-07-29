/* eslint-disable camelcase */

exports.up = (pgm) => {
  pgm.sql(String.raw`
    SET LOCAL lock_timeout = '5s';
    SET LOCAL statement_timeout = '120s';

    DELETE FROM retrieval_embeddings AS stale
    USING retrieval_embeddings AS current
    WHERE stale.source_kind = current.source_kind
      AND stale.source_id = current.source_id
      AND stale.model = current.model
      AND (
        stale.updated_at < current.updated_at
        OR (stale.updated_at = current.updated_at AND stale.id < current.id)
      );

    ALTER TABLE retrieval_embeddings
      DROP CONSTRAINT retrieval_embeddings_source_model_key;

    ALTER TABLE retrieval_embeddings
      ADD CONSTRAINT retrieval_embeddings_source_model_key
      UNIQUE (source_kind, source_id, model);
  `);
};

exports.down = () => {
  throw new Error(
    'retrieval source model rollback refused: restore a verified backup or roll forward',
  );
};
