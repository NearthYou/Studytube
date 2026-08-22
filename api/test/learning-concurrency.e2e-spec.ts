import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  LearningAttemptLimitError,
  LearningIdempotencyConflictError,
} from '../src/learning/learning.errors';
import { AgentRunProcessor } from '../src/learning/agent-run.processor';
import { PostgresLearningRepository } from '../src/learning/postgres-learning.repository';
import { LearningService } from '../src/learning/learning.service';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://app:app@localhost:5432/app_dev';

describe('learning PostgreSQL concurrency contracts (e2e)', () => {
  jest.setTimeout(30_000);

  let pool: Pool;
  let repository: PostgresLearningRepository;
  const userIds: number[] = [];

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL });
    repository = new PostgresLearningRepository(pool);
  });

  it('derives evidence defaults for existing course step writers', async () => {
    const ownerId = await insertUser(pool, 'Legacy Step Writer');
    userIds.push(ownerId);
    const course = await pool.query<{ id: number }>(
      `INSERT INTO courses (owner_id, title) VALUES ($1, 'Compatible Course') RETURNING id`,
      [ownerId],
    );
    const step = await pool.query<{
      evidenceSourceUrl: string;
      evidenceTimestampSeconds: number;
      evidenceConfidence: string;
      generationStatus: string;
      durationSeconds: number;
    }>(
      `
        INSERT INTO course_steps (
          course_id, position, title_snapshot, video_url_snapshot
        )
        VALUES ($1, 1, 'Compatible Step', 'https://video.example.test/compatible')
        RETURNING evidence_source_url AS "evidenceSourceUrl",
                  evidence_timestamp_seconds AS "evidenceTimestampSeconds",
                  evidence_confidence::text AS "evidenceConfidence",
                  generation_status AS "generationStatus",
                  duration_seconds AS "durationSeconds"
      `,
      [course.rows[0].id],
    );

    expect(step.rows[0]).toEqual({
      evidenceSourceUrl: 'https://video.example.test/compatible',
      evidenceTimestampSeconds: 0,
      evidenceConfidence: '1.0000',
      generationStatus: 'ready',
      durationSeconds: 1,
    });
  });

  it('creates one AgentRun for concurrent uses of the same idempotency key', async () => {
    const ownerId = await insertUser(pool, 'Agent Idempotency');
    userIds.push(ownerId);
    const command = createRun(ownerId, 'same-run-key');

    const runs = await Promise.all([
      repository.createRun(command),
      repository.createRun(command),
    ]);

    expect(runs[0].id).toBe(runs[1].id);
    const persisted = await pool.query<{ roots: number; attempts: number }>(
      `
        SELECT count(DISTINCT r.id)::integer AS roots,
               count(a.id)::integer AS attempts
        FROM agent_runs r
        LEFT JOIN agent_run_attempts a ON a.run_id = r.id
        WHERE r.owner_id = $1 AND r.idempotency_key_digest = $2
      `,
      [ownerId, command.idempotencyKeyDigest],
    );
    expect(persisted.rows[0]).toEqual({ roots: 1, attempts: 1 });
    await repository.cancelRun({
      ownerId,
      runId: runs[0].id,
      expectedVersion: 1,
    });
  });

  it('leases one queued attempt to only one concurrent worker', async () => {
    const ownerId = await insertUser(pool, 'Agent Claim');
    userIds.push(ownerId);
    await repository.createRun(createRun(ownerId, 'claim-once'));

    const claims = await Promise.all([
      repository.claimRunAttempt('worker-a', 30_000),
      repository.claimRunAttempt('worker-b', 30_000),
    ]);

    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.find(Boolean)).toMatchObject({
      attemptNumber: 1,
      run: { ownerId, state: 'running', version: 2 },
    });
  });

  it('atomically reserves a run budget before concurrent tool calls can start', async () => {
    const ownerId = await insertUser(pool, 'Agent Budget Reservation');
    userIds.push(ownerId);
    const created = await repository.createRun({
      ...createRun(ownerId, 'budget-reservation'),
      budgets: {
        wallTimeBudgetMs: 120_000,
        toolCallBudget: 1,
        tokenBudget: 100,
        estimatedCostBudgetUsd: 0.01,
      },
    });
    const claim = await repository.claimRunAttempt(
      'worker-budget-reservation',
      30_000,
    );
    expect(claim?.run.id).toBe(created.id);
    const command = {
      runId: created.id,
      attemptId: claim!.attemptId,
      leaseToken: claim!.leaseToken,
      expectedVersion: 2,
      usage: { toolCalls: 1, tokens: 100, estimatedCostUsd: 0.01 },
    };

    const reservations = await Promise.all([
      repository.reserveRunUsage(command),
      repository.reserveRunUsage(command),
    ]);

    expect(reservations.map(({ status }) => status).sort()).toEqual([
      'reservation_conflict',
      'reserved',
    ]);
    await expect(
      repository.findOwnerRun(ownerId, created.id),
    ).resolves.toMatchObject({
      usage: { toolCalls: 1, tokens: 100, estimatedCostUsd: 0.01 },
      attempts: [
        {
          usage: { toolCalls: 1, tokens: 100, estimatedCostUsd: 0.01 },
        },
      ],
    });
  });

  it('lets only one processor start a tool call for the same claimed attempt', async () => {
    const ownerId = await insertUser(pool, 'Duplicate Agent Processor');
    userIds.push(ownerId);
    const created = await repository.createRun({
      ...createRun(ownerId, 'duplicate-agent-processor'),
      budgets: {
        wallTimeBudgetMs: 120_000,
        toolCallBudget: 1,
        tokenBudget: 100,
        estimatedCostBudgetUsd: 0.01,
      },
    });
    const claim = await repository.claimRunAttempt(
      'worker-duplicate-claim',
      30_000,
    );
    expect(claim?.run.id).toBe(created.id);

    const service = new LearningService(repository);
    const duplicateClaimClient = {
      claimRunAttempt: () => Promise.resolve(claim),
      reserveRunUsage: service.reserveRunUsage.bind(service),
      completeRunAttempt: service.completeRunAttempt.bind(service),
      failRunAttempt: service.failRunAttempt.bind(service),
      recordAgentToolCall: service.recordAgentToolCall.bind(service),
    };
    let finishRecommendation!: (response: unknown) => void;
    const recommendationPending = new Promise((resolve) => {
      finishRecommendation = resolve;
    });
    const recommendations = {
      buildGroundedPlan: jest.fn(() => recommendationPending),
    };
    const processorOptions = {
      leaseMs: 30_000,
      processTimeoutMs: 25_000,
      pollIntervalMs: 1_000,
    };
    const first = new AgentRunProcessor(duplicateClaimClient, recommendations, {
      ...processorOptions,
      workerId: 'duplicate-processor-a',
    });
    const second = new AgentRunProcessor(
      duplicateClaimClient,
      recommendations,
      { ...processorOptions, workerId: 'duplicate-processor-b' },
    );

    const firstProcessing = first.processOnce();
    const secondProcessing = second.processOnce();
    const duplicateFinished = await Promise.race([
      firstProcessing.then(() => true),
      secondProcessing.then(() => true),
      new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 5_000);
        timer.unref?.();
      }),
    ]);

    expect(duplicateFinished).toBe(true);
    expect(recommendations.buildGroundedPlan).toHaveBeenCalledTimes(1);
    await expect(
      repository.findOwnerRun(ownerId, created.id),
    ).resolves.toMatchObject({
      state: 'running',
      usage: { toolCalls: 1, tokens: 100, estimatedCostUsd: 0.01 },
      attempts: [
        {
          state: 'running',
          usage: { toolCalls: 1, tokens: 100, estimatedCostUsd: 0.01 },
        },
      ],
    });

    finishRecommendation({
      sources: [],
      usage: {
        toolCalls: 1,
        totalTokens: 10,
        estimatedCostUsd: 0.001,
      },
    });
    await expect(
      Promise.all([firstProcessing, secondProcessing]),
    ).resolves.toEqual([true, true]);
    await expect(
      repository.findOwnerRun(ownerId, created.id),
    ).resolves.toMatchObject({
      state: 'failed',
      usage: { toolCalls: 1, tokens: 10, estimatedCostUsd: 0.001 },
    });
    const toolCalls = await pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM agent_tool_calls WHERE run_id = $1`,
      [created.id],
    );
    expect(toolCalls.rows[0]?.count).toBe(1);
  });

  it('rejects a reservation after the whole-run wall-time deadline', async () => {
    const ownerId = await insertUser(pool, 'Agent Wall Time');
    userIds.push(ownerId);
    const created = await repository.createRun({
      ...createRun(ownerId, 'wall-time-reservation'),
      budgets: {
        wallTimeBudgetMs: 1_000,
        toolCallBudget: 8,
        tokenBudget: 12_000,
        estimatedCostBudgetUsd: 0.2,
      },
    });
    const claim = await repository.claimRunAttempt(
      'worker-wall-time-reservation',
      30_000,
    );
    expect(claim?.run.id).toBe(created.id);
    await pool.query(
      `UPDATE agent_runs SET started_at = statement_timestamp() - interval '10 seconds' WHERE id = $1`,
      [created.id],
    );

    await expect(
      repository.reserveRunUsage({
        runId: created.id,
        attemptId: claim!.attemptId,
        leaseToken: claim!.leaseToken,
        expectedVersion: 2,
        usage: { toolCalls: 1, tokens: 100, estimatedCostUsd: 0.01 },
      }),
    ).resolves.toEqual({ status: 'budget_exhausted' });
    await expect(
      repository.findOwnerRun(ownerId, created.id),
    ).resolves.toMatchObject({
      usage: { toolCalls: 0, tokens: 0, estimatedCostUsd: 0 },
    });
  });

  it('lets cancel and completion race without allowing both transitions', async () => {
    const ownerId = await insertUser(pool, 'Cancel Race');
    userIds.push(ownerId);
    const created = await repository.createRun(
      createRun(ownerId, 'cancel-race'),
    );
    const claim = await repository.claimRunAttempt('worker-race', 30_000);
    expect(claim?.run.id).toBe(created.id);
    await expect(
      repository.reserveRunUsage({
        runId: created.id,
        attemptId: claim!.attemptId,
        leaseToken: claim!.leaseToken,
        expectedVersion: 2,
        usage: { toolCalls: 2, tokens: 500, estimatedCostUsd: 0.01 },
      }),
    ).resolves.toMatchObject({ status: 'reserved' });

    const settled = await Promise.allSettled([
      repository.cancelRun({
        ownerId,
        runId: created.id,
        expectedVersion: 2,
      }),
      repository.completeRunAttempt({
        runId: created.id,
        attemptId: claim!.attemptId,
        leaseToken: claim!.leaseToken,
        expectedVersion: 2,
        usage: { toolCalls: 2, tokens: 500, estimatedCostUsd: 0.01 },
        proposedSteps: proposedSteps(),
      }),
    ]);

    const cancellation = settled[0];
    const completion = settled[1];
    expect(completion.status).toBe('fulfilled');
    if (completion.status === 'fulfilled' && completion.value) {
      expect(cancellation.status).toBe('rejected');
    } else {
      expect(cancellation.status).toBe('fulfilled');
    }
    const current = await repository.findOwnerRun(ownerId, created.id);
    expect(['cancelled', 'awaiting_approval']).toContain(current?.state);
    expect(current?.attempts).toHaveLength(1);
  });

  it('retries with a new attempt while keeping one cumulative run budget', async () => {
    const ownerId = await insertUser(pool, 'Retry Budget');
    userIds.push(ownerId);
    const created = await repository.createRun(
      createRun(ownerId, 'retry-budget'),
    );
    const first = await repository.claimRunAttempt('worker-first', 30_000);
    expect(first?.run.id).toBe(created.id);
    await expect(
      repository.reserveRunUsage({
        runId: created.id,
        attemptId: first!.attemptId,
        leaseToken: first!.leaseToken,
        expectedVersion: 2,
        usage: { toolCalls: 5, tokens: 500, estimatedCostUsd: 0.05 },
      }),
    ).resolves.toMatchObject({ status: 'reserved' });
    await repository.failRunAttempt({
      runId: created.id,
      attemptId: first!.attemptId,
      leaseToken: first!.leaseToken,
      expectedVersion: 2,
      usage: { toolCalls: 5, tokens: 500, estimatedCostUsd: 0.05 },
      failureCode: 'UPSTREAM_TIMEOUT',
      failureMessage: 'Upstream timed out',
    });
    const retried = await repository.retryRun({
      ownerId,
      runId: created.id,
      expectedVersion: 3,
    });
    expect(retried.attempts.map(({ attemptNumber }) => attemptNumber)).toEqual([
      1, 2,
    ]);
    const second = await repository.claimRunAttempt('worker-second', 30_000);
    expect(second?.run.id).toBe(created.id);
    expect(second?.run.startedAt).toBe(first?.run.startedAt);

    await expect(
      repository.reserveRunUsage({
        runId: created.id,
        attemptId: second!.attemptId,
        leaseToken: second!.leaseToken,
        expectedVersion: 5,
        usage: { toolCalls: 4, tokens: 400, estimatedCostUsd: 0.04 },
      }),
    ).resolves.toEqual({ status: 'budget_exhausted' });
    await expect(
      repository.reserveRunUsage({
        runId: created.id,
        attemptId: second!.attemptId,
        leaseToken: second!.leaseToken,
        expectedVersion: 5,
        usage: { toolCalls: 3, tokens: 300, estimatedCostUsd: 0.03 },
      }),
    ).resolves.toMatchObject({ status: 'reserved' });
    await repository.failRunAttempt({
      runId: created.id,
      attemptId: second!.attemptId,
      leaseToken: second!.leaseToken,
      expectedVersion: 5,
      usage: { toolCalls: 3, tokens: 200, estimatedCostUsd: 0.02 },
      failureCode: 'SECOND_TIMEOUT',
      failureMessage: 'Second attempt timed out',
    });

    const current = await repository.findOwnerRun(ownerId, created.id);
    expect(current).toMatchObject({
      state: 'failed',
      version: 6,
      usage: { toolCalls: 8, tokens: 700, estimatedCostUsd: 0.07 },
    });
    expect(current?.attempts).toEqual([
      expect.objectContaining({
        attemptNumber: 1,
        usage: { toolCalls: 5, tokens: 500, estimatedCostUsd: 0.05 },
      }),
      expect.objectContaining({
        attemptNumber: 2,
        usage: { toolCalls: 3, tokens: 200, estimatedCostUsd: 0.02 },
      }),
    ]);
  });

  it('requeues failed approved work without regenerating the course or colliding on work items', async () => {
    const ownerId = await insertUser(pool, 'Approved Work Retry');
    userIds.push(ownerId);
    const created = await repository.createRun(
      createRun(ownerId, 'approved-work-retry'),
    );
    const claim = await repository.claimRunAttempt('approved-worker', 30_000);
    expect(claim?.run.id).toBe(created.id);
    await expect(
      repository.reserveRunUsage({
        runId: created.id,
        attemptId: claim!.attemptId,
        leaseToken: claim!.leaseToken,
        expectedVersion: 2,
        usage: { toolCalls: 3, tokens: 300, estimatedCostUsd: 0.03 },
      }),
    ).resolves.toMatchObject({ status: 'reserved' });
    await repository.completeRunAttempt({
      runId: created.id,
      attemptId: claim!.attemptId,
      leaseToken: claim!.leaseToken,
      expectedVersion: 2,
      usage: { toolCalls: 3, tokens: 300, estimatedCostUsd: 0.03 },
      proposedSteps: proposedSteps(),
    });
    const approved = await repository.approveRun({
      ownerId,
      runId: created.id,
      expectedVersion: 3,
    });
    expect(approved).toMatchObject({ state: 'approved', version: 4 });
    const failedItem = await pool.query<{
      courseStepId: string;
      outboxCount: number;
    }>(
      `
        SELECT item.course_step_id::text AS "courseStepId",
               (SELECT count(*)::integer
                  FROM work_outbox_events event
                 WHERE event.aggregate_type = 'course_step'
                   AND event.aggregate_id = item.course_step_id::text
                   AND event.event_type = 'quiz_generation.requested') AS "outboxCount"
        FROM agent_run_work_items item
        WHERE item.run_id = $1 AND item.kind = 'quiz_generation'
        ORDER BY item.position
        LIMIT 1
      `,
      [created.id],
    );
    await repository.settleAgentWorkItem({
      courseStepId: failedItem.rows[0].courseStepId,
      kind: 'quiz_generation',
      outcome: 'failed',
      reasonCode: 'INVALID_QUIZ_RESPONSE',
    });
    const failed = await repository.findOwnerRun(ownerId, created.id);
    expect(failed).toMatchObject({ state: 'failed', version: 5 });

    const retried = await repository.retryRun({
      ownerId,
      runId: created.id,
      expectedVersion: 5,
    });

    expect(retried).toMatchObject({
      id: created.id,
      courseId: approved.courseId,
      state: 'approved',
      version: 6,
    });
    expect(retried.attempts).toHaveLength(1);
    const requeued = await pool.query<{
      status: string;
      outboxCount: number;
    }>(
      `
        SELECT item.status,
               (SELECT count(*)::integer
                  FROM work_outbox_events event
                 WHERE event.aggregate_type = 'course_step'
                   AND event.aggregate_id = item.course_step_id::text
                   AND event.event_type = 'quiz_generation.requested') AS "outboxCount"
        FROM agent_run_work_items item
        WHERE item.run_id = $1 AND item.course_step_id = $2::bigint
          AND item.kind = 'quiz_generation'
      `,
      [created.id, failedItem.rows[0].courseStepId],
    );
    expect(requeued.rows[0]).toEqual({
      status: 'queued',
      outboxCount: failedItem.rows[0].outboxCount + 1,
    });
  });

  it('merges out-of-order progress and rejects key reuse with a different payload', async () => {
    const ownerId = await insertUser(pool, 'Progress Race');
    userIds.push(ownerId);
    const stepId = await insertCourseStep(pool, ownerId, 100);

    const later = progress(ownerId, stepId, 'later', 40, 80, 80, 2);
    const earlier = progress(ownerId, stepId, 'earlier', 0, 50, 50, 1);
    const [first, second] = await Promise.all([
      repository.recordProgress(later),
      repository.recordProgress(earlier),
    ]);
    expect([first.watchedCoverage, second.watchedCoverage]).toContain(0.8);

    await pool.query(
      `
        UPDATE learning_progress_events
        SET payload_hash = decode(repeat('00', 32), 'hex')
        WHERE user_id = $1 AND course_step_id = $2::bigint
          AND idempotency_key_digest = $3
      `,
      [ownerId, stepId, earlier.idempotencyKeyDigest],
    );

    const replay = await repository.recordProgress(earlier);
    expect(replay).toMatchObject({
      watchedRanges: [{ start: 0, end: 80 }],
      lastPositionSeconds: 80,
      watchedCoverage: 0.8,
    });
    const adopted = await pool.query<{ payloadHash: string }>(
      `
        SELECT encode(payload_hash, 'hex') AS "payloadHash"
        FROM learning_progress_events
        WHERE user_id = $1 AND course_step_id = $2::bigint
          AND idempotency_key_digest = $3
      `,
      [ownerId, stepId, earlier.idempotencyKeyDigest],
    );
    expect(adopted.rows[0].payloadHash).toBe(
      earlier.payloadHash.toString('hex'),
    );

    await expect(
      repository.recordProgress({
        ...earlier,
        payloadHash: createHash('sha256').update('different').digest(),
        endSeconds: 60,
      }),
    ).rejects.toMatchObject({ code: 'LEARNING_IDEMPOTENCY_CONFLICT' });
  });

  it('serializes quiz submissions into attempts one through three', async () => {
    const ownerId = await insertUser(pool, 'Quiz Race');
    userIds.push(ownerId);
    const stepId = await insertCourseStep(pool, ownerId, 120);
    const quizId = randomUUID();
    await repository.createQuiz({
      quizId,
      courseStepId: stepId,
      schemaVersion: 1,
      generatorVersion: 'learning-e2e-v1',
      maxAttempts: 3,
      questions: Array.from({ length: 5 }, (_, index) => ({
        prompt: `Question ${index + 1}`,
        choices: ['A', 'B', 'C', 'D'],
        correctChoiceIndex: index % 4,
        explanation: `Explanation ${index + 1}`,
        sourceUrl: `https://video.example.test/quiz?t=${index * 10}s`,
        sourceStartSeconds: index * 10,
        sourceEndSeconds: index * 10 + 5,
      })),
    });
    const quiz = await repository.findOwnerQuiz(ownerId, stepId);
    expect(quiz?.questions).toHaveLength(5);
    const answers = quiz!.questions.map((question, index) => ({
      questionId: question.id,
      selectedChoiceIndex: index % 4,
    }));

    const results = await Promise.allSettled(
      Array.from({ length: 4 }, (_, index) =>
        repository.submitQuiz({
          userId: ownerId,
          quizId: quiz!.id,
          idempotencyKeyDigest: createHash('sha256')
            .update(`attempt-${index}`)
            .digest(),
          payloadHash: createHash('sha256')
            .update(JSON.stringify({ answers, index }))
            .digest(),
          answers,
        }),
      ),
    );

    const fulfilled = results.filter(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof repository.submitQuiz>>
      > => result.status === 'fulfilled',
    );
    expect(fulfilled.map(({ value }) => value.attemptNumber).sort()).toEqual([
      1, 2, 3,
    ]);
    const rejection = results.find(({ status }) => status === 'rejected');
    expect(rejection?.status === 'rejected' && rejection.reason).toBeInstanceOf(
      LearningAttemptLimitError,
    );
  });

  it('adopts a legacy quiz replay hash once without creating another attempt', async () => {
    const ownerId = await insertUser(pool, 'Legacy Quiz Replay');
    userIds.push(ownerId);
    const stepId = await insertCourseStep(pool, ownerId, 120);
    const quizId = randomUUID();
    await repository.createQuiz({
      quizId,
      courseStepId: stepId,
      schemaVersion: 1,
      generatorVersion: 'legacy-replay-v1',
      maxAttempts: 3,
      questions: Array.from({ length: 5 }, (_, index) => ({
        prompt: `Legacy question ${index + 1}`,
        choices: ['A', 'B', 'C', 'D'],
        correctChoiceIndex: index % 4,
        explanation: `Legacy explanation ${index + 1}`,
        sourceUrl: `https://www.youtube.com/watch?v=legacy&t=${index * 10}s`,
        sourceStartSeconds: index * 10,
        sourceEndSeconds: index * 10 + 5,
      })),
    });
    const quiz = await repository.findOwnerQuiz(ownerId, stepId);
    const answers = quiz!.questions.map((question, index) => ({
      questionId: question.id,
      selectedChoiceIndex: index % 4,
    }));
    const command = {
      userId: ownerId,
      quizId,
      idempotencyKeyDigest: createHash('sha256')
        .update('legacy-quiz-key')
        .digest(),
      payloadHash: createHash('sha256')
        .update(JSON.stringify({ answers }))
        .digest(),
      answers,
    };
    const created = await repository.submitQuiz(command);
    await pool.query(
      `UPDATE quiz_attempts SET payload_hash = decode(repeat('00', 32), 'hex') WHERE id = $1`,
      [created.id],
    );

    await expect(repository.submitQuiz(command)).resolves.toMatchObject({
      id: created.id,
      attemptNumber: 1,
    });
    const persisted = await pool.query<{
      attempts: number;
      payloadHash: string;
    }>(
      `
        SELECT count(*)::integer AS attempts,
               max(encode(payload_hash, 'hex')) AS "payloadHash"
        FROM quiz_attempts
        WHERE quiz_id = $1 AND user_id = $2
      `,
      [quizId, ownerId],
    );
    expect(persisted.rows[0]).toEqual({
      attempts: 1,
      payloadHash: command.payloadHash.toString('hex'),
    });
    await expect(
      repository.submitQuiz({
        ...command,
        payloadHash: createHash('sha256').update('different').digest(),
      }),
    ).rejects.toBeInstanceOf(LearningIdempotencyConflictError);
  });

  it('replays deterministic quiz creation without publishing a new version', async () => {
    const ownerId = await insertUser(pool, 'Quiz Replay');
    userIds.push(ownerId);
    const stepId = await insertCourseStep(pool, ownerId, 120);
    const quizId = randomUUID();
    const command = {
      quizId,
      courseStepId: stepId,
      schemaVersion: 1,
      generatorVersion: 'learning-replay-v1',
      maxAttempts: 3,
      questions: Array.from({ length: 5 }, (_, index) => ({
        prompt: `Replay question ${index + 1}`,
        choices: ['A', 'B', 'C', 'D'],
        correctChoiceIndex: index % 4,
        explanation: `Replay explanation ${index + 1}`,
        sourceUrl: `https://www.youtube.com/watch?v=replay&t=${index * 10}s`,
        sourceStartSeconds: index * 10,
        sourceEndSeconds: index * 10 + 5,
      })),
    };

    await Promise.all([
      repository.createQuiz(command),
      repository.createQuiz(command),
    ]);

    const persisted = await pool.query<{
      quizzes: number;
      questions: number;
      version: number;
    }>(
      `
        SELECT count(DISTINCT q.id)::integer AS quizzes,
               count(qq.id)::integer AS questions,
               max(q.version)::integer AS version
        FROM quizzes q
        LEFT JOIN quiz_questions qq ON qq.quiz_id = q.id
        WHERE q.course_step_id = $1::bigint
      `,
      [stepId],
    );
    expect(persisted.rows[0]).toEqual({
      quizzes: 1,
      questions: 5,
      version: 1,
    });

    await expect(
      repository.createQuiz({
        ...command,
        generatorVersion: 'different-generator',
      }),
    ).rejects.toBeInstanceOf(LearningIdempotencyConflictError);
  });

  afterAll(async () => {
    if (pool && userIds.length > 0) {
      await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [
        userIds,
      ]);
    }
    await pool?.end();
  });
});

