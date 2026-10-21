// 평가용 진단: 거리 임계값 없이 질문별 가장 가까운 자료와 거리를 출력한다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { requireEvaluationDatabaseUrl } from './eval-database';

async function main() {
  const pool = new Pool({ connectionString: requireEvaluationDatabaseUrl() });
  const aiServiceUrl = (
    process.env.AI_SERVICE_URL ?? 'http://127.0.0.1:8000'
  ).replace(/\/$/u, '');
  const dataset = JSON.parse(
    readFileSync(
      join(process.cwd(), 'evaluation', 'retrieval-judgments.ko.json'),
      'utf8',
    ),
  ) as {
    queries: Array<{
      id: string;
      query: string;
      relevant: Array<{ sourceKey: string }>;
    }>;
  };
  try {
    const counts = await pool.query(
      `SELECT source_kind, visibility, count(*)::int AS n, count(DISTINCT source_id)::int AS sources,
              count(*) FILTER (WHERE start_seconds IS NOT NULL)::int AS with_time
       FROM retrieval_embeddings GROUP BY 1, 2`,
    );
    console.log('chunks', JSON.stringify(counts.rows));
    for (const q of dataset.queries) {
      const response = await fetch(`${aiServiceUrl}/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: q.query }),
      });
      const body = (await response.json()) as { embedding: number[] };
      const vector = `[${body.embedding.join(',')}]`;
      const near = await pool.query<{ id: string; d: string }>(
        `SELECT source_id::text AS id, round((embedding <=> $1::vector)::numeric, 3) AS d
         FROM retrieval_embeddings ORDER BY embedding <=> $1::vector LIMIT 5`,
        [vector],
      );
      const lex = await pool.query<{ id: string; s: string }>(
        `SELECT source_id::text AS id, round(similarity(content, $1)::numeric, 3) AS s
         FROM retrieval_embeddings ORDER BY similarity(content, $1) DESC LIMIT 3`,
        [q.query],
      );
      console.log(
        q.id,
        'want',
        q.relevant.map((r) => r.sourceKey).join(','),
        '| vector',
        near.rows.map((r) => `${r.id}:${r.d}`).join(' '),
        '| lexical',
        lex.rows.map((r) => `${r.id}:${r.s}`).join(' '),
      );
    }
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
