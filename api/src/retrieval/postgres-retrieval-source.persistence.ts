import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { RemoveMissingSourceChunksOutcome } from './retrieval.repository';
import type {
  ReplaceRetrievalChunks,
  ReplaceRetrievalChunksOutcome,
  RetrievalSourceKind,
  RetrievalSourceReference,
  RetrievalSourceSnapshot,
  RetrievalTranscriptSegment,
  RetrievalVisibility,
} from './retrieval.types';
import { RetrievalSourceInvariantError } from './retrieval.errors';
import {
  canonicalPositiveId,
  embeddingLiteral,
} from './postgres-retrieval.values';

type SnapshotRow = {
  sourceId: string;
  sourceVersion: string;
  ownerId: number;
  visibility: RetrievalVisibility;
  title: string;
  summary: string;
  translatedNotes: string;
  tags: unknown;
  sourceUrl: string;
  transcriptBody: string;
  sourceSegments: unknown;
  translatedSegments: unknown;
};

type CurrentSourceRow = {
  sourceVersion: string;
  ownerId: number;
  visibility: RetrievalVisibility;
};

type ExistingChunkRow = {
  chunkIndex: number;
  startSeconds: number | null;
  endSeconds: number | null;
  sourceVersion: string;
  contentHash: Buffer;
};

export class PostgresRetrievalSourcePersistence {
  constructor(private readonly pool: Pool) {}

  async readSnapshot(
    source: RetrievalSourceReference,
  ): Promise<RetrievalSourceSnapshot | null> {
    const sourceId = canonicalPositiveId(source.sourceId);
    const result = await this.pool.query<SnapshotRow>(
      source.sourceKind === 'post'
        ? POST_SNAPSHOT_SQL
        : COURSE_STEP_SNAPSHOT_SQL,
      [sourceId],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      sourceKind: source.sourceKind,
      sourceId: String(row.sourceId),
      sourceVersion: String(row.sourceVersion),
      ownerId: Number(row.ownerId),
      visibility: row.visibility,
      title: row.title,
      summary: row.summary,
      translatedNotes: row.translatedNotes,
      tags: stringArray(row.tags),
      sourceUrl: row.sourceUrl,
      transcriptBody: row.transcriptBody,
      sourceSegments: transcriptSegments(row.sourceSegments),
      translatedSegments: transcriptSegments(row.translatedSegments),
    };
  }

  async replaceChunks(
    input: ReplaceRetrievalChunks,
  ): Promise<ReplaceRetrievalChunksOutcome> {
    const normalized = normalizeChunkReplacement(input);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '30s'");
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [`${normalized.sourceKind}:${normalized.sourceId}`],
      );

      const current = await readCurrentSource(
        client,
        normalized.sourceKind,
        normalized.sourceId,
      );
      if (!current) {
        await deleteSourceModelChunks(client, normalized);
        await client.query('COMMIT');
        return 'superseded';
      }

      const expectedVersion = BigInt(normalized.sourceVersion);
      const currentVersion = BigInt(current.sourceVersion);
      if (currentVersion > expectedVersion) {
        await client.query('COMMIT');
        return 'superseded';
      }
      if (currentVersion < expectedVersion) {
        throw new RetrievalSourceInvariantError(
          'Retrieval source version is ahead of the authoritative source',
        );
      }
      if (
        current.ownerId !== normalized.ownerId ||
        current.visibility !== normalized.visibility
      ) {
        throw new RetrievalSourceInvariantError(
          'Retrieval ownership or visibility does not match the source',
        );
      }

      const existing = await client.query<ExistingChunkRow>(
        `
          SELECT chunk_index AS "chunkIndex",
                 start_seconds AS "startSeconds",
                 end_seconds AS "endSeconds",
                 source_version::text AS "sourceVersion",
                 content_hash AS "contentHash"
          FROM retrieval_embeddings
          WHERE source_kind = $1
            AND source_id = $2::bigint
            AND model = $3
          ORDER BY chunk_index
          FOR UPDATE
        `,
        [normalized.sourceKind, normalized.sourceId, normalized.model],
      );
      const sameVersion = existing.rows.filter(
        (row) => BigInt(row.sourceVersion) === expectedVersion,
      );
      if (sameVersion.length > 0) {
        if (
          sameVersion.length === existing.rows.length &&
          sameChunkContentSet(sameVersion, normalized)
        ) {
          await client.query('COMMIT');
          return 'stored';
        }
        throw new RetrievalSourceInvariantError(
          'The same source version has a different retrieval chunk set',
        );
      }
      if (
        existing.rows.some((row) => BigInt(row.sourceVersion) > expectedVersion)
      ) {
        await client.query('COMMIT');
        return 'superseded';
      }