function createRun(ownerId: number, key: string) {
  return {
    ownerId,
    idempotencyKeyDigest: createHash('sha256').update(key).digest(),
    payloadHash: createHash('sha256').update(`payload:${key}`).digest(),
    input: { objective: `Objective ${key}`, requestedStepCount: 3 },
    budgets: {
      wallTimeBudgetMs: 120_000,
      toolCallBudget: 8,
      tokenBudget: 12_000,
      estimatedCostBudgetUsd: 0.2,
    },
  };
}

function proposedSteps() {
  return Array.from({ length: 3 }, (_, index) => ({
    position: index + 1,
    title: `Step ${index + 1}`,
    videoUrl: `https://www.youtube.com/watch?v=learning${index + 1}`,
    thumbnailUrl: '',
    channelName: 'StudyTube Lab',
    sourcePostId: null,
    evidenceSourceUrl: `https://www.youtube.com/watch?v=learning${index + 1}&t=${index * 10}s`,
    evidenceTimestampSeconds: index * 10,
    evidenceConfidence: 0.9,
    status: 'ready' as const,
    durationSeconds: 100,
  }));
}

function progress(
  userId: number,
  courseStepId: string,
  key: string,
  startSeconds: number,
  endSeconds: number,
  lastPositionSeconds: number,
  hour: number,
) {
  const occurredAt = new Date(`2026-07-29T0${hour}:00:00.000Z`);
  return {
    userId,
    courseStepId,
    idempotencyKeyDigest: createHash('sha256').update(key).digest(),
    payloadHash: createHash('sha256')
      .update(
        `${startSeconds}:${endSeconds}:${lastPositionSeconds}:${occurredAt.toISOString()}`,
      )
      .digest(),
    startSeconds,
    endSeconds,
    lastPositionSeconds,
    occurredAt,
  };
}

