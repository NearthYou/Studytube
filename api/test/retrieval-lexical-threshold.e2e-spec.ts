import { Pool } from 'pg';
import { PostgresRetrievalRepository } from '../src/retrieval/postgres-retrieval.repository';
import { RETRIEVAL_LEXICAL_MIN_SIMILARITY } from '../src/retrieval/retrieval.constants';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://app:app@127.0.0.1:5432/app_dev';
const MODEL = 'text-embedding-3-small';
const OWNER_ID = 2_130_000_001;
const POST_ID = 2_130_001_001;
const QUERY = '수면 부족이 학습과 건강에 미치는 영향';
const CONTENT = '수면 과학 강의: 잠이 부족하면 기억과 건강이 어떻게 무너지는가';
// pg_trgm 기본 임계값(0.3)보다 낮고 서비스 임계값보다 높은 유사도
const DEFAULT_TRGM_THRESHOLD = 0.3;

describe('lexical retrieval threshold (e2e)', () => {
  jest.setTimeout(30_000);

  it('applies the configured trigram threshold before scanning candidates', async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const repository = new PostgresRetrievalRepository(pool);
    try {
      const similarity = await pool.query<{ value: number }>(
        'SELECT similarity($1, $2) AS value',
        [CONTENT, QUERY],
      );
      const value = Number(similarity.rows[0]?.value);
      expect(value).toBeGreaterThanOrEqual(RETRIEVAL_LEXICAL_MIN_SIMILARITY);
      expect(value).toBeLessThan(DEFAULT_TRGM_THRESHOLD);

      await seedOwnerAndPost(pool, repository);

      for (const mode of ['lexical', 'hybrid'] as const) {
        const hits = await repository.search(
          {
            ownerId: OWNER_ID,
            query: QUERY,
            model: MODEL,
            embedding: Array<number>(1536).fill(0.01),
            limit: 5,
          },
          mode,
        );
        expect(hits.map((hit) => hit.sourceId)).toContain(String(POST_ID));
      }
    } finally {
      await pool.query('DELETE FROM posts WHERE id = $1', [POST_ID]);
      await pool.query('DELETE FROM users WHERE id = $1', [OWNER_ID]);
      await pool.end();
    }
  });
});

async function seedOwnerAndPost(
  pool: Pool,
  repository: PostgresRetrievalRepository,
): Promise<void> {
  await pool.query(
    `
      INSERT INTO users (
        id, name, email, email_canonical, password_hash,
        password_algorithm, password_parameters, password_version,
        identity_assurance
      )
      VALUES (
        $1, 'Lexical threshold fixture',
        'lexical-threshold@example.test', 'lexical-threshold@example.test',
        $2, 'legacy_sha256', $3, 1, 'legacy_grandfathered'
      )
    `,
    [OWNER_ID, 'a'.repeat(64), { digest: 'sha256', encoding: 'lower_hex' }],
  );
  await pool.query(
    `
      INSERT INTO posts (
        id, author_id, title, video_url, thumbnail_url, channel_name,
        summary, translated_notes
      )
      VALUES ($1, $2, '수면 과학', $3, '', 'StudyTube', '', '')
    `,
    [POST_ID, OWNER_ID, `https://youtu.be/lexical-threshold-${POST_ID}`],
  );
  const snapshot = await repository.readSourceSnapshot({
    sourceKind: 'post',
    sourceId: POST_ID,
  });
  if (!snapshot) {
    throw new Error('Lexical threshold fixture post was not readable');
  }
  await repository.replaceSourceChunks({
    sourceKind: 'post',
    sourceId: POST_ID,
    sourceVersion: snapshot.sourceVersion,
    ownerId: OWNER_ID,
    visibility: 'public',
    model: MODEL,
    chunks: [
      {
        chunkIndex: 0,
        content: CONTENT,
        startSeconds: 120,
        endSeconds: 150,
        sourceUrl: `https://youtu.be/lexical-threshold-${POST_ID}?t=120s`,
        embedding: Array<number>(1536).fill(0.02),
      },
    ],
  });
}
