import { DurableJobExecutor } from '../work/durable-job.executor';
import { deterministicWorkUuid } from '../work/deterministic-work-id';
import type { WorkAttemptContext, WorkQueueJob } from '../work/work.queue';
import { WorkJobTerminalError } from '../work/work.errors';
import { AiProxyService } from '../ai-proxy.service';
import type { AdaptiveQuizGeneration } from './learning.repository';
import type { LearningService } from './learning.service';

export type QuizGenerationSnapshot = AdaptiveQuizGeneration;

export type GroundedQuizResponse = {
  schemaVersion: 1;
  generatorVersion: string;
  questions: Array<{
    prompt: string;
    choices: string[];
    correctChoiceIndex: number;
    explanation: string;
    citation: {
      resourceId: string;
      sourceUrl: string;
      startSeconds: number;
      endSeconds: number;
      artifactId: string;
      artifactGeneration: number;
    };
  }>;
};

export interface GroundedQuizGenerator {
  generate(
    snapshot: QuizGenerationSnapshot,
    signal: AbortSignal,
  ): Promise<unknown>;
}

export class AiGroundedQuizGenerator implements GroundedQuizGenerator {
  constructor(private readonly ai: Pick<AiProxyService, 'generateQuiz'>) {}

  async generate(
    snapshot: QuizGenerationSnapshot,
    signal: AbortSignal,
  ): Promise<unknown> {
    signal.throwIfAborted();
    return this.ai.generateQuiz(
      {
        studyContextId: snapshot.studyContextId,
        watchedRange: snapshot.watchedRange,
        evidence: snapshot.evidence,
      },
      signal,
    );
  }
}

export class QuizGenerationJobHandler {
  constructor(
    private readonly learning: LearningService,
    private readonly generator: GroundedQuizGenerator,
    private readonly executor: DurableJobExecutor,
  ) {}

  async handle(
    job: WorkQueueJob,
    attempt?: WorkAttemptContext,
  ): Promise<Record<string, unknown>> {
    const loopId = quizLoopId(job);
    try {
      return await this.executor.execute(
        { eventId: job.eventId, handlerVersion: job.handlerVersion },
        (signal) => this.process(job, signal),
        attempt?.isFinalAttempt
          ? {
              code: 'QUIZ_GENERATION_ATTEMPTS_EXHAUSTED',
              attemptsMade: attempt.attemptNumber,
            }
          : undefined,
      );
    } catch (error) {
      if (attempt?.isFinalAttempt && loopId) {
        await this.learning.failAdaptiveQuizGeneration(
          loopId,
          'QUIZ_GENERATION_ATTEMPTS_EXHAUSTED',
        );
      }
      throw error;
    }
  }

  private async process(
    job: WorkQueueJob,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    signal.throwIfAborted();
    if (
      job.eventType !== 'quiz_generation.requested' ||
      job.payloadSchemaVersion !== 2
    ) {
      return this.terminal(job, 'UNSUPPORTED_QUIZ_SCHEMA');
    }
    const loopId = quizLoopId(job);
    if (!loopId) return this.terminal(job, 'INVALID_QUIZ_PAYLOAD');
    const snapshot = await this.learning.loadAdaptiveQuizGeneration(loopId);
    signal.throwIfAborted();
    if (!snapshot) return this.terminal(job, 'QUIZ_LOOP_NOT_FOUND');
    if (snapshot.state === 'ready' || snapshot.state === 'evaluated') {
      return { quizLoopId: loopId, state: 'ready' };
    }
    if (snapshot.state !== 'generating') {
      return this.terminal(job, 'QUIZ_LOOP_NOT_GENERATABLE');
    }

    const generated = await this.generator.generate(snapshot, signal);
    signal.throwIfAborted();
    const parsed = validateGroundedQuiz(generated, snapshot);
    if (!parsed) {
      await this.learning.failAdaptiveQuizGeneration(
        loopId,
        'INVALID_GROUNDED_QUIZ_RESPONSE',
      );
      return this.terminal(job, 'INVALID_GROUNDED_QUIZ_RESPONSE');
    }
    const completed = await this.learning.completeAdaptiveQuizGeneration({
      loopId,
      captionArtifactId: snapshot.captionArtifactId,
      captionGeneration: snapshot.captionGeneration,
      generatorVersion: parsed.generatorVersion,
      questions: parsed.questions.map((question, index) => ({
        id: deterministicWorkUuid(job.eventId, `adaptive-quiz-${index + 1}`),
        prompt: question.prompt,
        choices: question.choices,
        correctChoiceIndex: question.correctChoiceIndex,
        explanation: question.explanation,
        evidencePosition: question.evidencePosition,
      })),
    });
    signal.throwIfAborted();
    if (!completed) return this.terminal(job, 'QUIZ_LOOP_CHECKPOINT_CONFLICT');
    return {
      quizLoopId: loopId,
      state: 'ready',
      questionCount: parsed.questions.length,
      generatorVersion: parsed.generatorVersion,
    };
  }