      await deleteSourceModelChunks(client, normalized);
      for (const chunk of normalized.chunks) {
        const contentHash = createHash('sha256')
          .update(chunk.content, 'utf8')
          .digest();
        await client.query(
          `
            INSERT INTO retrieval_embeddings (
              source_kind,
              source_id,
              owner_id,
              visibility,
              model,
              content,
              content_hash,
              source_url,
              embedding,
              timestamp_seconds,
              chunk_index,
              start_seconds,
              end_seconds,
              source_version
            )
            VALUES (
              $1, $2::bigint, $3, $4, $5, $6, $7, $8, $9::vector,
              $10, $11, $10, $12, $13::bigint
            )
          `,
          [
            normalized.sourceKind,
            normalized.sourceId,
            normalized.ownerId,
            normalized.visibility,
            normalized.model,
            chunk.content,
            contentHash,
            chunk.sourceUrl,
            embeddingLiteral(chunk.embedding),
            chunk.startSeconds,
            chunk.chunkIndex,
            chunk.endSeconds,
            normalized.sourceVersion,
          ],
        );
      }
      await client.query('COMMIT');
      return 'stored';
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async removeMissingChunks(
    source: RetrievalSourceReference,
  ): Promise<RemoveMissingSourceChunksOutcome> {
    const sourceKind = canonicalSourceKind(source.sourceKind);
    const sourceId = canonicalPositiveId(source.sourceId);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '30s'");
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [`${sourceKind}:${sourceId}`],
      );

      const current = await readCurrentSource(client, sourceKind, sourceId);
      if (current) {
        await client.query('COMMIT');
        return 'superseded';
      }

