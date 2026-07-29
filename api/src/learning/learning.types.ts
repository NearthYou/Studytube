export type AgentRunState =
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'approved'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AgentAttemptState =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ProposedStepStatus = 'ready' | 'needs_replacement';

export type ProposedCourseStep = {
  position: number;
  title: string;
  videoUrl: string;
  thumbnailUrl: string;
  channelName: string;
  sourcePostId: number | null;
  evidenceSourceUrl: string;
  evidenceTimestampSeconds: number;
  evidenceConfidence: number;
  status: ProposedStepStatus;
  durationSeconds: number;
};

export type WatchedRange = {
  start: number;
  end: number;
};

export type AgentBudgets = {
  wallTimeBudgetMs: number;
  toolCallBudget: number;
  tokenBudget: number;
  estimatedCostBudgetUsd: number;
};

export type AgentUsage = {
  toolCalls: number;
  tokens: number;
  estimatedCostUsd: number;
};

export type AgentRun = {
  id: string;
  ownerId: number;
  courseId: number | null;
  state: AgentRunState;
  version: number;
  input: Record<string, unknown>;
  budgets: AgentBudgets;
  usage: AgentUsage;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
  cancellationRequestedAt: string | null;
  failureCode: string | null;
  attempts: AgentRunAttempt[];
  transitions: AgentRunTransition[];
  proposedSteps: ProposedCourseStep[];
};

export type AgentRunTransition = {
  fromState: AgentRunState | null;
  toState: AgentRunState;
  runVersion: number;
  reasonCode: string | null;
  actorKind: 'user' | 'worker' | 'system';
  occurredAt: string;
};

export type AgentRunAttempt = {
  id: string;
  attemptNumber: number;
  state: AgentAttemptState;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  usage: AgentUsage;
};

export type LearningProgress = {
  courseStepId: string;
  watchedRanges: WatchedRange[];
  lastPositionSeconds: number;
  watchedCoverage: number;
  bestQuizScore: number | null;
  completedAt: string | null;
  version: number;
};

export type QuizQuestionPublic = {
  id: string;
  position: number;
  prompt: string;
  choices: string[];
  sourceUrl: string;
  sourceStartSeconds: number;
  sourceEndSeconds: number;
};

export type QuizPublic = {
  id: string;
  courseStepId: string;
  version: number;
  schemaVersion: number;
  maxAttempts: number;
  questions: QuizQuestionPublic[];
};

export type QuizAttemptResult = {
  id: string;
  quizId: string;
  attemptNumber: number;
  score: number;
  submittedAt: string;
  answers: Array<{
    questionId: string;
    selectedChoiceIndex: number;
    correct: boolean;
    correctChoiceIndex: number;
    explanation: string;
  }>;
  bestScore: number;
  latestScore: number;
  attemptsRemaining: number;
};
