import type {
  CreateAgentRunCommand,
  LearningRepository,
  RecordProgressCommand,
  SubmitQuizCommand,
} from './learning.repository';
import { LearningService } from './learning.service';
import type { AgentRun } from './learning.types';

describe('LearningService', () => {
  it('canonicalizes and hashes an idempotent AgentRun request before enqueueing it', async () => {
    const repository = new RecordingLearningRepository();
    const service = new LearningService(repository);

    await service.createRun(17, ' run-key-1 ', {
      objective: '  PostgreSQL 동시성 학습  ',
      requestedStepCount: 4,
      budgets: {
        wallTimeBudgetMs: 120_000,
        toolCallBudget: 8,
        tokenBudget: 12_000,
        estimatedCostBudgetUsd: 0.2,
      },
    });

    expect(repository.created).toHaveLength(1);
    expect(repository.created[0]).toMatchObject({
      ownerId: 17,
      input: {
        objective: 'PostgreSQL 동시성 학습',
        requestedStepCount: 4,
      },
      budgets: {
        wallTimeBudgetMs: 120_000,
        toolCallBudget: 8,
        tokenBudget: 12_000,
        estimatedCostBudgetUsd: 0.2,
      },
    });
    expect(repository.created[0].idempotencyKeyDigest).toHaveLength(32);
    expect(repository.created[0].payloadHash).toHaveLength(32);
  });

  it('hashes the raw progress event payload independently of the idempotency key', async () => {
    const repository = new RecordingLearningRepository();
    const service = new LearningService(repository);

    await service.recordProgress(17, '42', 'progress-key-1', {
      startSeconds: 8,
      endSeconds: 25,
      lastPositionSeconds: 25,
      occurredAt: '2026-07-29T00:00:00.000Z',
    });

    expect(repository.progressed).toHaveLength(1);
    expect(repository.progressed[0]).toMatchObject({
      userId: 17,
      courseStepId: '42',
      startSeconds: 8,
      endSeconds: 25,
      lastPositionSeconds: 25,
    });
    expect(repository.progressed[0].idempotencyKeyDigest).toHaveLength(32);
    expect(repository.progressed[0].payloadHash).toHaveLength(32);
    expect(repository.progressed[0].payloadHash).not.toEqual(
      repository.progressed[0].idempotencyKeyDigest,
    );
  });

  it('hashes quiz answers while preserving their submitted order', async () => {
    const repository = new RecordingLearningRepository();
    const service = new LearningService(repository);

    await service.submitQuiz(
      17,
      '11111111-1111-4111-8111-111111111111',
      'quiz-key',
      {
        answers: [
          {
            questionId: '22222222-2222-4222-8222-222222222222',
            selectedChoiceIndex: 2,
          },
          {
            questionId: '33333333-3333-4333-8333-333333333333',
            selectedChoiceIndex: 0,
          },
          {
            questionId: '44444444-4444-4444-8444-444444444444',
            selectedChoiceIndex: 1,
          },
          {
            questionId: '55555555-5555-4555-8555-555555555555',
            selectedChoiceIndex: 3,
          },
          {
            questionId: '66666666-6666-4666-8666-666666666666',
            selectedChoiceIndex: 2,
          },
        ],
      },
    );

    expect(repository.submitted).toHaveLength(1);
    expect(
      repository.submitted[0].answers.map(
        (answer) => answer.selectedChoiceIndex,
      ),
    ).toEqual([2, 0, 1, 3, 2]);
    expect(repository.submitted[0].payloadHash).toHaveLength(32);
  });
});

class RecordingLearningRepository implements LearningRepository {
  readonly created: CreateAgentRunCommand[] = [];
  readonly progressed: RecordProgressCommand[] = [];
  readonly submitted: SubmitQuizCommand[] = [];

  createRun(command: CreateAgentRunCommand) {
    this.created.push(command);
    return Promise.resolve(run(command.ownerId));
  }

  findOwnerRun() {
    return Promise.resolve(null);
  }

  cancelRun() {
    return Promise.resolve(run(17));
  }

  retryRun() {
    return Promise.resolve(run(17));
  }

  approveRun() {
    return Promise.resolve(run(17));
  }

  claimRunAttempt() {
    return Promise.resolve(null);
  }

  reserveRunUsage() {
    return Promise.resolve({
      status: 'reserved' as const,
      wallTimeDeadlineAtMs: Date.now() + 30_000,
    });
  }

  completeRunAttempt() {
    return Promise.resolve(false);
  }

  failRunAttempt() {
    return Promise.resolve(false);
  }

  recordProgress(command: RecordProgressCommand) {
    this.progressed.push(command);
    return Promise.resolve({
      courseStepId: command.courseStepId,
      watchedRanges: [{ start: command.startSeconds, end: command.endSeconds }],
      lastPositionSeconds: command.lastPositionSeconds,
      watchedCoverage: 0.17,
      bestQuizScore: null,
      completedAt: null,
      version: 1,
    });
  }

  findOwnerProgress() {
    return Promise.resolve(null);
  }

  createQuiz() {
    return Promise.resolve(undefined);
  }

  findOwnerQuiz() {
    return Promise.resolve(null);
  }

  submitQuiz(command: SubmitQuizCommand) {
    this.submitted.push(command);
    return Promise.resolve({
      id: '44444444-4444-4444-8444-444444444444',
      quizId: command.quizId,
      attemptNumber: 1,
      score: 100,
      submittedAt: '2026-07-29T00:00:00.000Z',
      answers: [],
      bestScore: 100,
      latestScore: 100,
      attemptsRemaining: 2,
    });
  }

  listOwnerQuizAttempts() {
    return Promise.resolve([]);
  }

  recordAgentToolCall() {
    return Promise.resolve(true);
  }

  settleAgentWorkItem() {
    return Promise.resolve();
  }
}

function run(ownerId: number): AgentRun {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    ownerId,
    courseId: null,
    state: 'queued',
    version: 1,
    input: {},
    budgets: {
      wallTimeBudgetMs: 120_000,
      toolCallBudget: 8,
      tokenBudget: 12_000,
      estimatedCostBudgetUsd: 0.2,
    },
    usage: { toolCalls: 0, tokens: 0, estimatedCostUsd: 0 },
    queuedAt: '2026-07-29T00:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    updatedAt: '2026-07-29T00:00:00.000Z',
    cancellationRequestedAt: null,
    failureCode: null,
    attempts: [],
    transitions: [],
    proposedSteps: [],
  };
}
