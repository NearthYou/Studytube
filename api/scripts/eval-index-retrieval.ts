// 평가용: 데모 게시글을 실제 RetrievalEmbeddingJobHandler로 색인한다.
import { Pool } from 'pg';
import { PostgresRetrievalRepository } from '../src/retrieval/postgres-retrieval.repository';
import { RetrievalEmbeddingJobHandler } from '../src/retrieval/retrieval-embedding.worker';
import type { EmbeddingResponse } from '../src/retrieval/retrieval.types';
import { requireEvaluationDatabaseUrl } from './eval-database';

async function main() {
  const pool = new Pool({ connectionString: requireEvaluationDatabaseUrl() });
  const repository = new PostgresRetrievalRepository(pool);
  const aiServiceUrl = (
    process.env.AI_SERVICE_URL ?? 'http://127.0.0.1:8000'
  ).replace(/\/$/u, '');
  const embeddings = {
    async embedding(input: { input: string }): Promise<EmbeddingResponse> {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
      };
      if (process.env.INTERNAL_AI_API_KEY)
        headers['x-internal-api-key'] = process.env.INTERNAL_AI_API_KEY;
      const response = await fetch(`${aiServiceUrl}/embeddings`, {
        method: 'POST',
        headers,
        body: JSON.stringify(input),
      });
      if (!response.ok)
        throw new Error(
          `embedding HTTP ${response.status}: ${await response.text()}`,
        );
      return (await response.json()) as EmbeddingResponse;
    },
  };
  const executor = {
    execute: (
      _ctx: unknown,
      run: (signal: AbortSignal) => Promise<Record<string, unknown>>,
    ) => run(new AbortController().signal),
  };
  const handler = new RetrievalEmbeddingJobHandler(
    embeddings,
    repository,
    executor as never,
  );
  const { rows } = await pool.query<{ id: string }>(
    'SELECT id::text FROM posts ORDER BY id',
  );
  try {
    for (const row of rows) {
      const result = await handler.handle({
        eventId: `eval-${row.id}`,
        eventType: 'retrieval_embedding.requested',
        handlerVersion: 1,
        payloadSchemaVersion: 1,
        payload: { sourceKind: 'post', sourceId: row.id },
      } as never);
      process.stdout.write(`post:${row.id} ${JSON.stringify(result)}\n`);
    }
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `index failed: ${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
