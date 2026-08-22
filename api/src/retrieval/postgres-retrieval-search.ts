import type { Pool } from 'pg';
import {
  RETRIEVAL_CANDIDATE_LIMIT,
  RETRIEVAL_LEXICAL_MIN_SIMILARITY,
  RETRIEVAL_RRF_K,
  RETRIEVAL_VECTOR_MAX_DISTANCE,
} from './retrieval.constants';
import type {
  HybridSearchInput,
  RetrievalHit,
  RetrievalSearchMode,
  RetrievalSourceKind,
  RetrievalVisibility,
} from './retrieval.types';
import { RetrievalSourceInvariantError } from './retrieval.errors';
import { embeddingLiteral } from './postgres-retrieval.values';

type RetrievalHitRow = {
  sourceKind: RetrievalSourceKind;
  sourceId: string;
  visibility: RetrievalVisibility;
  title: string;
  content: string;
  sourceUrl: string;
  timestampSeconds: number | string | null;
  rankingScore: number | string;
  endSeconds: number | string | null;
  resourceId: string | null;
  readiness: 'partial' | 'ready' | null;
  artifactGeneration: number | string | null;
};

type SearchParameters = {
  owner: string;
  query?: string;
  model: string;
  embedding?: string;
  limit: string;
  candidateLimit: string;
  lexicalThreshold?: string;
  vectorMaxDistance?: string;
  rrfK?: string;
  contextSnapshot?: string;
};

export class PostgresRetrievalSearch {
  constructor(private readonly pool: Pool) {}

  async hybrid(input: HybridSearchInput): Promise<RetrievalHit[]> {
    return this.search(input, 'hybrid');
  }

  async search(
    input: HybridSearchInput,
    mode: RetrievalSearchMode,
  ): Promise<RetrievalHit[]> {
    const query = input.query.trim();
    if (!query) {
      return [];
    }
    const search = buildSearch(input, mode);
    const result = await this.pool.query<RetrievalHitRow>(
      search.text,
      search.values,
    );

    return result.rows.map((row) => {
      const score = Number(row.rankingScore);
      if (!Number.isFinite(score)) {
        throw new RetrievalSourceInvariantError(
          'Retrieval ranking produced a non-finite score',
        );
      }
      return {
        sourceKind: row.sourceKind,
        sourceId: String(row.sourceId),
        visibility: row.visibility,
        title: row.title,
        content: row.content,
        score,
        citation: {
          sourceUrl: row.sourceUrl,
          timestampSeconds:
            row.timestampSeconds === null ? null : Number(row.timestampSeconds),
          endSeconds: row.endSeconds === null ? null : Number(row.endSeconds),
        },
        ...(row.resourceId ? { resourceId: row.resourceId } : {}),
        ...(row.readiness ? { readiness: row.readiness } : {}),
        ...(row.artifactGeneration === null
          ? {}
          : { artifactGeneration: Number(row.artifactGeneration) }),
      };
    });
  }
}

