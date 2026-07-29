import { createHash } from 'node:crypto';
import { LearningValidationError } from './learning.errors';
import type {
  CreateQuizCommand,
  LearningRepository,
  RecordAgentToolCallCommand,
  ReserveAgentRunUsageCommand,
  SettleAgentWorkItemCommand,
} from './learning.repository';
import type {
  AgentBudgets,
  AgentUsage,
  ProposedCourseStep,
} from './learning.types';

const DEFAULT_BUDGETS: AgentBudgets = {
  wallTimeBudgetMs: 180_000,
  toolCallBudget: 12,
  tokenBudget: 24_000,
  estimatedCostBudgetUsd: 0.5,
};

export class LearningService {
  constructor(private readonly repository: LearningRepository) {}

  createRun(
    ownerId: number,
    idempotencyKey: string | undefined,
    body: {
      objective: string;
      requestedStepCount?: number;
      budgets?: Partial<AgentBudgets>;
    },
  ) {
    const key = requiredKey(idempotencyKey);
    const objective = requiredText(body.objective, 'objective', 2_000);
    const requestedStepCount = body.requestedStepCount ?? 4;
    if (
      !Number.isInteger(requestedStepCount) ||
      requestedStepCount < 3 ||
      requestedStepCount > 6
    ) {
      throw new LearningValidationError(
        'requestedStepCount',
        'requestedStepCount must be between 3 and 6',
      );
    }
    const budgets = validateBudgets({ ...DEFAULT_BUDGETS, ...body.budgets });
    const input = { objective, requestedStepCount };
    return this.repository.createRun({
      ownerId,
      idempotencyKeyDigest: digest(key),
      payloadHash: digest(canonicalJson({ input, budgets })),
      input,
      budgets,
    });
  }

  async getRun(ownerId: number, runId: string) {
    return this.repository.findOwnerRun(ownerId, runId);
  }

  cancelRun(ownerId: number, runId: string, expectedVersion: number) {
    return this.repository.cancelRun({ ownerId, runId, expectedVersion });
  }

  retryRun(ownerId: number, runId: string, expectedVersion: number) {
    return this.repository.retryRun({ ownerId, runId, expectedVersion });
  }

  approveRun(ownerId: number, runId: string, expectedVersion: number) {
    return this.repository.approveRun({ ownerId, runId, expectedVersion });
  }

  claimRunAttempt(workerId: string, leaseMs: number) {
    return this.repository.claimRunAttempt(workerId, leaseMs);
  }

  reserveRunUsage(input: ReserveAgentRunUsageCommand) {
    return this.repository.reserveRunUsage(input);
  }

  completeRunAttempt(input: {
    runId: string;
    attemptId: string;
    leaseToken: string;
    expectedVersion: number;
    usage: AgentUsage;
    proposedSteps: ProposedCourseStep[];
  }) {
    return this.repository.completeRunAttempt(input);
  }

  failRunAttempt(input: {
    runId: string;
    attemptId: string;
    leaseToken: string;
    expectedVersion: number;
    usage: AgentUsage;
    failureCode: string;
    failureMessage: string;
  }) {
    return this.repository.failRunAttempt(input);
  }

  recordProgress(
    userId: number,
    courseStepId: string,
    idempotencyKey: string | undefined,
    body: {
      startSeconds: number;
      endSeconds: number;
      lastPositionSeconds: number;
      occurredAt: string;
    },
  ) {
    const key = requiredKey(idempotencyKey);
    const startSeconds = finiteNonnegative(body.startSeconds, 'startSeconds');
    const endSeconds = finiteNonnegative(body.endSeconds, 'endSeconds');
    const lastPositionSeconds = finiteNonnegative(
      body.lastPositionSeconds,
      'lastPositionSeconds',
    );
    if (endSeconds <= startSeconds) {
      throw new LearningValidationError(
        'endSeconds',
        'endSeconds must be greater than startSeconds',
      );
    }
    const occurredAt = new Date(body.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) {
      throw new LearningValidationError(
        'occurredAt',
        'occurredAt must be an ISO timestamp',
      );
    }
    const payload = {
      startSeconds,
      endSeconds,
      lastPositionSeconds,
      occurredAt: occurredAt.toISOString(),
    };
    return this.repository.recordProgress({
      userId,
      courseStepId,
      idempotencyKeyDigest: digest(key),
      payloadHash: digest(canonicalJson(payload)),
      ...payload,
      occurredAt,
    });
  }

