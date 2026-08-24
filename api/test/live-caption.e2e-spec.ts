import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PostgresLiveCaptionRepository } from '../src/postgres-live-caption.repository';
import { deterministicWorkUuid } from '../src/work/deterministic-work-id';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://app:app@localhost:5432/app_dev';

describe('browser live captions (e2e)', () => {
  let pool: Pool;
  let repository: PostgresLiveCaptionRepository;
  let userId = 0;
  let sourceId = '';
  let contextId = '';
  let outboxEventId = '';

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    repository = new PostgresLiveCaptionRepository(pool);
    const email = `live-caption-${randomUUID()}@example.test`;
    const user = await pool.query<{ id: number }>(
      `INSERT INTO users (
         name, email, email_canonical, password_hash, password_algorithm,
         password_parameters, password_version, identity_assurance
       ) VALUES ('Live caption owner', $1, $1, repeat('a', 64),
                 'legacy_sha256',
                 '{"digest":"sha256","encoding":"lower_hex"}'::jsonb,
                 1, 'legacy_grandfathered') RETURNING id`,
      [email],
    );
    userId = user.rows[0]?.id ?? 0;
    const source = await pool.query<{ id: string }>(
      `INSERT INTO video_sources (provider, canonical_video_id, canonical_url)
       VALUES ('youtube', $1, $2) RETURNING id::text AS id`,
      [
        `live${randomUUID().replaceAll('-', '').slice(0, 7)}`,
        'https://youtu.be/test',
      ],
    );
    sourceId = source.rows[0]?.id ?? '';
    const item = await pool.query<{ id: string }>(
      `INSERT INTO learning_items (user_id, video_source_id)
       VALUES ($1, $2) RETURNING id::text AS id`,
      [userId, sourceId],
    );
    const context = await pool.query<{ id: string }>(
      `INSERT INTO study_contexts (user_id, learning_item_id, kind)
       VALUES ($1, $2, 'standalone') RETURNING id::text AS id`,
      [userId, item.rows[0]?.id],
    );
    contextId = context.rows[0]?.id ?? '';
  });

  afterAll(async () => {
    if (outboxEventId) {
      await pool.query('DELETE FROM work_outbox_events WHERE id = $1', [
        outboxEventId,
      ]);
    }
    if (sourceId) {
      await pool.query(
        'UPDATE video_sources SET current_source_caption_artifact_id = NULL WHERE id = $1',
        [sourceId],
      );
    }
    if (userId) await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    if (sourceId) {
      await pool.query(
        'DELETE FROM caption_artifacts WHERE video_source_id = $1',
        [sourceId],
      );
      await pool.query('DELETE FROM video_sources WHERE id = $1', [sourceId]);
    }
    await pool.end();
  });

  it('stores chunks idempotently and publishes them to the learning context', async () => {
    const sessionId = randomUUID();
    outboxEventId = deterministicWorkUuid(
      sessionId,
      `retrieval_embedding.learning_context.${contextId}.2`,
    );
    const first = {
      userId,
      contextId,
      sessionId,
      ordinal: 0,
      startSeconds: 0,
      endSeconds: 8,
      sourceLanguage: 'en',
      source: 'Containers share the host kernel.',
      korean: '컨테이너는 호스트 커널을 공유합니다.',
    };
    await repository.appendChunk(first);
    await repository.appendChunk(first);
    await repository.appendChunk({
      ...first,
      ordinal: 1,
      startSeconds: 8,
      endSeconds: 16,
      source: 'Images are immutable.',
      korean: '이미지는 변경되지 않습니다.',
    });

    await expect(
      repository.findChunk({ userId, contextId, sessionId, ordinal: 0 }),
    ).resolves.toMatchObject({
      source: first.source,
      korean: first.korean,
    });
    await expect(
      repository.findChunk({
        userId: userId + 1,
        contextId,
        sessionId,
        ordinal: 0,
      }),
    ).resolves.toBeNull();
    await expect(
      repository.finalize({ userId, contextId, sessionId }),
    ).resolves.toBe(true);

    const saved = await pool.query<{
      sourceStatus: string;
      translationStatus: string;
      sourceSegments: number;
      translationSegments: number;
      retrievalVersion: string;
    }>(
      `SELECT source_state.status AS "sourceStatus",
              translation_state.status AS "translationStatus",
              (SELECT count(*)::integer FROM caption_artifact_segments
               WHERE artifact_id = context.current_source_caption_artifact_id)
                AS "sourceSegments",
              (SELECT count(*)::integer FROM caption_artifact_segments
               WHERE artifact_id = context.current_translation_caption_artifact_id)
                AS "translationSegments",
              context.retrieval_version::text AS "retrievalVersion"
       FROM study_contexts AS context
       JOIN caption_generation_states AS source_state
         ON source_state.artifact_id = context.current_source_caption_artifact_id
       JOIN caption_generation_states AS translation_state
         ON translation_state.artifact_id = context.current_translation_caption_artifact_id
       WHERE context.id = $1 AND context.user_id = $2`,
      [contextId, userId],
    );
    expect(saved.rows[0]).toMatchObject({
      sourceStatus: 'ready',
      translationStatus: 'ready',
      sourceSegments: 2,
      translationSegments: 2,
    });
    expect(Number(saved.rows[0]?.retrievalVersion)).toBeGreaterThan(1);
    const outbox = await pool.query<{
      eventType: string;
      captionArtifactId: string;
    }>(
      `SELECT event_type AS "eventType",
              payload->>'captionArtifactId' AS "captionArtifactId"
       FROM work_outbox_events
       WHERE aggregate_type = 'study_context' AND aggregate_id = $1`,
      [contextId],
    );
    expect(outbox.rows).toHaveLength(1);
    expect(outbox.rows[0]?.eventType).toBe('retrieval_embedding.requested');
    expect(outbox.rows[0]?.captionArtifactId).toMatch(/^\d+$/u);
  });
});