function buildSearch(
  input: HybridSearchInput,
  mode: RetrievalSearchMode,
): { text: string; values: unknown[] } {
  const limit = Math.max(1, Math.min(Math.trunc(input.limit), 20));
  let parameters: SearchParameters;
  let values: unknown[];
  let settings: string;

  if (mode === 'lexical') {
    parameters = {
      owner: '$1',
      query: '$2',
      model: '$3',
      limit: '$4',
      candidateLimit: '$5',
      lexicalThreshold: '$6',
      contextSnapshot: input.contextSnapshotId ? '$7' : undefined,
    };
    values = [
      input.ownerId,
      input.query.trim(),
      input.model,
      limit,
      RETRIEVAL_CANDIDATE_LIMIT,
      RETRIEVAL_LEXICAL_MIN_SIMILARITY,
      ...(input.contextSnapshotId ? [input.contextSnapshotId] : []),
    ];
    settings = `SELECT set_config(
      'pg_trgm.similarity_threshold',
      ${parameters.lexicalThreshold}::text,
      true
    ) AS lexical_threshold`;
  } else if (mode === 'vector') {
    parameters = {
      owner: '$1',
      model: '$2',
      embedding: '$3',
      limit: '$4',
      candidateLimit: '$5',
      vectorMaxDistance: '$6',
      contextSnapshot: input.contextSnapshotId ? '$7' : undefined,
    };
    values = [
      input.ownerId,
      input.model,
      embeddingLiteral(input.embedding),
      limit,
      RETRIEVAL_CANDIDATE_LIMIT,
      RETRIEVAL_VECTOR_MAX_DISTANCE,
      ...(input.contextSnapshotId ? [input.contextSnapshotId] : []),
    ];
    settings = `SELECT set_config(
      'hnsw.iterative_scan',
      'strict_order',
      true
    ) AS vector_scan`;
  } else {
    parameters = {
      owner: '$1',
      query: '$2',
      model: '$3',
      embedding: '$4',
      limit: '$5',
      candidateLimit: '$6',
      lexicalThreshold: '$7',
      vectorMaxDistance: '$8',
      rrfK: '$9',
      contextSnapshot: input.contextSnapshotId ? '$10' : undefined,
    };
    values = [
      input.ownerId,
      input.query.trim(),
      input.model,
      embeddingLiteral(input.embedding),
      limit,
      RETRIEVAL_CANDIDATE_LIMIT,
      RETRIEVAL_LEXICAL_MIN_SIMILARITY,
      RETRIEVAL_VECTOR_MAX_DISTANCE,
      RETRIEVAL_RRF_K,
      ...(input.contextSnapshotId ? [input.contextSnapshotId] : []),
    ];
    settings = `SELECT
      set_config(
        'pg_trgm.similarity_threshold',
        ${parameters.lexicalThreshold}::text,
        true
      ) AS lexical_threshold,
      set_config('hnsw.iterative_scan', 'strict_order', true) AS vector_scan`;
  }

  const modalityCtes: string[] = [];
  if (mode !== 'vector') {
    modalityCtes.push(modalityCandidates('lexical', parameters));
  }
  if (mode !== 'lexical') {
    modalityCtes.push(modalityCandidates('vector', parameters));
  }

  const ranked =
    mode === 'hybrid' ? hybridRanked(parameters) : singleModalityRanked(mode);

  return {
    text: `
      WITH settings AS MATERIALIZED (
        ${settings}
      ),
      ${modalityCtes.join(',\n')},
      ${ranked},
      source_ranked AS (
        SELECT ranked.*,
               row_number() OVER (
                 PARTITION BY source_kind, source_id,
                              CASE WHEN source_kind = 'learning_context'
                                THEN resource_id ELSE '' END
                 ORDER BY ranking_score DESC, id
               ) AS source_chunk_rank
        FROM ranked
      ),
      best_chunks AS (
        SELECT *
        FROM source_ranked
        WHERE source_chunk_rank = 1
      ),
      audience_ranked AS (
        SELECT best_chunks.*,
               row_number() OVER (
                 PARTITION BY visibility
                 ORDER BY ranking_score DESC, id
               ) AS audience_rank
        FROM best_chunks
      ),
      private_count AS (
        SELECT LEAST(count(*)::integer, ${parameters.limit}::integer) AS value
        FROM audience_ranked
        WHERE visibility = 'private'
      ),
      selected AS (
        SELECT *
        FROM audience_ranked
        WHERE visibility = 'private'
          AND audience_rank <= ${parameters.limit}
        UNION ALL
        SELECT *
        FROM audience_ranked
        WHERE visibility = 'public'
          AND audience_rank <= GREATEST(
            0,
            ${parameters.limit} - (SELECT value FROM private_count)
          )
      )
      SELECT source_kind AS "sourceKind",
             source_id::text AS "sourceId",
             visibility,
             title,
             content,
             source_url AS "sourceUrl",
             start_seconds AS "timestampSeconds",
             end_seconds AS "endSeconds",
             resource_id AS "resourceId",
             readiness,
             artifact_generation AS "artifactGeneration",
             ranking_score AS "rankingScore"
      FROM selected
      ORDER BY CASE visibility WHEN 'private' THEN 0 ELSE 1 END,
               ranking_score DESC,
               id
    `,
    values,
  };
}