  private terminal(job: WorkQueueJob, code: string): never {
    throw new WorkJobTerminalError(code, {
      details: { payloadSchemaVersion: job.payloadSchemaVersion },
      result: { code },
    });
  }
}

function quizLoopId(job: WorkQueueJob): string | null {
  const value = job.payload.quizLoopId;
  return typeof value === 'string' && UUID_PATTERN.test(value)
    ? value.toLowerCase()
    : null;
}

function validateGroundedQuiz(
  value: unknown,
  snapshot: QuizGenerationSnapshot,
): {
  generatorVersion: string;
  questions: Array<
    GroundedQuizResponse['questions'][number] & {
      evidencePosition: number;
    }
  >;
} | null {
  if (!value || typeof value !== 'object') return null;
  const root = value as Record<string, unknown>;
  if (
    root.schemaVersion !== 1 ||
    typeof root.generatorVersion !== 'string' ||
    !root.generatorVersion.trim() ||
    root.generatorVersion.length > 128 ||
    !Array.isArray(root.questions) ||
    root.questions.length !== 5 ||
    snapshot.evidence.length !== 5
  ) {
    return null;
  }
  const questions: Array<
    GroundedQuizResponse['questions'][number] & { evidencePosition: number }
  > = [];
  for (const rawQuestion of root.questions) {
    if (!rawQuestion || typeof rawQuestion !== 'object') return null;
    const question = rawQuestion as Record<string, unknown>;
    const rawCitation = question.citation;
    if (
      typeof question.prompt !== 'string' ||
      !Array.isArray(question.choices) ||
      question.choices.some((choice) => typeof choice !== 'string') ||
      typeof question.explanation !== 'string' ||
      typeof question.correctChoiceIndex !== 'number' ||
      !rawCitation ||
      typeof rawCitation !== 'object'
    ) {
      return null;
    }
    const citation = rawCitation as Record<string, unknown>;
    if (
      typeof citation.resourceId !== 'string' ||
      typeof citation.sourceUrl !== 'string' ||
      typeof citation.startSeconds !== 'number' ||
      !Number.isFinite(citation.startSeconds) ||
      typeof citation.endSeconds !== 'number' ||
      !Number.isFinite(citation.endSeconds) ||
      typeof citation.artifactId !== 'string' ||
      typeof citation.artifactGeneration !== 'number' ||
      !Number.isInteger(citation.artifactGeneration)
    ) {
      return null;
    }
    const prompt = question.prompt;
    const choices = question.choices as string[];
    const explanation = question.explanation;
    const correctChoiceIndex = question.correctChoiceIndex;
    const evidenceIndex = snapshot.evidence.findIndex(
      (evidence) =>
        evidence.resourceId === citation.resourceId &&
        evidence.sourceUrl === citation.sourceUrl &&
        evidence.startSeconds === citation.startSeconds &&
        evidence.endSeconds === citation.endSeconds &&
        evidence.artifactId === citation.artifactId &&
        evidence.artifactGeneration === citation.artifactGeneration,
    );
    if (
      evidenceIndex < 0 ||
      citation.startSeconds < snapshot.watchedRange.start ||
      citation.endSeconds > snapshot.watchedRange.end ||
      !prompt.trim() ||
      prompt.length > 1_000 ||
      choices.length < 2 ||
      choices.length > 8 ||
      choices.some((choice) => !choice.trim()) ||
      [prompt, ...choices, explanation].some(isTemporalRecallText) ||
      !Number.isInteger(correctChoiceIndex) ||
      correctChoiceIndex < 0 ||
      correctChoiceIndex >= choices.length ||
      !explanation.trim() ||
      explanation.length > 2_000
    ) {
      return null;
    }
    questions.push({
      prompt,
      choices,
      correctChoiceIndex,
      explanation,
      citation: {
        resourceId: citation.resourceId,
        sourceUrl: citation.sourceUrl,
        startSeconds: citation.startSeconds,
        endSeconds: citation.endSeconds,
        artifactId: citation.artifactId,
        artifactGeneration: citation.artifactGeneration,
      },
      evidencePosition: evidenceIndex + 1,
    });
  }
  return { generatorVersion: root.generatorVersion.trim(), questions };
}

function isTemporalRecallText(text: string): boolean {
  return /(?:\d{1,2}:\d{2}(?::\d{2})?|\d{1,3}\s*(?:초|분)\s*(?:근처|구간|대|지점|시점)\s*(?:에서|에)?|\d{1,3}\s*(?:초|분)\s*(?:에서|부터)\s*(?:나오|말하|설명|언급)|(?:몇\s*(?:초|분|번째)|언제|어느\s*(?:시점|구간)).{0,20}(?:나오|말하|설명|언급)|(?:처음|마지막)\s*(?:에|으로)?\s*(?:나오|말하|설명|언급)|(?:설명한|말한)\s*내용은\s*무엇)/iu.test(
    text,
  );
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
