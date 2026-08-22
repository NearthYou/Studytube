import type { Pool } from 'pg';
import {
  observabilityRuntime,
  type ObservabilityRuntime,
} from '../observability/runtime';
import type {
  AuthorizeAgentMcpCallCommand,
  ClaimAgentRun,
  CompleteAgentRunCommand,
  CompleteAdaptiveQuizGenerationCommand,
  CreateAgentRunCommand,
  CreateQuizCommand,
  FailAgentRunCommand,
  LearningRepository,
  RecordAgentToolCallCommand,
  RecordProgressCommand,
  RequestAdaptiveQuizCommand,
  ReserveAgentRunUsageCommand,
  ReserveAgentRunUsageResult,
  SettleAgentWorkItemCommand,
  SubmitAdaptiveQuizCommand,
  SubmitQuizCommand,
  VersionedRunCommand,
} from './learning.repository';
import type {
  AgentRun,
  AdaptiveQuizLoopPublic,
  AdaptiveQuizSubmission,
  LearningProgress,
  QuizAttemptResult,
  QuizPublic,
} from './learning.types';
import { PostgresAgentRunRepository } from './postgres-agent-run.repository';
import { PostgresLearningProgressRepository } from './postgres-learning-progress.repository';
import { PostgresQuizRepository } from './postgres-quiz.repository';

export class PostgresLearningRepository implements LearningRepository {
  private readonly agentRuns: PostgresAgentRunRepository;
  private readonly progress: PostgresLearningProgressRepository;
  private readonly quizzes: PostgresQuizRepository;

  constructor(
    pool: Pool,
    observability: ObservabilityRuntime = observabilityRuntime,
  ) {
    this.agentRuns = new PostgresAgentRunRepository(pool, observability);
    this.progress = new PostgresLearningProgressRepository(pool);
    this.quizzes = new PostgresQuizRepository(pool, this.progress);
  }

  async createRun(command: CreateAgentRunCommand): Promise<AgentRun> {
    return this.agentRuns.createRun(command);
  }

  async findOwnerRun(ownerId: number, runId: string): Promise<AgentRun | null> {
    return this.agentRuns.findOwnerRun(ownerId, runId);
  }

  async cancelRun(command: VersionedRunCommand): Promise<AgentRun> {
    return this.agentRuns.cancelRun(command);
  }

  async retryRun(command: VersionedRunCommand): Promise<AgentRun> {
    return this.agentRuns.retryRun(command);
  }

  async approveRun(command: VersionedRunCommand): Promise<AgentRun> {
    return this.agentRuns.approveRun(command);
  }

  async claimRunAttempt(
    workerId: string,
    leaseMs: number,
  ): Promise<ClaimAgentRun | null> {
    return this.agentRuns.claimRunAttempt(workerId, leaseMs);
  }

  async reserveRunUsage(
    command: ReserveAgentRunUsageCommand,
  ): Promise<ReserveAgentRunUsageResult> {
    return this.agentRuns.reserveRunUsage(command);
  }

  async completeRunAttempt(command: CompleteAgentRunCommand): Promise<boolean> {
    return this.agentRuns.completeRunAttempt(command);
  }

  async failRunAttempt(command: FailAgentRunCommand): Promise<boolean> {
    return this.agentRuns.failRunAttempt(command);
  }

  async recordAgentToolCall(
    command: RecordAgentToolCallCommand,
  ): Promise<boolean> {
    return this.agentRuns.recordAgentToolCall(command);
  }

  authorizeAgentMcpCall(command: AuthorizeAgentMcpCallCommand) {
    return this.agentRuns.authorizeAgentMcpCall(command);
  }

  async settleAgentWorkItem(
    command: SettleAgentWorkItemCommand,
  ): Promise<void> {
    return this.agentRuns.settleAgentWorkItem(command);
  }

  async recordProgress(
    command: RecordProgressCommand,
  ): Promise<LearningProgress> {
    return this.progress.recordProgress(command);
  }

  async findOwnerProgress(
    userId: number,
    courseStepId: string,
  ): Promise<LearningProgress | null> {
    return this.progress.findOwnerProgress(userId, courseStepId);
  }

  async createQuiz(command: CreateQuizCommand): Promise<void> {
    return this.quizzes.createQuiz(command);
  }

  async findOwnerQuiz(
    userId: number,
    courseStepId: string,
  ): Promise<QuizPublic | null> {
    return this.quizzes.findOwnerQuiz(userId, courseStepId);
  }

  async submitQuiz(command: SubmitQuizCommand): Promise<QuizAttemptResult> {
    return this.quizzes.submitQuiz(command);
  }

  async listOwnerQuizAttempts(
    userId: number,
    quizId: string,
  ): Promise<QuizAttemptResult[]> {
    return this.quizzes.listOwnerQuizAttempts(userId, quizId);
  }

  requestAdaptiveQuiz(
    command: RequestAdaptiveQuizCommand,
  ): Promise<AdaptiveQuizLoopPublic> {
    return this.quizzes.requestAdaptiveQuiz(command);
  }

  findOwnerAdaptiveQuiz(
    userId: number,
    loopId: string,
  ): Promise<AdaptiveQuizLoopPublic | null> {
    return this.quizzes.findOwnerAdaptiveQuiz(userId, loopId);
  }

  loadAdaptiveQuizGeneration(loopId: string) {
    return this.quizzes.loadAdaptiveQuizGeneration(loopId);
  }

  completeAdaptiveQuizGeneration(
    command: CompleteAdaptiveQuizGenerationCommand,
  ): Promise<boolean> {
    return this.quizzes.completeAdaptiveQuizGeneration(command);
  }

  failAdaptiveQuizGeneration(loopId: string, code: string): Promise<void> {
    return this.quizzes.failAdaptiveQuizGeneration(loopId, code);
  }

  submitAdaptiveQuiz(
    command: SubmitAdaptiveQuizCommand,
  ): Promise<AdaptiveQuizSubmission> {
    return this.quizzes.submitAdaptiveQuiz(command);
  }
}