function modalityCandidates(
  modality: 'lexical' | 'vector',
  parameters: SearchParameters,
): string {
  return (['private', 'public'] as const)
    .map((audience) => {
      const direction = modality === 'lexical' ? 'DESC' : 'ASC';
      const prefix = `${modality}_${audience}`;
      return `
        ${prefix}_pool AS MATERIALIZED (
          SELECT * FROM (
            ${candidateBranch(modality, audience, 'post', parameters)}
          ) AS post_candidates
          UNION ALL
          SELECT * FROM (
            ${candidateBranch(modality, audience, 'course_step', parameters)}
          ) AS course_step_candidates
          ${
            audience === 'private' && parameters.contextSnapshot
              ? `UNION ALL
          SELECT * FROM (
            ${learningContextCandidateBranch(modality, parameters)}
          ) AS learning_context_candidates`
              : ''
          }
        ),
        ${prefix} AS MATERIALIZED (
          SELECT limited.*,
                 row_number() OVER (
                   ORDER BY modality_metric ${direction}, id
                 ) AS ${modality}_rank
          FROM (
            SELECT *
            FROM ${prefix}_pool
            ORDER BY modality_metric ${direction}, id
            LIMIT ${parameters.candidateLimit}
          ) AS limited
        )`;
    })
    .concat(
      `${modality}_all AS (
        SELECT * FROM ${modality}_private
        UNION ALL
        SELECT * FROM ${modality}_public
      )`,
    )
    .join(',\n');
}

function candidateBranch(
  modality: 'lexical' | 'vector',
  audience: RetrievalVisibility,
  sourceKind: RetrievalSourceKind,
  parameters: SearchParameters,
): string {
  const metric =
    modality === 'lexical'
      ? `similarity(retrieval.content, ${required(parameters.query)})`
      : `retrieval.embedding <=> ${required(parameters.embedding)}::vector`;
  const filter =
    modality === 'lexical'
      ? `retrieval.content % ${required(parameters.query)}
         AND ${metric} >= ${required(parameters.lexicalThreshold)}::real`
      : `${metric} <= ${required(parameters.vectorMaxDistance)}::double precision`;
  const direction = modality === 'lexical' ? 'DESC' : 'ASC';
  const candidateTieBreaker = modality === 'lexical' ? ', retrieval.id' : '';
  const audienceFilter =
    audience === 'private'
      ? `retrieval.visibility = 'private'
         AND retrieval.owner_id = ${parameters.owner}`
      : `retrieval.visibility = 'public'`;

  if (sourceKind === 'post') {
    return `
      SELECT retrieval.id,
             retrieval.source_kind,
             retrieval.source_id,
             retrieval.visibility,
             post.title,
             retrieval.content,
             retrieval.source_url,
             retrieval.start_seconds,
             retrieval.end_seconds,
             NULL::text AS resource_id,
             NULL::text AS readiness,
             NULL::integer AS artifact_generation,
             ${metric} AS modality_metric
      FROM retrieval_embeddings AS retrieval
      JOIN posts AS post
        ON post.id = retrieval.source_id
       AND post.author_id = retrieval.owner_id
       AND post.retrieval_version = retrieval.source_version
      CROSS JOIN settings
      WHERE retrieval.source_kind = 'post'
        AND retrieval.model = ${parameters.model}
        AND ${audienceFilter}
        AND ${filter}
      ORDER BY ${metric} ${direction}${candidateTieBreaker}
      LIMIT ${parameters.candidateLimit}
    `;
  }

  const courseAccess =
    audience === 'private'
      ? `course.status = 'draft'
         AND course.visibility = 'private'
         AND course.owner_id = ${parameters.owner}`
      : `course.status = 'published'
         AND course.visibility = 'public'`;
  return `
    SELECT retrieval.id,
           retrieval.source_kind,
           retrieval.source_id,
           retrieval.visibility,
           step.title_snapshot AS title,
           retrieval.content,
           retrieval.source_url,
           retrieval.start_seconds,
           retrieval.end_seconds,
           NULL::text AS resource_id,
           NULL::text AS readiness,
           NULL::integer AS artifact_generation,
           ${metric} AS modality_metric
    FROM retrieval_embeddings AS retrieval
    JOIN course_steps AS step
      ON step.id = retrieval.source_id
    JOIN courses AS course
      ON course.id = step.course_id
     AND course.owner_id = retrieval.owner_id
     AND course.version = retrieval.source_version
    CROSS JOIN settings
    WHERE retrieval.source_kind = 'course_step'
      AND retrieval.model = ${parameters.model}
      AND ${audienceFilter}
      AND ${courseAccess}
      AND ${filter}
    ORDER BY ${metric} ${direction}${candidateTieBreaker}
    LIMIT ${parameters.candidateLimit}
  `;
}

