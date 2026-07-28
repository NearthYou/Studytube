const INDEXES = [
  {
    name: 'users_lower_email_idx',
    table: 'users',
    keys: 'lower(email)',
  },
  { name: 'sessions_user_id_idx', table: 'sessions', keys: 'user_id' },
  {
    name: 'posts_author_updated_at_idx',
    table: 'posts',
    keys: 'author_id, updated_at DESC',
  },
  {
    name: 'posts_updated_at_idx',
    table: 'posts',
    keys: 'updated_at DESC',
  },
  { name: 'post_tags_tag_id_idx', table: 'post_tags', keys: 'tag_id' },
  {
    name: 'comments_post_created_at_idx',
    table: 'comments',
    keys: 'post_id, created_at',
  },
  {
    name: 'comments_author_id_idx',
    table: 'comments',
    keys: 'author_id',
  },
  {
    name: 'playlists_owner_created_at_idx',
    table: 'playlists',
    keys: 'owner_id, created_at DESC',
  },
  {
    name: 'playlist_items_playlist_position_idx',
    table: 'playlist_items',
    keys: 'playlist_id, position, post_id',
  },
  {
    name: 'playlist_items_post_id_idx',
    table: 'playlist_items',
    keys: 'post_id',
  },
  {
    name: 'playlist_feedback_playlist_created_at_idx',
    table: 'playlist_feedback',
    keys: 'playlist_id, created_at DESC',
  },
  {
    name: 'playlist_feedback_author_id_idx',
    table: 'playlist_feedback',
    keys: 'author_id',
  },
];

function normalizeDefinition(definition) {
  return definition.replaceAll('"', '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function assertReusableIndex(index, expected) {
  if (
    index.relationKind !== 'i' ||
    index.isValid !== true ||
    index.isReady !== true ||
    index.isUnique !== false
  ) {
    throw new Error(
      `Index ${expected.name} already exists but is not a ready, valid, non-unique index. Drop it with DROP INDEX CONCURRENTLY and retry the migration.`,
    );
  }

  const expectedSignature = normalizeDefinition(
    `ON public.${expected.table} USING btree (${expected.keys})`,
  );
  const actualDefinition = normalizeDefinition(index.definition ?? '');

  if (!actualDefinition.endsWith(expectedSignature)) {
    throw new Error(
      `Index ${expected.name} already exists with a different definition. Inspect pg_get_indexdef, choose a new name or drop the conflicting index, then retry the migration.`,
    );
  }
}

exports.up = async (pgm) => {
  pgm.noTransaction();

  const existingIndexes = await pgm.db.select(
    `
      SELECT relation.relname AS name,
             relation.relkind AS "relationKind",
             index_state.indisvalid AS "isValid",
             index_state.indisready AS "isReady",
             index_state.indisunique AS "isUnique",
             CASE
               WHEN relation.relkind = 'i' THEN pg_get_indexdef(relation.oid)
               ELSE NULL
             END AS definition
      FROM pg_class AS relation
      JOIN pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      LEFT JOIN pg_index AS index_state
        ON index_state.indexrelid = relation.oid
      WHERE namespace.nspname = 'public'
        AND relation.relname = ANY($1::text[])
    `,
    [INDEXES.map(({ name }) => name)],
  );
  const existingByName = new Map(
    existingIndexes.map((index) => [index.name, index]),
  );

  pgm.sql("SET lock_timeout = '10s'");

  for (const index of INDEXES) {
    const existing = existingByName.get(index.name);

    if (existing) {
      assertReusableIndex(existing, index);
      continue;
    }

    pgm.sql(
      `CREATE INDEX CONCURRENTLY ${index.name} ON ${index.table} (${index.keys})`,
    );
  }

  pgm.sql('RESET lock_timeout');
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql("SET lock_timeout = '10s'");

  for (const index of INDEXES.toReversed()) {
    pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS ${index.name}`);
  }

  pgm.sql('RESET lock_timeout');
};
