import { createHash, randomUUID } from 'node:crypto';
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
import { Pool } from 'pg';
import { DurableJobExecutor } from '../src/work/durable-job.executor';
import { MemoryJobExecutionStore } from '../src/work/memory-job-execution.store';
import { PostgresLearningRepository } from '../src/learning/postgres-learning.repository';
import { LearningService } from '../src/learning/learning.service';
import {
  QuizGenerationJobHandler,
  type GroundedQuizGenerator,
} from '../src/learning/quiz-generation.worker';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://app:app@localhost:5432/app_dev';

describe('adaptive quiz PostgreSQL checkpoint (e2e)', () => {
  jest.setTimeout(30_000);

  let pool: Pool;
  let service: LearningService;
  const users: number[] = [];

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL });
    service = new LearningService(new PostgresLearningRepository(pool));
  });

  afterAll(async () => {
    if (users.length > 0) {
      await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [users]);
    }
    await pool.end();
  });

  it('pins ready evidence, generates once, hides answers and creates one review checkpoint', async () => {
    const fixture = await createReadyContext('adaptive001');
    users.push(fixture.userId);
    const key = `request-${randomUUID()}`;
    const requested = await service.requestAdaptiveQuiz(
      fixture.userId,
      fixture.contextId,
      key,
      { startSeconds: 0, endSeconds: 60 },
    );
    const replay = await service.requestAdaptiveQuiz(
      fixture.userId,
      fixture.contextId,
      key,
      { startSeconds: 0, endSeconds: 60 },
    );
    expect(replay.id).toBe(requested.id);
    expect(requested).toMatchObject({ state: 'generating', questions: [] });

    const event = await pool.query<{
      id: string;
      eventType: string;
      payloadSchemaVersion: number;
      payload: Record<string, unknown>;
    }>(
      `SELECT id::text AS id, event_type AS "eventType",
              payload_schema_version AS "payloadSchemaVersion", payload
       FROM work_outbox_events WHERE aggregate_type = 'learning_quiz_loop'
         AND aggregate_id = $1`,
      [requested.id],
    );
    expect(event.rows).toHaveLength(1);
    const job = {
      eventId: event.rows[0]!.id,
      eventType: event.rows[0]!.eventType,
      handlerVersion: 'quiz-generation-v2',
      payloadSchemaVersion: event.rows[0]!.payloadSchemaVersion,
      payload: event.rows[0]!.payload,
    };
    const handler = new QuizGenerationJobHandler(
      service,
      contentQuizGenerator(),
      new DurableJobExecutor(new MemoryJobExecutionStore(), {
        leaseOwner: 'adaptive-quiz-e2e',
        leaseMs: 30_000,
      }),
    );
    await handler.handle(job);
    const ready = await service.getAdaptiveQuiz(fixture.userId, requested.id);
    expect(ready).toMatchObject({ state: 'ready' });
    expect(ready?.questions).toHaveLength(5);
    expect(JSON.stringify(ready)).not.toMatch(
      /correctChoiceIndex|explanation/iu,
    );

    const answers = ready!.questions.map((question, index) => ({
      questionId: question.id,
      selectedChoiceIndex: index === 0 ? 1 : 0,
    }));
    const submitKey = `submit-${randomUUID()}`;
    const [first, duplicate] = await Promise.all([
      service.submitAdaptiveQuiz(fixture.userId, requested.id, submitKey, {
        answers,
      }),
      service.submitAdaptiveQuiz(fixture.userId, requested.id, submitKey, {
        answers,
      }),
    ]);
    expect(duplicate.attempt.id).toBe(first.attempt.id);
    expect(first).toMatchObject({
      state: 'evaluated',
      reviewProposal: { kind: 'review_range' },
    });
    expect(first.attempt.answers[0]).toMatchObject({
      correct: false,
      citation: { startSeconds: 0, endSeconds: 5 },
    });
    const rows = await pool.query<{ attempts: number; proposals: number }>(
      `SELECT
         (SELECT count(*)::integer FROM adaptive_quiz_attempts WHERE loop_id = $1) AS attempts,
         (SELECT count(*)::integer FROM adaptive_quiz_review_proposals WHERE loop_id = $1) AS proposals`,
      [requested.id],
    );
    expect(rows.rows[0]).toEqual({ attempts: 1, proposals: 1 });
  });

  it('uses ready caption segments while indexing and rejects stale generation submit', async () => {
    const fallback = await createReadyContext('adaptive002', 2);
    users.push(fallback.userId);
    await expect(
      service.requestAdaptiveQuiz(
        fallback.userId,
        fallback.contextId,
        `opening-only-${randomUUID()}`,
        { startSeconds: 0, endSeconds: 20 },
      ),
    ).rejects.toMatchObject({ code: 'LEARNING_EVIDENCE_NOT_READY' });

    const fallbackQuiz = await service.requestAdaptiveQuiz(
      fallback.userId,
      fallback.contextId,
      `caption-fallback-${randomUUID()}`,
      { startSeconds: 0, endSeconds: 100 },
    );
    const fallbackEvidence = await pool.query<{
      resourceId: string;
      content: string;
      startSeconds: number;
      endSeconds: number;
    }>(
      `SELECT resource_id AS "resourceId", content,
              start_seconds AS "startSeconds", end_seconds AS "endSeconds"
       FROM adaptive_quiz_evidence WHERE loop_id = $1 ORDER BY position`,
      [fallbackQuiz.id],
    );
    expect(fallbackEvidence.rows).toHaveLength(5);
    expect(
      fallbackEvidence.rows.every((row) =>
        row.resourceId.startsWith('caption-segment:'),
      ),
    ).toBe(true);
    expect(fallbackEvidence.rows[0]).toMatchObject({
      content: 'Grounded caption 1 Grounded caption 2',
      startSeconds: 0,
      endSeconds: 15,
    });
    expect(fallbackEvidence.rows[4]).toMatchObject({
      content: 'Grounded caption 9 Grounded caption 10',
      startSeconds: 80,
      endSeconds: 95,
    });

    const pending = await createReadyContext('adaptive004', false, false);
    users.push(pending.userId);
    await expect(
      service.requestAdaptiveQuiz(
        pending.userId,
        pending.contextId,
        `pending-${randomUUID()}`,
        { startSeconds: 0, endSeconds: 60 },
      ),
    ).rejects.toMatchObject({ code: 'LEARNING_EVIDENCE_NOT_READY' });

    const fixture = await createReadyContext('adaptive003');
    users.push(fixture.userId);
    const requested = await service.requestAdaptiveQuiz(
      fixture.userId,
      fixture.contextId,
      `stale-${randomUUID()}`,
      { startSeconds: 0, endSeconds: 60 },
    );
    const event = await pool.query<{
      id: string;
      payload: Record<string, unknown>;
    }>(
      `SELECT id::text AS id, payload FROM work_outbox_events
       WHERE aggregate_type = 'learning_quiz_loop' AND aggregate_id = $1`,
      [requested.id],
    );
    const handler = new QuizGenerationJobHandler(
      service,
      contentQuizGenerator(),
      new DurableJobExecutor(new MemoryJobExecutionStore(), {
        leaseOwner: 'adaptive-quiz-stale-e2e',
        leaseMs: 30_000,
      }),
    );
    await handler.handle({
      eventId: event.rows[0]!.id,
      eventType: 'quiz_generation.requested',
      handlerVersion: 'quiz-generation-v2',
      payloadSchemaVersion: 2,
      payload: event.rows[0]!.payload,
    });
    const ready = await service.getAdaptiveQuiz(fixture.userId, requested.id);
    await pool.query(
      `UPDATE study_contexts SET current_translation_caption_artifact_id = NULL,
                                 current_source_caption_artifact_id = NULL
       WHERE id = $1`,
      [fixture.contextId],
    );
    await expect(
      service.submitAdaptiveQuiz(
        fixture.userId,
        requested.id,
        `stale-submit-${randomUUID()}`,
        {
          answers: ready!.questions.map((question) => ({
            questionId: question.id,
            selectedChoiceIndex: 0,
          })),
        },
      ),
    ).rejects.toMatchObject({ code: 'LEARNING_QUIZ_STALE' });
    await expect(
      service.getAdaptiveQuiz(fixture.userId, requested.id),
    ).resolves.toMatchObject({ state: 'stale' });
  });

  async function createReadyContext(
    videoId: string,
    indexed: boolean | number = true,
    artifactReady = true,
  ) {
    const email = `${videoId}-${randomUUID()}@example.test`;
    const user = await pool.query<{ id: number }>(
      `INSERT INTO users (
         name, email, email_canonical, password_hash, password_algorithm,
         password_parameters, password_version, identity_assurance
       ) VALUES ('Quiz owner', $1, $1, repeat('a', 64), 'legacy_sha256',
                 '{"digest":"sha256","encoding":"lower_hex"}'::jsonb,
                 1, 'legacy_grandfathered') RETURNING id`,
      [email],
    );
    const source = await pool.query<{ id: string }>(
      `INSERT INTO video_sources (provider, canonical_video_id, canonical_url)
       VALUES ('youtube', $1, $2) RETURNING id::text AS id`,
      [videoId, `https://www.youtube.com/watch?v=${videoId}`],
    );
    const item = await pool.query<{ id: string }>(
      `INSERT INTO learning_items (user_id, video_source_id)
       VALUES ($1, $2) RETURNING id::text AS id`,
      [user.rows[0]!.id, source.rows[0]!.id],
    );
    const context = await pool.query<{ id: string }>(
      `INSERT INTO study_contexts (user_id, learning_item_id, kind)
       VALUES ($1, $2, 'standalone') RETURNING id::text AS id`,
      [user.rows[0]!.id, item.rows[0]!.id],
    );
    const artifact = await pool.query<{ id: string }>(
      `INSERT INTO caption_artifacts (
         video_source_id, kind, generation, source_language,
         provider, work_event_id, handler_version
       ) VALUES ($1, 'youtube_caption', 1, 'en', 'e2e', $2, 'e2e')
       RETURNING id::text AS id`,
      [source.rows[0]!.id, randomUUID()],
    );
    const segmentCount = videoId === 'adaptive002' ? 10 : 5;
    await pool.query(
      `INSERT INTO caption_generation_states (artifact_id, status, last_ordinal)
       VALUES ($1, $2, $3)`,
      [
        artifact.rows[0]!.id,
        artifactReady ? 'ready' : 'pending',
        segmentCount - 1,
      ],
    );
    await pool.query(
      `UPDATE study_contexts SET current_source_caption_artifact_id = $2
       WHERE id = $1`,
      [context.rows[0]!.id, artifact.rows[0]!.id],
    );
    for (let index = 0; index < segmentCount; index += 1) {
      const fractional = videoId === 'adaptive002';
      const startSeconds = index * 10 + (fractional ? 0.25 : 0);
      const endSeconds = index * 10 + (fractional ? 4.75 : 5);
      const segment = await pool.query<{ id: string }>(
        `INSERT INTO caption_artifact_segments (
           artifact_id, ordinal, start_seconds, end_seconds, text
         ) VALUES ($1, $2, $3, $4, $5) RETURNING id::text AS id`,
        [
          artifact.rows[0]!.id,
          index,
          startSeconds,
          endSeconds,
          `Grounded caption ${index + 1}`,
        ],
      );
      if (
        indexed === true ||
        (typeof indexed === 'number' && index < indexed)
      ) {
        await pool.query(
          `INSERT INTO retrieval_embeddings (
             source_kind, source_id, owner_id, visibility, model, dimensions,
             content, content_hash, source_url, timestamp_seconds, embedding,
             chunk_index, start_seconds, end_seconds, source_version,
             evidence_kind, resource_id, readiness, evidence_artifact_id,
             evidence_segment_id, artifact_generation
           ) VALUES (
             'learning_context', $1, $2, 'private', 'u7-e2e', 1536,
             $3, $4, $5, $6, array_fill(0.001::real, ARRAY[1536])::vector,
             $7, $6, $8, 2, 'caption_segment', $9, 'ready', $10, $11, 1
           )`,
          [
            context.rows[0]!.id,
            user.rows[0]!.id,
            `Grounded caption ${index + 1}`,
            createHash('sha256').update(`${videoId}:${index}`).digest(),
            `https://www.youtube.com/watch?v=${videoId}`,
            Math.floor(startSeconds),
            index,
            Math.ceil(endSeconds),
            `caption-segment-${index + 1}`,
            artifact.rows[0]!.id,
            segment.rows[0]!.id,
          ],
        );
      }
    }
    return {
      userId: user.rows[0]!.id,
      contextId: context.rows[0]!.id,
    };
  }
});

function contentQuizGenerator(): GroundedQuizGenerator {
  return {
    generate(snapshot, signal) {
      signal.throwIfAborted();
      return Promise.resolve({
        schemaVersion: 1,
        generatorVersion: 'content-quiz-e2e-v1',
        questions: snapshot.evidence.map((evidence, index) => ({
          prompt: `영상에서 다룬 개념 ${index + 1}의 역할은 무엇인가요?`,
          choices: [
            `핵심 역할 ${index + 1}`,
            `다른 역할 ${index + 1}`,
            `반대 역할 ${index + 1}`,
            `관련 없는 역할 ${index + 1}`,
          ],
          correctChoiceIndex: index % 4,
          explanation: `개념 ${index + 1}이 필요한 이유를 설명한 내용입니다.`,
          citation: {
            resourceId: evidence.resourceId,
            sourceUrl: evidence.sourceUrl,
            startSeconds: evidence.startSeconds,
            endSeconds: evidence.endSeconds,
            artifactId: evidence.artifactId,
            artifactGeneration: evidence.artifactGeneration,
          },
        })),
      });
    },
  };
}