      await deleteAllSourceChunks(client, { sourceKind, sourceId });
      await client.query('COMMIT');
      return 'removed';
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

const POST_SNAPSHOT_SQL = `
  SELECT post.id::text AS "sourceId",
         post.retrieval_version::text AS "sourceVersion",
         post.author_id AS "ownerId",
         'public'::text AS visibility,
         post.title,
         post.summary,
         post.translated_notes AS "translatedNotes",
         COALESCE(post_tags.tags, ARRAY[]::text[]) AS tags,
         post.video_url AS "sourceUrl",
         COALESCE(asset.transcript_body, '') AS "transcriptBody",
         COALESCE(asset.source_segments, '[]'::jsonb) AS "sourceSegments",
         COALESCE(asset.translated_segments, '[]'::jsonb) AS "translatedSegments"
  FROM posts AS post
  LEFT JOIN LATERAL (
    SELECT array_agg(tag.name ORDER BY tag.name) AS tags
    FROM post_tags
    JOIN tags AS tag ON tag.id = post_tags.tag_id
    WHERE post_tags.post_id = post.id
  ) AS post_tags ON true
  LEFT JOIN LATERAL (
    SELECT video_asset.transcript_body,
           video_asset.source_segments,
           video_asset.translated_segments
    FROM video_assets AS video_asset
    WHERE video_asset.post_id = post.id
    ORDER BY video_asset.updated_at DESC, video_asset.id DESC
    LIMIT 1
  ) AS asset ON true
  WHERE post.id = $1::bigint
`;

const COURSE_STEP_SNAPSHOT_SQL = `
  SELECT step.id::text AS "sourceId",
         course.version::text AS "sourceVersion",
         course.owner_id AS "ownerId",
         course.visibility,
         step.title_snapshot AS title,
         COALESCE(post.summary, '') AS summary,
         COALESCE(post.translated_notes, '') AS "translatedNotes",
         COALESCE(post_tags.tags, ARRAY[]::text[]) AS tags,
         step.video_url_snapshot AS "sourceUrl",
         COALESCE(asset.transcript_body, '') AS "transcriptBody",
         COALESCE(asset.source_segments, '[]'::jsonb) AS "sourceSegments",
         COALESCE(asset.translated_segments, '[]'::jsonb) AS "translatedSegments"
  FROM course_steps AS step
  JOIN courses AS course ON course.id = step.course_id
  LEFT JOIN posts AS post ON post.id = step.source_post_id
  LEFT JOIN LATERAL (
    SELECT array_agg(tag.name ORDER BY tag.name) AS tags
    FROM post_tags
    JOIN tags AS tag ON tag.id = post_tags.tag_id
    WHERE post_tags.post_id = post.id
  ) AS post_tags ON true
  LEFT JOIN LATERAL (
    SELECT video_asset.transcript_body,
           video_asset.source_segments,
           video_asset.translated_segments
    FROM video_assets AS video_asset
    WHERE video_asset.post_id = post.id
    ORDER BY video_asset.updated_at DESC, video_asset.id DESC
    LIMIT 1
  ) AS asset ON true
  WHERE step.id = $1::bigint
    AND (
      (course.status = 'draft' AND course.visibility = 'private')
      OR (course.status = 'published' AND course.visibility = 'public')
    )
`;

async function readCurrentSource(
  client: PoolClient,
  sourceKind: RetrievalSourceKind,
  sourceId: string,
): Promise<CurrentSourceRow | null> {
  const result = await client.query<CurrentSourceRow>(
    sourceKind === 'post'
      ? `
          SELECT retrieval_version::text AS "sourceVersion",
                 author_id AS "ownerId",
                 'public'::text AS visibility
          FROM posts
          WHERE id = $1::bigint
          FOR SHARE
        `
      : `
          SELECT course.version::text AS "sourceVersion",
                 course.owner_id AS "ownerId",
                 course.visibility
          FROM course_steps AS step
          JOIN courses AS course ON course.id = step.course_id
          WHERE step.id = $1::bigint
            AND (
              (course.status = 'draft' AND course.visibility = 'private')
              OR (course.status = 'published' AND course.visibility = 'public')
            )
          FOR SHARE OF step, course
        `,
    [sourceId],
  );
  return result.rows[0] ?? null;
}

async function deleteSourceModelChunks(
  client: PoolClient,
  input: Pick<ReplaceRetrievalChunks, 'sourceKind' | 'sourceId' | 'model'>,
): Promise<void> {
  await client.query(
    `
      DELETE FROM retrieval_embeddings
      WHERE source_kind = $1
        AND source_id = $2::bigint
        AND model = $3
    `,
    [input.sourceKind, input.sourceId, input.model],
  );
}

async function deleteAllSourceChunks(
  client: PoolClient,
  source: RetrievalSourceReference & { sourceId: string },
): Promise<void> {
  await client.query(
    `
      DELETE FROM retrieval_embeddings
      WHERE source_kind = $1
        AND source_id = $2::bigint
    `,
    [source.sourceKind, source.sourceId],
  );
}

function normalizeChunkReplacement(
  input: ReplaceRetrievalChunks,
): ReplaceRetrievalChunks & { sourceId: string; sourceVersion: string } {
  const sourceId = canonicalPositiveId(input.sourceId);
  const sourceVersion = canonicalPositiveId(input.sourceVersion);
  if (!Number.isSafeInteger(input.ownerId) || input.ownerId <= 0) {
    throw new RangeError('Retrieval owner ID must be a positive integer');
  }
  if (!input.model.trim()) {
    throw new RangeError('Retrieval model must not be blank');
  }
  if (input.chunks.length === 0 || input.chunks.length > 128) {
    throw new RangeError('Retrieval chunk count must be between 1 and 128');
  }
  const chunks = input.chunks.map((chunk, index) => {
    const content = chunk.content.trim();
    if (chunk.chunkIndex !== index) {
      throw new RangeError('Retrieval chunk indexes must be contiguous');
    }
    if (!content || content.length > 3000) {
      throw new RangeError(
        'Retrieval chunk content must contain between 1 and 3000 characters',
      );
    }
    if (
      (chunk.startSeconds === null) !== (chunk.endSeconds === null) ||
      (chunk.startSeconds !== null &&
        (!Number.isInteger(chunk.startSeconds) ||
          !Number.isInteger(chunk.endSeconds) ||
          chunk.startSeconds < 0 ||
          (chunk.endSeconds ?? 0) <= chunk.startSeconds))
    ) {
      throw new RangeError('Retrieval chunk timestamp range is invalid');
    }
    embeddingLiteral(chunk.embedding);
    return { ...chunk, content };
  });
  return { ...input, sourceId, sourceVersion, chunks };
}

function sameChunkContentSet(
  existing: ExistingChunkRow[],
  input: ReplaceRetrievalChunks,
): boolean {
  if (existing.length !== input.chunks.length) {
    return false;
  }
  return existing.every((row, index) => {
    const chunk = input.chunks[index];
    if (!chunk) {
      return false;
    }
    const hash = createHash('sha256').update(chunk.content, 'utf8').digest();
    return (
      row.chunkIndex === chunk.chunkIndex &&
      row.startSeconds === chunk.startSeconds &&
      row.endSeconds === chunk.endSeconds &&
      row.contentHash.equals(hash)
    );
  });
}

function canonicalSourceKind(value: unknown): RetrievalSourceKind {
  if (value !== 'post' && value !== 'course_step') {
    throw new RangeError('Retrieval source kind is invalid');
  }
  return value;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function transcriptSegments(value: unknown): RetrievalTranscriptSegment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return [];
    }
    const row = item as Record<string, unknown>;
    const start = Number(row.start);
    const end = Number(row.end);
    const text = typeof row.text === 'string' ? row.text.trim() : '';
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start ||
      !text
    ) {
      return [];
    }
    return [{ start, end, text }];
  });
}
