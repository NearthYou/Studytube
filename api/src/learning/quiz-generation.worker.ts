import { DurableJobExecutor } from '../work/durable-job.executor';
import { deterministicWorkUuid } from '../work/deterministic-work-id';
import type { WorkAttemptContext, WorkQueueJob } from '../work/work.queue';
import { WorkJobTerminalError } from '../work/work.errors';
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
  ): Promise<GroundedQuizResponse>;
}

export class DeterministicGroundedQuizGenerator implements GroundedQuizGenerator {
  generate(
    snapshot: QuizGenerationSnapshot,
    signal: AbortSignal,
  ): Promise<GroundedQuizResponse> {
    signal.throwIfAborted();
    const questions = snapshot.evidence.map((evidence, index) => {
      const distractors = snapshot.evidence
        .filter((_, candidateIndex) => candidateIndex !== index)
        .slice(0, 3)
        .map((candidate) => candidate.content.slice(0, 220));
      const correctChoiceIndex = index % 4;
      const choices = [...distractors];
      choices.splice(correctChoiceIndex, 0, evidence.content.slice(0, 220));
      return {
        prompt: `${evidence.startSeconds}초 근처에서 설명한 내용은 무엇인가요?`,
        choices,
        correctChoiceIndex,
        explanation: `${evidence.startSeconds}초부터 ${evidence.endSeconds}초까지의 자막을 근거로 확인할 수 있습니다.`,
        citation: {
          resourceId: evidence.resourceId,
          sourceUrl: evidence.sourceUrl,
          startSeconds: evidence.startSeconds,
          endSeconds: evidence.endSeconds,
          artifactId: evidence.artifactId,
          artifactGeneration: evidence.artifactGeneration,
        },
      };
    });
    return Promise.resolve({
      schemaVersion: 1,
      generatorVersion: 'evidence-grounded-quiz-v1',
      questions,
    });
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
  value: GroundedQuizResponse,
  snapshot: QuizGenerationSnapshot,
): {
  generatorVersion: string;
  questions: Array<
    GroundedQuizResponse['questions'][number] & {
      evidencePosition: number;
    }
  >;
} | null {
  if (
    value.schemaVersion !== 1 ||
    !value.generatorVersion.trim() ||
    value.generatorVersion.length > 128 ||
    value.questions.length !== 5 ||
    snapshot.evidence.length !== 5
  ) {
    return null;
  }
  const questions = [];
  for (const question of value.questions) {
    const evidenceIndex = snapshot.evidence.findIndex(
      (evidence) =>
        evidence.resourceId === question.citation.resourceId &&
        evidence.sourceUrl === question.citation.sourceUrl &&
        evidence.startSeconds === question.citation.startSeconds &&
        evidence.endSeconds === question.citation.endSeconds &&
        evidence.artifactId === question.citation.artifactId &&
        evidence.artifactGeneration === question.citation.artifactGeneration,
    );
    if (
      evidenceIndex < 0 ||
      question.citation.startSeconds < snapshot.watchedRange.start ||
      question.citation.endSeconds > snapshot.watchedRange.end ||
      !question.prompt.trim() ||
      question.prompt.length > 1_000 ||
      question.choices.length < 2 ||
      question.choices.length > 8 ||
      question.choices.some((choice) => !choice.trim()) ||
      !Number.isInteger(question.correctChoiceIndex) ||
      question.correctChoiceIndex < 0 ||
      question.correctChoiceIndex >= question.choices.length ||
      !question.explanation.trim() ||
      question.explanation.length > 2_000
    ) {
      return null;
    }
    questions.push({ ...question, evidencePosition: evidenceIndex + 1 });
  }
  return { generatorVersion: value.generatorVersion.trim(), questions };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
