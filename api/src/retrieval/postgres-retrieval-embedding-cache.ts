import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { PruneEmbeddingCacheInput } from './retrieval.repository';
import type {
  EmbeddingResponse,
  ResolveRetrievalEmbedding,
} from './retrieval.types';
import { RetrievalSourceInvariantError } from './retrieval.errors';
import { embeddingLiteral } from './postgres-retrieval.values';

type CachedEmbeddingRow = {
  model: string;
  dimensions: number;
  embedding: string;
  inputTokens: number | null;
  estimatedCostUsd: number | string | null;
};

type PrunedEmbeddingCacheRow = {
  removed: number | string;
};

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const MINIMUM_CACHE_RETENTION_DAYS = 30;
const MAXIMUM_CACHE_RETENTION_DAYS = 3650;
const DEFAULT_CACHE_RETENTION_DAYS = 90;
const MAXIMUM_CACHE_PRUNE_BATCH_SIZE = 500;
const DEFAULT_CACHE_PRUNE_BATCH_SIZE = 100;

export class PostgresRetrievalEmbeddingCache {
  constructor(private readonly pool: Pool) {}

  async resolve(
    input: ResolveRetrievalEmbedding,
    load: () => Promise<EmbeddingResponse>,
  ): Promise<EmbeddingResponse> {
    const model = input.model.trim();
    const content = input.content.trim();
    if (!model || !content) {
      throw new RangeError('Embedding model and content must not be blank');
    }
    const contentHash = createHash('sha256').update(content, 'utf8').digest();
    const lockName = `retrieval-cache:${model}:${contentHash.toString('hex')}`;
    const client = await this.pool.connect();
    let destroyClient = false;
    try {
      await client.query(`SELECT pg_advisory_lock(hashtextextended($1, 0))`, [
        lockName,
      ]);
      const cached = await client.query<CachedEmbeddingRow>(
        `
          UPDATE retrieval_embedding_cache
          SET last_used_at = statement_timestamp()
          WHERE model = $1 AND content_hash = $2
          RETURNING model,
                    dimensions,
                    embedding::text AS embedding,
                    input_tokens AS "inputTokens",
                    estimated_cost_usd AS "estimatedCostUsd"
        `,
        [model, contentHash],
      );
      const hit = cached.rows[0];
      if (hit) {
        return {
          model: hit.model,
          dimensions: 1536,
          embedding: parseEmbeddingLiteral(hit.embedding),
          cacheHit: true,
          inputTokens: hit.inputTokens ?? undefined,
          estimatedCostUsd:
            hit.estimatedCostUsd === null
              ? undefined
              : Number(hit.estimatedCostUsd),
        };
      }

      const loaded = await load();
      if (
        loaded.model !== model ||
        loaded.dimensions !== 1536 ||
        loaded.embedding.length !== 1536 ||
        loaded.embedding.some((value) => !Number.isFinite(value))
      ) {
        throw new RetrievalSourceInvariantError(
          'Embedding provider returned a different model or dimensions',
        );
      }
      await client.query(
        `
          INSERT INTO retrieval_embedding_cache (
            model,
            content_hash,
            dimensions,
            embedding,
            input_tokens,
            estimated_cost_usd
          )
          VALUES ($1, $2, $3, $4::vector, $5, $6)
          ON CONFLICT (model, content_hash) DO UPDATE
          SET last_used_at = statement_timestamp()
        `,
        [
          model,
          contentHash,
          loaded.dimensions,
          embeddingLiteral(loaded.embedding),
          loaded.inputTokens ?? null,
          loaded.estimatedCostUsd ?? null,
        ],
      );
      return { ...loaded, cacheHit: loaded.cacheHit ?? false };
    } catch (error) {
      if (isConnectionError(error)) {
        destroyClient = true;
      }
      throw error;
    } finally {
      if (!destroyClient) {
        try {
          const unlocked = await client.query<{ unlocked: boolean }>(
            `SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked`,
            [lockName],
          );
          if (unlocked.rows[0]?.unlocked !== true) {
            destroyClient = true;
          }
        } catch {
          destroyClient = true;
        }
      }
      client.release(destroyClient);
    }
  }

  async prune(input: PruneEmbeddingCacheInput): Promise<number> {
    const retentionDays = boundedInteger(
      input.retentionDays,
      DEFAULT_CACHE_RETENTION_DAYS,
      MINIMUM_CACHE_RETENTION_DAYS,
      MAXIMUM_CACHE_RETENTION_DAYS,
    );
    const batchSize = boundedInteger(
      input.batchSize,
      DEFAULT_CACHE_PRUNE_BATCH_SIZE,
      1,
      MAXIMUM_CACHE_PRUNE_BATCH_SIZE,
    );
    const cutoff = new Date(Date.now() - retentionDays * MILLISECONDS_PER_DAY);
    const result = await this.pool.query<PrunedEmbeddingCacheRow>(
      `
        WITH expired AS (
          SELECT model, content_hash
          FROM retrieval_embedding_cache
          WHERE last_used_at < $1
          ORDER BY last_used_at, model, content_hash
          LIMIT $2
          FOR UPDATE SKIP LOCKED
        ),
        deleted AS (
          DELETE FROM retrieval_embedding_cache AS cache
          USING expired
          WHERE cache.model = expired.model
            AND cache.content_hash = expired.content_hash
          RETURNING 1
        )
        SELECT count(*)::integer AS removed
        FROM deleted
      `,
      [cutoff, batchSize],
    );
    const removed = Number(result.rows[0]?.removed ?? 0);
    if (!Number.isSafeInteger(removed) || removed < 0 || removed > batchSize) {
      throw new RetrievalSourceInvariantError(
        'Embedding cache maintenance returned an invalid removal count',
      );
    }
    return removed;
  }
}

function parseEmbeddingLiteral(value: string): number[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new RetrievalSourceInvariantError(
      'Cached embedding has an invalid vector encoding',
    );
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 1536 ||
    parsed.some((item) => typeof item !== 'number' || !Number.isFinite(item))
  ) {
    throw new RetrievalSourceInvariantError(
      'Cached embedding has invalid dimensions',
    );
  }
  return parsed as number[];
}

function isConnectionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code.startsWith('08');
}

function boundedInteger(
  value: number,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(minimum, Math.min(Math.trunc(value), maximum));
}