async function insertUser(pool: Pool, name: string): Promise<number> {
  const email = `learning-${randomUUID()}@example.test`;
  const result = await pool.query<{ id: number }>(
    `
      INSERT INTO users (
        name, email, email_canonical, password_hash, password_algorithm,
        password_parameters, password_version, identity_assurance
      )
      VALUES ($1, $2, $2, $3, 'legacy_sha256',
              '{"digest":"sha256","encoding":"lower_hex"}'::jsonb,
              1, 'legacy_grandfathered')
      RETURNING id
    `,
    [name, email, '0'.repeat(64)],
  );
  return result.rows[0].id;
}

async function insertCourseStep(
  pool: Pool,
  ownerId: number,
  durationSeconds: number,
): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const course = await client.query<{ id: number }>(
      `INSERT INTO courses (owner_id, title) VALUES ($1, 'Learning Course') RETURNING id`,
      [ownerId],
    );
    const step = await client.query<{ id: string }>(
      `
        INSERT INTO course_steps (
          course_id, position, title_snapshot, video_url_snapshot,
          evidence_source_url, evidence_timestamp_seconds,
          evidence_confidence, generation_status, duration_seconds
        )
        VALUES ($1, 1, 'Learning Step', 'https://video.example.test/learning',
                'https://video.example.test/learning?t=0s', 0, 1, 'ready', $2)
        RETURNING id::text AS id
      `,
      [course.rows[0].id, durationSeconds],
    );
    await client.query('COMMIT');
    return step.rows[0].id;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
