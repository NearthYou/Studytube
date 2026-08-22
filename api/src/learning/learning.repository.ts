import type {
  AdaptiveQuizLoopPublic,
  AdaptiveQuizSubmission,
  AgentBudgets,
  AgentRun,
  AgentUsage,
  LearningProgress,
  ProposedCourseStep,
  QuizAttemptResult,
  QuizPublic,
} from './learning.types';
import type { McpLearningCapability } from '../mcp/mcp-service-assertion';

export const LEARNING_REPOSITORY = Symbol('LEARNING_REPOSITORY');

export type CreateAgentRunCommand = {
  ownerId: number;
  idempotencyKeyDigest: Buffer;
  payloadHash: Buffer;
  input: {
    objective: string;
    requestedStepCount: number;
    studyContextId?: string;
    watchedRanges?: Array<{ start: number; end: number }>;
  };
  budgets: AgentBudgets;
};

export type VersionedRunCommand = {
  ownerId: number;
  runId: string;
  expectedVersion: number;
};

export type ClaimAgentRun = {
  run: AgentRun;
  attemptId: string;
  attemptNumber: number;
  leaseToken: string;
};

export type CompleteAgentRunCommand = {
  runId: string;
  attemptId: string;
  leaseToken: string;
  expectedVersion: number;
  usage: AgentUsage;
  proposedSteps: ProposedCourseStep[];
};

export type ReserveAgentRunUsageCommand = {
  runId: string;
  attemptId: string;
  leaseToken: string;
  expectedVersion: number;
  usage: AgentUsage;
};

export type ReserveAgentRunUsageResult =
  | { status: 'reserved'; wallTimeDeadlineAtMs: number }
  | { status: 'reservation_conflict' }
  | { status: 'budget_exhausted' }
  | { status: 'lease_lost' };

export type FailAgentRunCommand = Omit<
  CompleteAgentRunCommand,
  'proposedSteps'
> & {
  failureCode: string;
  failureMessage: string;
};

export type RecordProgressCommand = {
  userId: number;
  courseStepId: string;
  idempotencyKeyDigest: Buffer;
  payloadHash: Buffer;
  startSeconds: number;
  endSeconds: number;
  lastPositionSeconds: number;
  occurredAt: Date;
};

export type QuizQuestionInput = {
  prompt: string;
  choices: string[];
  correctChoiceIndex: number;
  explanation: string;
  sourceUrl: string;
  sourceStartSeconds: number;
  sourceEndSeconds: number;
};

export type CreateQuizCommand = {
  quizId?: string;
  courseStepId: string;
  schemaVersion: number;
  generatorVersion: string;
  maxAttempts: number;
  questions: QuizQuestionInput[];
};

export type SubmitQuizCommand = {
  userId: number;
  quizId: string;
  idempotencyKeyDigest: Buffer;
  payloadHash: Buffer;
  answers: Array<{ questionId: string; selectedChoiceIndex: number }>;
};

export type RequestAdaptiveQuizCommand = {
  userId: number;
  studyContextId: string;
  idempotencyKeyDigest: Buffer;
  payloadHash: Buffer;
  watchedRange: { start: number; end: number };
};

export type AdaptiveQuizEvidence = {
  resourceId: string;
  content: string;
  sourceUrl: string;
  startSeconds: number;
  endSeconds: number;
  artifactId: string;
  artifactGeneration: number;
};

export type AdaptiveQuizGeneration = {
  loopId: string;
  state: 'generating' | 'ready' | 'evaluated' | 'failed' | 'stale';
  ownerId: number;
  studyContextId: string;
  captionArtifactId: string;
  captionGeneration: number;
  watchedRange: { start: number; end: number };
  evidence: AdaptiveQuizEvidence[];
};

