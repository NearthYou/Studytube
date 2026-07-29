const INDEX_NAME = 'retrieval_embedding_cache_last_used_at_idx';

exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql("SET lock_timeout = '10s'");
  pgm.sql("SET statement_timeout = '5min'");
  pgm.sql(
    `CREATE INDEX CONCURRENTLY ${INDEX_NAME} ON retrieval_embedding_cache (last_used_at, model, content_hash)`,
  );
  pgm.sql('RESET statement_timeout');
  pgm.sql('RESET lock_timeout');
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql("SET lock_timeout = '10s'");
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS ${INDEX_NAME}`);
  pgm.sql('RESET lock_timeout');
};
