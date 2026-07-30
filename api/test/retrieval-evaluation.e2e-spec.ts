import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { PostgresRetrievalRepository } from '../src/retrieval/postgres-retrieval.repository';

const execFileAsync = promisify(execFile);
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://app:app@127.0.0.1:5432/app_dev';
const MODEL = 'text-embedding-3-small';
const OWNER_ID = 2_140_000_001;
const POST_IDS = [
  2_140_001_001, 2_140_001_002, 2_140_001_003, 2_140_001_004,
] as const;
const QUERIES = [
  '리액트 상태 생명주기 훅',
  '데이터베이스 조인 인덱스',
] as const;
const API_ROOT = resolve(__dirname, '..');
const REPORT_PATH = join(
  API_ROOT,
  '.ci-artifacts',
  'retrieval-evaluation.json',
);

type RetrievalEvaluationReport = {
  schemaVersion: number;
  datasetPath: string;
  queryCount: number;
  quality: Record<
    'lexical' | 'vector' | 'hybrid',
    {
      recallAt3: number;
      mrr: number;
      ndcgAt5: number;
      citationCoverage: number;
      retrievalP95Ms: number;
    }
  >;
  embedding: {
    probeCount: number;
    cacheHitRate: number;
    inputTokens: number;
    estimatedCostUsd: number;
    p95Ms: number;
  };
  baselineImproved: boolean;
};

describe('retrieval evaluation CLI (e2e)', () => {
  jest.setTimeout(45_000);

  it('evaluates real lexical, vector, and hybrid PostgreSQL search without a paid embedding provider', async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const repository = new PostgresRetrievalRepository(pool);
    const embeddingServer = deterministicEmbeddingServer();
    let fixtureCreated = false;

    try {
      await assertReservedIdsAreFree(pool);
      await seedOwner(pool);
      fixtureCreated = true;
      await seedSources(pool, repository);
      const aiServiceUrl = await listen(embeddingServer.server);
      await rm(REPORT_PATH, { force: true });

      const execution = await execFileAsync(
        process.execPath,
        [
          require.resolve('ts-node/dist/bin.js'),
          'scripts/evaluate-retrieval.ts',
        ],
        {
          cwd: API_ROOT,
          env: {
            ...process.env,
            DATABASE_URL,
            AI_SERVICE_URL: aiServiceUrl,
            INTERNAL_AI_API_KEY: '',
            RETRIEVAL_EVAL_OWNER_ID: String(OWNER_ID),
            RETRIEVAL_EVAL_DATASET: 'evaluation/retrieval-ci-judgments.ko.json',
          },
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
        },
      );

      expect(execution.stderr).toBe('');
      const report = JSON.parse(
        await readFile(REPORT_PATH, 'utf8'),
      ) as RetrievalEvaluationReport;
      expect(report).toMatchObject({
        schemaVersion: 1,
        datasetPath: 'evaluation/retrieval-ci-judgments.ko.json',
        queryCount: 2,
        baselineImproved: true,
        embedding: {
          probeCount: 4,
          cacheHitRate: 0.5,
          inputTokens: 12,
          estimatedCostUsd: 0,
        },
      });
      expect(report.quality.lexical).toMatchObject({
        recallAt3: 0,
        mrr: 0,
        ndcgAt5: 0,
        citationCoverage: 0,
      });
      expect(report.quality.vector).toMatchObject({
        recallAt3: 1,
        mrr: 1,
        ndcgAt5: 1,
        citationCoverage: 1,
      });
      expect(report.quality.hybrid).toMatchObject({
        recallAt3: 1,
        mrr: 1,
        ndcgAt5: 1,
        citationCoverage: 1,
      });
      expect(report.embedding.p95Ms).toBeGreaterThan(0);
      for (const mode of ['lexical', 'vector', 'hybrid'] as const) {
        expect(report.quality[mode].retrievalP95Ms).toBeGreaterThan(0);
      }
      expect(embeddingServer.requests).toEqual([
        { input: QUERIES[0], cacheHit: false, receivedInternalKey: false },
        { input: QUERIES[0], cacheHit: true, receivedInternalKey: false },
        { input: QUERIES[1], cacheHit: false, receivedInternalKey: false },
        { input: QUERIES[1], cacheHit: true, receivedInternalKey: false },
      ]);

      const serialized = JSON.stringify(report);
      expect(serialized).not.toContain(API_ROOT);
      expect(serialized).not.toContain(DATABASE_URL);
    } finally {
      await close(embeddingServer.server);
      if (fixtureCreated) {
        await pool.query('DELETE FROM users WHERE id = $1', [OWNER_ID]);
      }
      await pool.end();
    }
  });
});

async function assertReservedIdsAreFree(pool: Pool): Promise<void> {
  const result = await pool.query<{ count: number }>(
    `
      SELECT (
        (SELECT count(*) FROM users WHERE id = $1)
        + (SELECT count(*) FROM posts WHERE id = ANY($2::integer[]))
      )::integer AS count
    `,
    [OWNER_ID, [...POST_IDS]],
  );
  if (result.rows[0]?.count !== 0) {
    throw new Error('Reserved retrieval evaluation fixture IDs are occupied');
  }
}