export type CompleteAdaptiveQuizGenerationCommand = {
  loopId: string;
  captionArtifactId: string;
  captionGeneration: number;
  generatorVersion: string;
  questions: Array<{
    id: string;
    prompt: string;
    choices: string[];
    correctChoiceIndex: number;
    explanation: string;
    evidencePosition: number;
  }>;
};

export type SubmitAdaptiveQuizCommand = {
  userId: number;
  loopId: string;
  idempotencyKeyDigest: Buffer;
  payloadHash: Buffer;
  answers: Array<{ questionId: string; selectedChoiceIndex: number }>;
};

export type RecordAgentToolCallCommand = {
  ownerId: number;
  runId: string;
  attemptId: string;
  requestId: string;
  toolName: string;
  inputSchemaVersion: number;
  outputSchemaVersion: number | null;
  durationMs: number;
  outcome:
    | 'succeeded'
    | 'timeout'
    | 'invalid_schema'
    | 'failed'
    | 'budget_exhausted';
  source: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
};

export type AuthorizeAgentMcpCallCommand = {
  ownerId: number;
  runId: string;
  attemptId: string;
  leaseToken: string;
  contextSnapshotId: string;
  capability: McpLearningCapability;
};

export type SettleAgentWorkItemCommand = {
  courseStepId: string;
  kind: 'video_asset' | 'retrieval_embedding' | 'quiz_generation';
  outcome: 'completed' | 'failed';
  reasonCode?: string;
};

export interface LearningRepository {
  createRun(command: CreateAgentRunCommand): Promise<AgentRun>;
  findOwnerRun(ownerId: number, runId: string): Promise<AgentRun | null>;
  cancelRun(command: VersionedRunCommand): Promise<AgentRun>;
  retryRun(command: VersionedRunCommand): Promise<AgentRun>;
  approveRun(command: VersionedRunCommand): Promise<AgentRun>;
  claimRunAttempt(
    workerId: string,
    leaseMs: number,
  ): Promise<ClaimAgentRun | null>;
  reserveRunUsage(
    command: ReserveAgentRunUsageCommand,
  ): Promise<ReserveAgentRunUsageResult>;
  completeRunAttempt(command: CompleteAgentRunCommand): Promise<boolean>;
  failRunAttempt(command: FailAgentRunCommand): Promise<boolean>;
  recordProgress(command: RecordProgressCommand): Promise<LearningProgress>;
  findOwnerProgress(
    userId: number,
    courseStepId: string,
  ): Promise<LearningProgress | null>;
  createQuiz(command: CreateQuizCommand): Promise<void>;
  findOwnerQuiz(
    userId: number,
    courseStepId: string,
  ): Promise<QuizPublic | null>;
  submitQuiz(command: SubmitQuizCommand): Promise<QuizAttemptResult>;
  listOwnerQuizAttempts(
    userId: number,
    quizId: string,
  ): Promise<QuizAttemptResult[]>;
  requestAdaptiveQuiz(
    command: RequestAdaptiveQuizCommand,
  ): Promise<AdaptiveQuizLoopPublic>;
  findOwnerAdaptiveQuiz(
    userId: number,
    loopId: string,
  ): Promise<AdaptiveQuizLoopPublic | null>;
  loadAdaptiveQuizGeneration(
    loopId: string,
  ): Promise<AdaptiveQuizGeneration | null>;
  completeAdaptiveQuizGeneration(
    command: CompleteAdaptiveQuizGenerationCommand,
  ): Promise<boolean>;
  failAdaptiveQuizGeneration(loopId: string, code: string): Promise<void>;
  submitAdaptiveQuiz(
    command: SubmitAdaptiveQuizCommand,
  ): Promise<AdaptiveQuizSubmission>;
  recordAgentToolCall(command: RecordAgentToolCallCommand): Promise<boolean>;
  authorizeAgentMcpCall(
    command: AuthorizeAgentMcpCallCommand,
  ): Promise<boolean>;
  settleAgentWorkItem(command: SettleAgentWorkItemCommand): Promise<void>;
}