  getProgress(userId: number, courseStepId: string) {
    return this.repository.findOwnerProgress(userId, courseStepId);
  }

  createQuiz(input: CreateQuizCommand) {
    return this.repository.createQuiz(input);
  }

  getQuiz(userId: number, courseStepId: string) {
    return this.repository.findOwnerQuiz(userId, courseStepId);
  }

  submitQuiz(
    userId: number,
    quizId: string,
    idempotencyKey: string | undefined,
    body: {
      answers: Array<{ questionId: string; selectedChoiceIndex: number }>;
    },
  ) {
    const key = requiredKey(idempotencyKey);
    if (!Array.isArray(body.answers) || body.answers.length !== 5) {
      throw new LearningValidationError(
        'answers',
        'Exactly 5 answers are required',
      );
    }
    const answers = body.answers.map((answer) => {
      if (
        !Number.isInteger(answer.selectedChoiceIndex) ||
        answer.selectedChoiceIndex < 0
      ) {
        throw new LearningValidationError(
          'answers',
          'selectedChoiceIndex must be a non-negative integer',
        );
      }
      return { ...answer };
    });
    return this.repository.submitQuiz({
      userId,
      quizId,
      idempotencyKeyDigest: digest(key),
      payloadHash: digest(canonicalJson({ answers })),
      answers,
    });
  }

  listQuizAttempts(userId: number, quizId: string) {
    return this.repository.listOwnerQuizAttempts(userId, quizId);
  }

  recordAgentToolCall(command: RecordAgentToolCallCommand) {
    return this.repository.recordAgentToolCall(command);
  }

  settleAgentWorkItem(command: SettleAgentWorkItemCommand) {
    return this.repository.settleAgentWorkItem(command);
  }
}

function requiredKey(value: string | undefined): string {
  const key = value?.trim();
  if (!key || key.length > 200) {
    throw new LearningValidationError(
      'idempotency-key',
      'A valid Idempotency-Key header is required',
    );
  }
  return key;
}

function requiredText(value: string, field: string, maxLength: number): string {
  const normalized = value?.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new LearningValidationError(field, `${field} is required`);
  }
  return normalized;
}

function finiteNonnegative(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new LearningValidationError(field, `${field} must be non-negative`);
  }
  return value;
}

function validateBudgets(value: AgentBudgets): AgentBudgets {
  if (
    !Number.isInteger(value.wallTimeBudgetMs) ||
    value.wallTimeBudgetMs < 1 ||
    value.wallTimeBudgetMs > 3_600_000
  ) {
    throw new LearningValidationError(
      'budgets.wallTimeBudgetMs',
      'Invalid wall time budget',
    );
  }
  if (
    !Number.isInteger(value.toolCallBudget) ||
    value.toolCallBudget < 1 ||
    value.toolCallBudget > 100
  ) {
    throw new LearningValidationError(
      'budgets.toolCallBudget',
      'Invalid tool call budget',
    );
  }
  if (
    !Number.isInteger(value.tokenBudget) ||
    value.tokenBudget < 1 ||
    value.tokenBudget > 1_000_000
  ) {
    throw new LearningValidationError(
      'budgets.tokenBudget',
      'Invalid token budget',
    );
  }
  if (
    !Number.isFinite(value.estimatedCostBudgetUsd) ||
    value.estimatedCostBudgetUsd < 0
  ) {
    throw new LearningValidationError(
      'budgets.estimatedCostBudgetUsd',
      'Invalid cost budget',
    );
  }
  return value;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