async function seedOwner(pool: Pool): Promise<void> {
  await pool.query(
    `
      INSERT INTO users (
        id,
        name,
        email,
        email_canonical,
        password_hash,
        password_algorithm,
        password_parameters,
        password_version,
        identity_assurance
      )
      VALUES (
        $1,
        'Retrieval evaluation fixture',
        'retrieval-evaluation@example.test',
        'retrieval-evaluation@example.test',
        $2,
        'legacy_sha256',
        $3,
        1,
        'legacy_grandfathered'
      )
    `,
    [OWNER_ID, 'a'.repeat(64), { digest: 'sha256', encoding: 'lower_hex' }],
  );
}

async function seedSources(
  pool: Pool,
  repository: PostgresRetrievalRepository,
): Promise<void> {
  const sources = [
    {
      id: POST_IDS[0],
      title: '컴포넌트 변화 흐름',
      content: '컴포넌트의 변화 흐름을 관리하는 실전 강의',
      timestampSeconds: 30,
      embedding: unitVector(0),
    },
    {
      id: POST_IDS[1],
      title: QUERIES[0],
      content: QUERIES[0],
      timestampSeconds: 15,
      embedding: unitVector(2),
    },
    {
      id: POST_IDS[2],
      title: '여러 표를 빠르게 연결하기',
      content: '여러 표를 빠르게 연결하는 실전 수업',
      timestampSeconds: 45,
      embedding: unitVector(1),
    },
    {
      id: POST_IDS[3],
      title: QUERIES[1],
      content: QUERIES[1],
      timestampSeconds: 20,
      embedding: unitVector(3),
    },
  ] as const;

  for (const source of sources) {
    await pool.query(
      `
        INSERT INTO posts (
          id,
          author_id,
          title,
          video_url,
          thumbnail_url,
          channel_name,
          summary,
          translated_notes
        )
        VALUES ($1, $2, $3, $4, '', 'StudyTube', '', '')
      `,
      [
        source.id,
        OWNER_ID,
        source.title,
        `https://youtu.be/retrieval-evaluation-${source.id}`,
      ],
    );
    const snapshot = await repository.readSourceSnapshot({
      sourceKind: 'post',
      sourceId: source.id,
    });
    if (!snapshot) {
      throw new Error(`Retrieval fixture post ${source.id} was not readable`);
    }
    await repository.replaceSourceChunks({
      sourceKind: 'post',
      sourceId: source.id,
      sourceVersion: snapshot.sourceVersion,
      ownerId: OWNER_ID,
      visibility: 'public',
      model: MODEL,
      chunks: [
        {
          chunkIndex: 0,
          content: source.content,
          startSeconds: source.timestampSeconds,
          endSeconds: source.timestampSeconds + 10,
          sourceUrl: `https://youtu.be/retrieval-evaluation-${source.id}?t=${source.timestampSeconds}s`,
          embedding: source.embedding,
        },
      ],
    });
  }
}

function deterministicEmbeddingServer() {
  const counts = new Map<string, number>();
  const requests: Array<{
    input: string;
    cacheHit: boolean;
    receivedInternalKey: boolean;
  }> = [];
  const server = createServer((request, response) => {
    const body: Buffer[] = [];
    request.on('data', (chunk: Buffer) => body.push(chunk));
    request.on('end', () => {
      const input = readEmbeddingInput(Buffer.concat(body).toString('utf8'));
      const queryIndex = QUERIES.indexOf(input as (typeof QUERIES)[number]);
      if (
        request.method !== 'POST' ||
        request.url !== '/embeddings' ||
        queryIndex < 0
      ) {
        response.writeHead(400).end();
        return;
      }
      const previousCount = counts.get(input) ?? 0;
      const cacheHit = previousCount > 0;
      counts.set(input, previousCount + 1);
      requests.push({
        input,
        cacheHit,
        receivedInternalKey:
          request.headers['x-internal-api-key'] !== undefined,
      });
      response.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          model: MODEL,
          dimensions: 1536,
          embedding: unitVector(queryIndex),
          cacheHit,
          inputTokens: cacheHit ? 0 : 6,
          estimatedCostUsd: 0,
        }),
      );
    });
  });
  return { server, requests };
}

function readEmbeddingInput(body: string): string {
  const value: unknown = JSON.parse(body);
  if (
    typeof value !== 'object' ||
    value === null ||
    !('input' in value) ||
    typeof value.input !== 'string'
  ) {
    return '';
  }
  return value.input;
}

function unitVector(index: number): number[] {
  return Array.from({ length: 1536 }, (_unused, dimension) =>
    dimension === index ? 1 : 0,
  );
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Deterministic embedding server did not bind to TCP');
  }
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
}
