import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Pool } from 'pg';
import {
  summarizeRetrievalEvaluation,
  type EmbeddingProbe,
  type RetrievalEvaluationMode,
  type RetrievalEvaluationQuery,
} from '../src/evaluation/retrieval-evaluation';
import { PostgresRetrievalRepository } from '../src/retrieval/postgres-retrieval.repository';
import { RETRIEVAL_TUNING } from '../src/retrieval/retrieval.constants';
import type { EmbeddingResponse } from '../src/retrieval/retrieval.types';

type Judgment = {
  id: string;
  query: string;
  relevant: Array<{
    sourceKey: string;
    minTimestampSeconds?: number;
    maxTimestampSeconds?: number;
  }>;
};

const modes: RetrievalEvaluationMode[] = ['lexical', 'vector', 'hybrid'];

async function main() {
  const ownerId = positiveInteger(process.env.RETRIEVAL_EVAL_OWNER_ID);
  if (ownerId === null) {
    throw new Error('RETRIEVAL_EVAL_OWNER_ID must be a positive integer');
  }
  const databaseUrl = requireEnvironment('DATABASE_URL');
  const aiServiceUrl = (
    process.env.AI_SERVICE_URL ?? 'http://127.0.0.1:8000'
  ).replace(/\/$/u, '');
  const datasetPath = resolve(
    process.env.RETRIEVAL_EVAL_DATASET ??
      join(process.cwd(), 'evaluation', 'retrieval-judgments.ko.json'),
  );
  const datasetBody = await readFile(datasetPath, 'utf8');
  const judgments = parseJudgments(JSON.parse(datasetBody) as unknown);
  const pool = new Pool({ connectionString: databaseUrl });
  const repository = new PostgresRetrievalRepository(pool);
  const queries: RetrievalEvaluationQuery[] = [];

  try {
    for (const judgment of judgments) {
      const first = await embeddingProbe(aiServiceUrl, judgment.query);
      const warm = await embeddingProbe(aiServiceUrl, judgment.query);
      const modeResults = {} as RetrievalEvaluationQuery['modes'];

      for (const mode of modes) {
        const startedAt = performance.now();
        const hits = await repository.search(
          {
            ownerId,
            query: judgment.query,
            model: first.response.model,
            embedding: first.response.embedding,
            limit: 5,
          },
          mode,
        );
        modeResults[mode] = {
          latencyMs: performance.now() - startedAt,
          hits: hits.map((hit) => ({
            sourceKey: `${hit.sourceKind}:${hit.sourceId}`,
            citation: hit.citation,
          })),
        };
      }

      queries.push({
        id: judgment.id,
        relevant: judgment.relevant,
        embeddingProbes: [first.probe, warm.probe],
        modes: modeResults,
      });
    }
  } finally {
    await pool.end();
  }

  const summary = summarizeRetrievalEvaluation({
    datasetHash: createHash('sha256').update(datasetBody, 'utf8').digest('hex'),
    model: 'text-embedding-3-small',
    tuning: RETRIEVAL_TUNING,
    queries,
  });
  const generatedAt = new Date().toISOString();
  const report = {
    ...summary,
    generatedAt,
    gitSha: currentGitSha(),
    datasetPath: evidenceDatasetPath(datasetPath, process.cwd()),
    queries,
  };
  const outputPath = resolve(
    process.env.RETRIEVAL_EVAL_REPORT_PATH ??
      join(process.cwd(), '.ci-artifacts', 'retrieval-evaluation.json'),
  );
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  process.stdout.write(
    `${JSON.stringify({ outputPath, ...summary }, null, 2)}\n`,
  );
  if (
    !summary.baselineImproved &&
    process.env.RETRIEVAL_EVAL_ALLOW_NO_IMPROVEMENT !== '1'
  ) {
    throw new Error(
      'Hybrid retrieval did not improve the fixed lexical baseline; inspect the report before changing tuning constants',
    );
  }
}

async function embeddingProbe(
  aiServiceUrl: string,
  input: string,
): Promise<{ response: EmbeddingResponse; probe: EmbeddingProbe }> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  const internalKey = process.env.INTERNAL_AI_API_KEY;
  if (internalKey) {
    headers['x-internal-api-key'] = internalKey;
  }
  const startedAt = performance.now();
  const response = await fetch(`${aiServiceUrl}/embeddings`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ input }),
    signal: AbortSignal.timeout(20_000),
  });
  const latencyMs = performance.now() - startedAt;
  if (!response.ok) {
    throw new Error(`Embedding probe failed with HTTP ${response.status}`);
  }
  const body: unknown = await response.json();
  if (!isEmbeddingResponse(body)) {
    throw new Error('Embedding probe returned an invalid response contract');
  }
  return {
    response: body,
    probe: {
      latencyMs,
      cacheHit: body.cacheHit === true,
      inputTokens: body.inputTokens ?? 0,
      costUsd: body.estimatedCostUsd ?? 0,
    },
  };
}

function parseJudgments(value: unknown): Judgment[] {
  if (!isRecord(value) || !Array.isArray(value.queries)) {
    throw new Error('Retrieval judgment dataset must contain a queries array');
  }
  return value.queries.map((query, index) => {
    if (
      !isRecord(query) ||
      typeof query.id !== 'string' ||
      typeof query.query !== 'string' ||
      !Array.isArray(query.relevant) ||
      query.relevant.length === 0
    ) {
      throw new Error(`Invalid retrieval judgment at index ${index}`);
    }
    return {
      id: query.id,
      query: query.query,
      relevant: query.relevant.map((judgment) => {
        if (!isRecord(judgment) || typeof judgment.sourceKey !== 'string') {
          throw new Error(`Invalid relevance judgment for ${String(query.id)}`);
        }
        return {
          sourceKey: judgment.sourceKey,
          minTimestampSeconds: optionalFiniteNumber(
            judgment.minTimestampSeconds,
          ),
          maxTimestampSeconds: optionalFiniteNumber(
            judgment.maxTimestampSeconds,
          ),
        };
      }),
    };
  });
}

function isEmbeddingResponse(value: unknown): value is EmbeddingResponse {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.model === 'text-embedding-3-small' &&
    value.dimensions === 1536 &&
    Array.isArray(value.embedding) &&
    value.embedding.length === 1536 &&
    value.embedding.every(
      (dimension) =>
        typeof dimension === 'number' && Number.isFinite(dimension),
    ) &&
    (value.cacheHit === undefined || typeof value.cacheHit === 'boolean') &&
    (value.inputTokens === undefined || Number.isFinite(value.inputTokens)) &&
    (value.estimatedCostUsd === undefined ||
      Number.isFinite(value.estimatedCostUsd))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function positiveInteger(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function evidenceDatasetPath(datasetPath: string, repositoryPath: string) {
  const repositoryRelativePath = relative(repositoryPath, datasetPath);
  if (
    repositoryRelativePath === '' ||
    repositoryRelativePath === '..' ||
    repositoryRelativePath.startsWith('..\\') ||
    repositoryRelativePath.startsWith('../') ||
    resolve(repositoryPath, repositoryRelativePath) !== resolve(datasetPath)
  ) {
    return 'external-dataset';
  }
  return repositoryRelativePath.replaceAll('\\', '/');
}

function currentGitSha(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Retrieval evaluation failed: ${message}\n`);
  process.exitCode = 1;
});