function learningContextCandidateBranch(
  modality: 'lexical' | 'vector',
  parameters: SearchParameters,
): string {
  const metric =
    modality === 'lexical'
      ? `similarity(retrieval.content, ${required(parameters.query)})`
      : `retrieval.embedding <=> ${required(parameters.embedding)}::vector`;
  const filter =
    modality === 'lexical'
      ? `retrieval.content % ${required(parameters.query)}
         AND ${metric} >= ${required(parameters.lexicalThreshold)}::real`
      : `${metric} <= ${required(parameters.vectorMaxDistance)}::double precision`;
  const direction = modality === 'lexical' ? 'DESC' : 'ASC';
  const candidateTieBreaker = modality === 'lexical' ? ', retrieval.id' : '';
  return `
    SELECT retrieval.id,
           retrieval.source_kind,
           retrieval.source_id,
           retrieval.visibility,
           COALESCE(source.metadata->>'title', source.canonical_video_id) AS title,
           retrieval.content,
           retrieval.source_url,
           retrieval.start_seconds,
           retrieval.end_seconds,
           retrieval.resource_id,
           retrieval.readiness,
           retrieval.artifact_generation,
           ${metric} AS modality_metric
    FROM retrieval_embeddings AS retrieval
    JOIN learning_retrieval_context_snapshots AS snapshot
      ON snapshot.agent_run_id = ${required(parameters.contextSnapshot)}::uuid
     AND snapshot.owner_id = ${parameters.owner}
     AND snapshot.study_context_id = retrieval.source_id
     AND snapshot.context_retrieval_version = retrieval.source_version
    JOIN study_contexts AS context
      ON context.id = retrieval.source_id
     AND context.user_id = snapshot.owner_id
     AND snapshot.learning_item_id = context.learning_item_id
    JOIN learning_items AS item
      ON item.id = context.learning_item_id
     AND item.user_id = snapshot.owner_id
     AND item.video_source_id = snapshot.video_source_id
    JOIN video_sources AS source ON source.id = item.video_source_id
    CROSS JOIN settings
    WHERE retrieval.source_kind = 'learning_context'
      AND retrieval.visibility = 'private'
      AND retrieval.owner_id = ${parameters.owner}
      AND retrieval.model = ${parameters.model}
      AND snapshot.caption_generation = retrieval.artifact_generation
      AND (
        retrieval.evidence_kind <> 'caption_segment'
        OR snapshot.caption_artifact_id = retrieval.evidence_artifact_id
      )
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(snapshot.watched_ranges) AS watched(value)
        WHERE (watched.value->>'start')::numeric < retrieval.end_seconds
          AND retrieval.start_seconds < (watched.value->>'end')::numeric
      )
      AND ${filter}
    ORDER BY ${metric} ${direction}${candidateTieBreaker}
    LIMIT ${parameters.candidateLimit}
  `;
}

function singleModalityRanked(mode: 'lexical' | 'vector'): string {
  const score =
    mode === 'lexical' ? 'modality_metric' : '1.0 - modality_metric';
  return `ranked AS (
    SELECT ${mode}_all.*,
           ${score} AS ranking_score
    FROM ${mode}_all
  )`;
}

function hybridRanked(parameters: SearchParameters): string {
  return `ranked AS (
    SELECT COALESCE(lexical.id, vector.id) AS id,
           COALESCE(lexical.source_kind, vector.source_kind) AS source_kind,
           COALESCE(lexical.source_id, vector.source_id) AS source_id,
           COALESCE(lexical.visibility, vector.visibility) AS visibility,
           COALESCE(lexical.title, vector.title) AS title,
           COALESCE(lexical.content, vector.content) AS content,
           COALESCE(lexical.source_url, vector.source_url) AS source_url,
           COALESCE(lexical.start_seconds, vector.start_seconds) AS start_seconds,
           COALESCE(lexical.end_seconds, vector.end_seconds) AS end_seconds,
           COALESCE(lexical.resource_id, vector.resource_id) AS resource_id,
           COALESCE(lexical.readiness, vector.readiness) AS readiness,
           COALESCE(lexical.artifact_generation, vector.artifact_generation) AS artifact_generation,
           COALESCE(
             1.0 / (${required(parameters.rrfK)}::numeric + lexical.lexical_rank),
             0
           ) + COALESCE(
             1.0 / (${required(parameters.rrfK)}::numeric + vector.vector_rank),
             0
           ) AS ranking_score
    FROM lexical_all AS lexical
    FULL JOIN vector_all AS vector USING (id)
  )`;
}

function required(value: string | undefined): string {
  if (!value) {
    throw new RetrievalSourceInvariantError(
      'Retrieval search parameter mapping is incomplete',
    );
  }
  return value;
}
