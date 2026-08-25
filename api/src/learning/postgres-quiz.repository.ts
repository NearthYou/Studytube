import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  LearningAttemptLimitError,
  LearningEvidenceNotReadyError,
  LearningIdempotencyConflictError,
  LearningLifecycleError,
  LearningNotFoundError,
  LearningQuizStaleError,
  LearningValidationError,
} from './learning.errors';
import type {
  AdaptiveQuizGeneration,
  CompleteAdaptiveQuizGenerationCommand,
  CreateQuizCommand,
  QuizQuestionInput,
  RequestAdaptiveQuizCommand,
  SubmitAdaptiveQuizCommand,
  SubmitQuizCommand,
} from './learning.repository';
import type {
  AdaptiveQuizLoopPublic,
  AdaptiveQuizSubmission,
  QuizAttemptResult,
  QuizPublic,
} from './learning.types';
import {
  assertOrAdoptLegacyHash,
  iso,
  mutate,
  type SqlClient,
  translatePostgresError,
} from './postgres-learning.persistence';
import { PostgresLearningProgressRepository } from './postgres-learning-progress.repository';

function sameQuizQuestions(
  persisted: QuizQuestionInput[],
  requested: QuizQuestionInput[],
): boolean {
  return (
    persisted.length === requested.length &&
    persisted.every((question, index) => {
      const expected = requested[index];
      return (
        expected !== undefined &&
        question.prompt === expected.prompt &&
        question.correctChoiceIndex === expected.correctChoiceIndex &&
        question.explanation === expected.explanation &&
        question.sourceUrl === expected.sourceUrl &&
        question.sourceStartSeconds === expected.sourceStartSeconds &&
        question.sourceEndSeconds === expected.sourceEndSeconds &&
        question.choices.length === expected.choices.length &&
        question.choices.every(
          (choice, choiceIndex) => choice === expected.choices[choiceIndex],
        )
      );
    })
  );
}

export class PostgresQuizRepository {
  constructor(
    private readonly pool: Pool,
    private readonly progress: PostgresLearningProgressRepository,
  ) {}

  async createQuiz(command: CreateQuizCommand): Promise<void> {
    if (command.questions.length !== 5) {
      throw new LearningValidationError(
        'questions',
        'Exactly 5 quiz questions are required',
      );
    }
    if (
      !Number.isInteger(command.maxAttempts) ||
      command.maxAttempts < 1 ||
      command.maxAttempts > 10
    ) {
      throw new LearningValidationError(
        'maxAttempts',
        'Invalid quiz attempt limit',
      );
    }
    const quizId = command.quizId ?? randomUUID();
    await mutate(this.pool, async (client) => {
      await client.query(
        'SELECT id FROM course_steps WHERE id = $1::bigint FOR UPDATE',
        [command.courseStepId],
      );
      if (command.quizId) {
        const existing = await client.query<{
          courseStepId: string;
          status: 'draft' | 'published' | 'retired';
          schemaVersion: number;
          generatorVersion: string;
          maxAttempts: number;
        }>(
          `
            SELECT course_step_id::text AS "courseStepId", status,
                   schema_version AS "schemaVersion",
                   generator_version AS "generatorVersion",
                   max_attempts AS "maxAttempts"
            FROM quizzes
            WHERE id = $1
            FOR UPDATE
          `,
          [quizId],
        );
        if (existing.rows[0]) {
          const questions = await client.query<QuizQuestionInput>(
            `
              SELECT prompt, choices,
                     correct_choice_index AS "correctChoiceIndex",
                     explanation, source_url AS "sourceUrl",
                     source_start_seconds AS "sourceStartSeconds",
                     source_end_seconds AS "sourceEndSeconds"
              FROM quiz_questions
              WHERE quiz_id = $1
              ORDER BY position
            `,
            [quizId],
          );
          const row = existing.rows[0];
          if (
            row.courseStepId === command.courseStepId &&
            row.status !== 'draft' &&
            row.schemaVersion === command.schemaVersion &&
            row.generatorVersion === command.generatorVersion &&
            row.maxAttempts === command.maxAttempts &&
            sameQuizQuestions(questions.rows, command.questions)
          ) {
            return;
          }
          throw new LearningIdempotencyConflictError();
        }
      }
      const version = await client.query<{ version: number }>(
        `SELECT COALESCE(max(version), 0)::integer + 1 AS version FROM quizzes WHERE course_step_id = $1::bigint`,
        [command.courseStepId],
      );
      await client.query(
        `UPDATE quizzes SET status = 'retired' WHERE course_step_id = $1::bigint AND status = 'published'`,
        [command.courseStepId],
      );
      await client.query(
        `
          INSERT INTO quizzes (
            id, course_step_id, version, status,
            schema_version, generator_version, max_attempts
          )
          VALUES ($1, $2::bigint, $3, 'draft', $4, $5, $6)
        `,
        [
          quizId,
          command.courseStepId,
          version.rows[0]?.version ?? 1,
          command.schemaVersion,
          command.generatorVersion,
          command.maxAttempts,
        ],
      );
      for (const [index, question] of command.questions.entries()) {
        if (
          question.choices.length < 2 ||
          question.correctChoiceIndex < 0 ||
          question.correctChoiceIndex >= question.choices.length ||
          !question.sourceUrl.trim()
        ) {
          throw new LearningValidationError(
            'questions',
            'Quiz question is invalid',
          );
        }
        await client.query(
          `
            INSERT INTO quiz_questions (
              id, quiz_id, position, prompt, choices,
              correct_choice_index, explanation, source_url,
              source_start_seconds, source_end_seconds
            )
            VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)
          `,
          [
            randomUUID(),
            quizId,
            index + 1,
            question.prompt,
            JSON.stringify(question.choices),
            question.correctChoiceIndex,
            question.explanation,
            question.sourceUrl,
            question.sourceStartSeconds,
            question.sourceEndSeconds,
          ],
        );
      }
      await client.query(
        `UPDATE quizzes SET status = 'published', published_at = statement_timestamp() WHERE id = $1`,
        [quizId],
      );
    });
  }

  async findOwnerQuiz(
    userId: number,
    courseStepId: string,
  ): Promise<QuizPublic | null> {
    try {
      const quiz = await this.pool.query<{
        id: string;
        courseStepId: string;
        version: number;
        schemaVersion: number;
        maxAttempts: number;
      }>(
        `
          SELECT q.id, q.course_step_id::text AS "courseStepId",
                 q.version, q.schema_version AS "schemaVersion",
                 q.max_attempts AS "maxAttempts"
          FROM quizzes q
          JOIN course_steps cs ON cs.id = q.course_step_id
          JOIN courses c ON c.id = cs.course_id
          WHERE q.course_step_id = $1::bigint AND q.status = 'published'
            AND (c.owner_id = $2 OR (c.status = 'published' AND c.visibility = 'public'))
          ORDER BY q.version DESC
          LIMIT 1
        `,
        [courseStepId, userId],
      );
      const row = quiz.rows[0];
      if (!row) return null;
      const questions = await this.pool.query<{
        id: string;
        position: number;
        prompt: string;
        choices: string[];
        sourceUrl: string;
        sourceStartSeconds: number;
        sourceEndSeconds: number;
      }>(
        `
          SELECT id, position, prompt, choices,
                 source_url AS "sourceUrl",
                 source_start_seconds AS "sourceStartSeconds",
                 source_end_seconds AS "sourceEndSeconds"
          FROM quiz_questions
          WHERE quiz_id = $1
          ORDER BY position
        `,
        [row.id],
      );
      return { ...row, questions: questions.rows };
    } catch (error) {
      throw translatePostgresError(error);
    }
  }

  async submitQuiz(command: SubmitQuizCommand): Promise<QuizAttemptResult> {
    return mutate(this.pool, async (client) => {
      const quiz = await client.query<{
        id: string;
        courseStepId: string;
        maxAttempts: number;
      }>(
        `
          SELECT q.id, q.course_step_id::text AS "courseStepId",
                 q.max_attempts AS "maxAttempts"
          FROM quizzes q
          JOIN course_steps cs ON cs.id = q.course_step_id
          JOIN courses c ON c.id = cs.course_id
          WHERE q.id = $1 AND q.status = 'published'
            AND (c.owner_id = $2 OR (c.status = 'published' AND c.visibility = 'public'))
          FOR UPDATE OF q
        `,
        [command.quizId, command.userId],
      );
      const quizRow = quiz.rows[0];
      if (!quizRow) throw new LearningNotFoundError();

      const duplicate = await client.query<{ id: string; payloadHash: Buffer }>(
        `
          SELECT id, payload_hash AS "payloadHash"
          FROM quiz_attempts
          WHERE quiz_id = $1 AND user_id = $2 AND idempotency_key_digest = $3
        `,
        [command.quizId, command.userId, command.idempotencyKeyDigest],
      );
      if (duplicate.rows[0]) {
        await assertOrAdoptLegacyHash(
          client,
          'quiz_attempts',
          duplicate.rows[0].id,
          duplicate.rows[0].payloadHash,
          command.payloadHash,
        );
        return this.requireQuizAttempt(
          client,
          command.userId,
          duplicate.rows[0].id,
        );
      }

      const questions = await client.query<{
        id: string;
        correctChoiceIndex: number;
        choiceCount: number;
      }>(
        `
          SELECT id, correct_choice_index AS "correctChoiceIndex",
                 jsonb_array_length(choices) AS "choiceCount"
          FROM quiz_questions
          WHERE quiz_id = $1
          ORDER BY position
        `,
        [command.quizId],
      );
      if (questions.rows.length !== 5 || command.answers.length !== 5) {
        throw new LearningValidationError(
          'answers',
          'Exactly 5 answers are required',
        );
      }
      const byQuestion = new Map(
        command.answers.map((answer) => [answer.questionId, answer]),
      );
      if (
        byQuestion.size !== 5 ||
        questions.rows.some((question) => !byQuestion.has(question.id))
      ) {
        throw new LearningValidationError(
          'answers',
          'Every quiz question must be answered once',
        );
      }
      if (
        questions.rows.some(
          (question) =>
            byQuestion.get(question.id)!.selectedChoiceIndex >=
            question.choiceCount,
        )
      ) {
        throw new LearningValidationError(
          'answers',
          'selectedChoiceIndex exceeds the available choices',
        );
      }
      const count = await client.query<{ count: number }>(
        `SELECT count(*)::integer AS count FROM quiz_attempts WHERE quiz_id = $1 AND user_id = $2`,
        [command.quizId, command.userId],
      );
      const previousAttempts = count.rows[0]?.count ?? 0;
      if (previousAttempts >= quizRow.maxAttempts) {
        throw new LearningAttemptLimitError();
      }
      const correct = questions.rows.filter(
        (question) =>
          byQuestion.get(question.id)?.selectedChoiceIndex ===
          question.correctChoiceIndex,
      ).length;
      const score = (correct / 5) * 100;
      const attemptId = randomUUID();
      await client.query(
        `
          INSERT INTO quiz_attempts (
            id, quiz_id, user_id, idempotency_key_digest,
            payload_hash, attempt_number, score
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          attemptId,
          command.quizId,
          command.userId,
          command.idempotencyKeyDigest,
          command.payloadHash,
          previousAttempts + 1,
          score,
        ],
      );
      for (const question of questions.rows) {
        const answer = byQuestion.get(question.id)!;
        await client.query(
          `
            INSERT INTO quiz_answers (
              attempt_id, question_id, selected_choice_index, correct
            )
            VALUES ($1, $2, $3, $4)
          `,
          [
            attemptId,
            question.id,
            answer.selectedChoiceIndex,
            answer.selectedChoiceIndex === question.correctChoiceIndex,
          ],
        );
      }
      await this.progress.updateFromQuiz(
        client,
        command.userId,
        quizRow.courseStepId,
        score,
      );
      return this.requireQuizAttempt(client, command.userId, attemptId);
    });
  }

  async listOwnerQuizAttempts(
    userId: number,
    quizId: string,
  ): Promise<QuizAttemptResult[]> {
    try {
      const ids = await this.pool.query<{ id: string }>(
        `
          SELECT id FROM quiz_attempts
          WHERE quiz_id = $1 AND user_id = $2
          ORDER BY attempt_number
        `,
        [quizId, userId],
      );
      const attempts: QuizAttemptResult[] = [];
      for (const row of ids.rows) {
        attempts.push(await this.requireQuizAttempt(this.pool, userId, row.id));
      }
      return attempts;
    } catch (error) {
      throw translatePostgresError(error);
    }
  }

  async requestAdaptiveQuiz(
    command: RequestAdaptiveQuizCommand,
  ): Promise<AdaptiveQuizLoopPublic> {
    return mutate(this.pool, async (client) => {
      const context = await client.query<{
        learningItemId: string;
        videoSourceId: string;
        captionArtifactId: string;
        captionGeneration: number;
        retrievalVersion: string;
      }>(
        `
          SELECT context.learning_item_id::text AS "learningItemId",
                 item.video_source_id::text AS "videoSourceId",
                 artifact.id::text AS "captionArtifactId",
                 artifact.generation AS "captionGeneration",
                 context.retrieval_version::text AS "retrievalVersion"
          FROM study_contexts AS context
          JOIN learning_items AS item ON item.id = context.learning_item_id
            AND item.user_id = context.user_id
          JOIN caption_artifacts AS artifact ON artifact.id = COALESCE(
            context.current_translation_caption_artifact_id,
            context.current_source_caption_artifact_id
          ) AND artifact.video_source_id = item.video_source_id
          JOIN caption_generation_states AS state ON state.artifact_id = artifact.id
            AND state.status = 'ready'
          WHERE context.id = $1::bigint AND context.user_id = $2
          FOR UPDATE OF context
        `,
        [command.studyContextId, command.userId],
      );
      const pinned = context.rows[0];
      if (!pinned) throw new LearningEvidenceNotReadyError();

      const duplicate = await client.query<{
        id: string;
        payloadHash: Buffer;
      }>(
        `SELECT id::text AS id, payload_hash AS "payloadHash"
         FROM adaptive_quiz_loops
         WHERE owner_id = $1 AND study_context_id = $2::bigint
           AND idempotency_key_digest = $3`,
        [command.userId, command.studyContextId, command.idempotencyKeyDigest],
      );
      if (duplicate.rows[0]) {
        await assertOrAdoptLegacyHash(
          client,
          'adaptive_quiz_loops',
          duplicate.rows[0].id,
          duplicate.rows[0].payloadHash,
          command.payloadHash,
        );
        return this.requireAdaptiveQuiz(
          client,
          command.userId,
          duplicate.rows[0].id,
        );
      }

      const evidence = await client.query<{
        resourceId: string;
        content: string;
        sourceUrl: string;
        startSeconds: number;
        endSeconds: number;
      }>(
        `
          WITH retrieval_evidence AS (
            SELECT resource_id AS "resourceId", content,
                   source_url AS "sourceUrl",
                   start_seconds AS "startSeconds",
                   end_seconds AS "endSeconds"
            FROM retrieval_embeddings
            WHERE source_kind = 'learning_context'
              AND source_id = $1::bigint AND owner_id = $2
              AND visibility = 'private' AND evidence_kind = 'caption_segment'
              AND readiness IN ('partial', 'ready')
              AND evidence_artifact_id = $3::bigint
              AND artifact_generation = $4
              AND source_version = $5::bigint
              AND start_seconds >= $6 AND end_seconds <= $7
            ORDER BY start_seconds, chunk_index
            LIMIT 5
          ), caption_evidence AS (
            SELECT 'caption-segment:' || segment.id::text AS "resourceId",
                   segment.text AS content,
                   source.canonical_url AS "sourceUrl",
                   floor(segment.start_seconds)::integer AS "startSeconds",
                   greatest(
                     floor(segment.start_seconds)::integer + 1,
                     ceil(segment.end_seconds)::integer
                   ) AS "endSeconds"
            FROM caption_artifact_segments AS segment
            JOIN caption_artifacts AS artifact ON artifact.id = segment.artifact_id
            JOIN video_sources AS source ON source.id = artifact.video_source_id
            WHERE segment.artifact_id = $3::bigint
              AND segment.start_seconds >= $6 AND segment.end_seconds <= $7
            ORDER BY segment.start_seconds, segment.ordinal
            LIMIT 5
          )
          SELECT * FROM retrieval_evidence
          WHERE (SELECT count(*) FROM retrieval_evidence) = 5
          UNION ALL
          SELECT * FROM caption_evidence
          WHERE (SELECT count(*) FROM retrieval_evidence) < 5
          ORDER BY "startSeconds"
          LIMIT 5
        `,
        [
          command.studyContextId,
          command.userId,
          pinned.captionArtifactId,
          pinned.captionGeneration,
          pinned.retrievalVersion,
          command.watchedRange.start,
          command.watchedRange.end,
        ],
      );
      if (evidence.rows.length !== 5) {
        throw new LearningEvidenceNotReadyError();
      }

      const loopId = randomUUID();
      const eventId = randomUUID();
      await client.query(
        `
          INSERT INTO adaptive_quiz_loops (
            id, owner_id, study_context_id, learning_item_id, video_source_id,
            caption_artifact_id, caption_generation, watched_ranges,
            idempotency_key_digest, payload_hash, generation_event_id
          ) VALUES ($1, $2, $3::bigint, $4::bigint, $5::bigint,
                    $6::bigint, $7, $8::jsonb, $9, $10, $11)
        `,
        [
          loopId,
          command.userId,
          command.studyContextId,
          pinned.learningItemId,
          pinned.videoSourceId,
          pinned.captionArtifactId,
          pinned.captionGeneration,
          JSON.stringify([command.watchedRange]),
          command.idempotencyKeyDigest,
          command.payloadHash,
          eventId,
        ],
      );
      for (const [index, row] of evidence.rows.entries()) {
        await client.query(
          `INSERT INTO adaptive_quiz_evidence (
             loop_id, position, resource_id, content, source_url,
             start_seconds, end_seconds, artifact_id, artifact_generation
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::bigint, $9)`,
          [
            loopId,
            index + 1,
            row.resourceId,
            row.content,
            row.sourceUrl,
            row.startSeconds,
            row.endSeconds,
            pinned.captionArtifactId,
            pinned.captionGeneration,
          ],
        );
      }
      await client.query(
        `INSERT INTO work_outbox_events (
           id, event_type, aggregate_type, aggregate_id, aggregate_version,
           payload_schema_version, payload
         ) VALUES ($1, 'quiz_generation.requested', 'learning_quiz_loop',
                   $2, 1, 2, $3::jsonb)`,
        [eventId, loopId, JSON.stringify({ quizLoopId: loopId })],
      );
      return this.requireAdaptiveQuiz(client, command.userId, loopId);
    });
  }

  async findOwnerAdaptiveQuiz(
    userId: number,
    loopId: string,
  ): Promise<AdaptiveQuizLoopPublic | null> {
    return mutate(this.pool, async (client) => {
      const current = await client.query<{ stale: boolean }>(
        `SELECT COALESCE(
                  context.current_translation_caption_artifact_id,
                  context.current_source_caption_artifact_id
                ) IS DISTINCT FROM loop.caption_artifact_id AS stale
         FROM adaptive_quiz_loops AS loop
         JOIN study_contexts AS context ON context.id = loop.study_context_id
         WHERE loop.id = $1 AND loop.owner_id = $2
         FOR UPDATE OF loop`,
        [loopId, userId],
      );
      if (!current.rows[0]) return null;
      if (current.rows[0].stale) {
        await client.query(
          `UPDATE adaptive_quiz_loops SET state = 'stale', updated_at = statement_timestamp()
           WHERE id = $1 AND state IN ('generating', 'ready')`,
          [loopId],
        );
      }
      return this.requireAdaptiveQuiz(client, userId, loopId);
    });
  }

  async loadAdaptiveQuizGeneration(
    loopId: string,
  ): Promise<AdaptiveQuizGeneration | null> {
    const loop = await this.pool.query<{
      loopId: string;
      state: AdaptiveQuizGeneration['state'];
      ownerId: number;
      studyContextId: string;
      captionArtifactId: string;
      captionGeneration: number;
      watchedRanges: Array<{ start: number; end: number }>;
    }>(
      `SELECT id::text AS "loopId", state, owner_id AS "ownerId",
              study_context_id::text AS "studyContextId",
              caption_artifact_id::text AS "captionArtifactId",
              caption_generation AS "captionGeneration",
              watched_ranges AS "watchedRanges"
       FROM adaptive_quiz_loops WHERE id = $1`,
      [loopId],
    );
    const row = loop.rows[0];
    if (!row) return null;
    const evidence = await this.pool.query<
      AdaptiveQuizGeneration['evidence'][number]
    >(
      `SELECT resource_id AS "resourceId", content,
              source_url AS "sourceUrl", start_seconds AS "startSeconds",
              end_seconds AS "endSeconds", artifact_id::text AS "artifactId",
              artifact_generation AS "artifactGeneration"
       FROM adaptive_quiz_evidence WHERE loop_id = $1 ORDER BY position`,
      [loopId],
    );
    return {
      ...row,
      watchedRange: row.watchedRanges[0],
      evidence: evidence.rows,
    };
  }

  async completeAdaptiveQuizGeneration(
    command: CompleteAdaptiveQuizGenerationCommand,
  ): Promise<boolean> {
    return mutate(this.pool, async (client) => {
      const loop = await client.query<{
        state: AdaptiveQuizGeneration['state'];
        captionArtifactId: string;
        captionGeneration: number;
      }>(
        `SELECT state, caption_artifact_id::text AS "captionArtifactId",
                caption_generation AS "captionGeneration"
         FROM adaptive_quiz_loops WHERE id = $1 FOR UPDATE`,
        [command.loopId],
      );
      const row = loop.rows[0];
      if (!row) return false;
      if (row.state === 'ready' || row.state === 'evaluated') return true;
      if (
        row.state !== 'generating' ||
        row.captionArtifactId !== command.captionArtifactId ||
        row.captionGeneration !== command.captionGeneration
      ) {
        return false;
      }
      for (const [index, question] of command.questions.entries()) {
        await client.query(
          `INSERT INTO adaptive_quiz_questions (
             id, loop_id, position, prompt, choices, correct_choice_index,
             explanation, evidence_position
           ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
          [
            question.id,
            command.loopId,
            index + 1,
            question.prompt,
            JSON.stringify(question.choices),
            question.correctChoiceIndex,
            question.explanation,
            question.evidencePosition,
          ],
        );
      }
      await client.query(
        `UPDATE adaptive_quiz_loops
         SET state = 'ready', generator_version = $2,
             updated_at = statement_timestamp(), failure_code = NULL
         WHERE id = $1`,
        [command.loopId, command.generatorVersion],
      );
      return true;
    });
  }

  async failAdaptiveQuizGeneration(
    loopId: string,
    code: string,
  ): Promise<void> {
    if (!/^[A-Z][A-Z0-9_]{2,63}$/u.test(code)) {
      throw new LearningValidationError(
        'failureCode',
        'Invalid safe failure code',
      );
    }
    await this.pool.query(
      `UPDATE adaptive_quiz_loops
       SET state = 'failed', failure_code = $2, updated_at = statement_timestamp()
       WHERE id = $1 AND state = 'generating'`,
      [loopId, code],
    );
  }

  async submitAdaptiveQuiz(
    command: SubmitAdaptiveQuizCommand,
  ): Promise<AdaptiveQuizSubmission> {
    const result = await mutate(this.pool, async (client) => {
      const loop = await client.query<{
        state: AdaptiveQuizGeneration['state'];
        captionArtifactId: string;
        currentArtifactId: string | null;
      }>(
        `SELECT loop.state,
                loop.caption_artifact_id::text AS "captionArtifactId",
                COALESCE(context.current_translation_caption_artifact_id,
                         context.current_source_caption_artifact_id)::text AS "currentArtifactId"
         FROM adaptive_quiz_loops AS loop
         JOIN study_contexts AS context ON context.id = loop.study_context_id
         WHERE loop.id = $1 AND loop.owner_id = $2
         FOR UPDATE OF loop`,
        [command.loopId, command.userId],
      );
      const loopRow = loop.rows[0];
      if (!loopRow) throw new LearningNotFoundError();
      if (loopRow.currentArtifactId !== loopRow.captionArtifactId) {
        await client.query(
          `UPDATE adaptive_quiz_loops SET state = 'stale', updated_at = statement_timestamp()
           WHERE id = $1`,
          [command.loopId],
        );
        return { stale: true as const };
      }

      const duplicate = await client.query<{ id: string; payloadHash: Buffer }>(
        `SELECT id::text AS id, payload_hash AS "payloadHash"
         FROM adaptive_quiz_attempts
         WHERE loop_id = $1 AND owner_id = $2 AND idempotency_key_digest = $3`,
        [command.loopId, command.userId, command.idempotencyKeyDigest],
      );
      if (duplicate.rows[0]) {
        await assertOrAdoptLegacyHash(
          client,
          'adaptive_quiz_attempts',
          duplicate.rows[0].id,
          duplicate.rows[0].payloadHash,
          command.payloadHash,
        );
        return {
          stale: false as const,
          submission: await this.requireAdaptiveSubmission(
            client,
            command.userId,
            command.loopId,
          ),
        };
      }
      if (loopRow.state !== 'ready') {
        throw new LearningLifecycleError('Quiz is not ready for answers');
      }

      const questions = await client.query<{
        id: string;
        correctChoiceIndex: number;
        choiceCount: number;
      }>(
        `SELECT id::text AS id, correct_choice_index AS "correctChoiceIndex",
                jsonb_array_length(choices) AS "choiceCount"
         FROM adaptive_quiz_questions WHERE loop_id = $1 ORDER BY position`,
        [command.loopId],
      );
      const byQuestion = new Map(
        command.answers.map((answer) => [answer.questionId, answer]),
      );
      if (
        questions.rows.length !== 5 ||
        byQuestion.size !== 5 ||
        questions.rows.some(
          (question) =>
            !byQuestion.has(question.id) ||
            byQuestion.get(question.id)!.selectedChoiceIndex >=
              question.choiceCount,
        )
      ) {
        throw new LearningValidationError(
          'answers',
          'Every quiz question must be answered once',
        );
      }
      const correctCount = questions.rows.filter(
        (question) =>
          byQuestion.get(question.id)!.selectedChoiceIndex ===
          question.correctChoiceIndex,
      ).length;
      const attemptId = randomUUID();
      await client.query(
        `INSERT INTO adaptive_quiz_attempts (
           id, loop_id, owner_id, idempotency_key_digest, payload_hash, score
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          attemptId,
          command.loopId,
          command.userId,
          command.idempotencyKeyDigest,
          command.payloadHash,
          (correctCount / 5) * 100,
        ],
      );
      for (const question of questions.rows) {
        const answer = byQuestion.get(question.id)!;
        await client.query(
          `INSERT INTO adaptive_quiz_answers (
             attempt_id, question_id, selected_choice_index, correct
           ) VALUES ($1, $2, $3, $4)`,
          [
            attemptId,
            question.id,
            answer.selectedChoiceIndex,
            answer.selectedChoiceIndex === question.correctChoiceIndex,
          ],
        );
      }
      const wrong = await client.query<{
        sourceUrl: string;
        startSeconds: number;
        endSeconds: number;
      }>(
        `SELECT evidence.source_url AS "sourceUrl",
                evidence.start_seconds AS "startSeconds",
                evidence.end_seconds AS "endSeconds"
         FROM adaptive_quiz_answers AS answer
         JOIN adaptive_quiz_questions AS question ON question.id = answer.question_id
         JOIN adaptive_quiz_evidence AS evidence
           ON evidence.loop_id = question.loop_id
          AND evidence.position = question.evidence_position
         WHERE answer.attempt_id = $1 AND answer.correct = false
         ORDER BY question.position LIMIT 1`,
        [attemptId],
      );
      if (wrong.rows[0]) {
        await client.query(
          `INSERT INTO adaptive_quiz_review_proposals (
             id, loop_id, attempt_id, kind, reason_code,
             source_url, start_seconds, end_seconds
           ) VALUES ($1, $2, $3, 'review_range', 'INCORRECT_ANSWER', $4, $5, $6)`,
          [
            randomUUID(),
            command.loopId,
            attemptId,
            wrong.rows[0].sourceUrl,
            wrong.rows[0].startSeconds,
            wrong.rows[0].endSeconds,
          ],
        );
      }
      await client.query(
        `UPDATE adaptive_quiz_loops
         SET state = 'evaluated', evaluated_at = statement_timestamp(),
             updated_at = statement_timestamp()
         WHERE id = $1`,
        [command.loopId],
      );
      return {
        stale: false as const,
        submission: await this.requireAdaptiveSubmission(
          client,
          command.userId,
          command.loopId,
        ),
      };
    });
    if (result.stale) throw new LearningQuizStaleError();
    return result.submission;
  }

  private async requireAdaptiveQuiz(
    client: SqlClient,
    userId: number,
    loopId: string,
  ): Promise<AdaptiveQuizLoopPublic> {
    const loop = await client.query<{
      id: string;
      studyContextId: string;
      state: AdaptiveQuizLoopPublic['state'];
      watchedRanges: Array<{ start: number; end: number }>;
      captionArtifactId: string;
      captionGeneration: number;
      failureCode: string | null;
    }>(
      `SELECT id::text AS id, study_context_id::text AS "studyContextId",
              state, watched_ranges AS "watchedRanges",
              caption_artifact_id::text AS "captionArtifactId",
              caption_generation AS "captionGeneration",
              failure_code AS "failureCode"
       FROM adaptive_quiz_loops WHERE id = $1 AND owner_id = $2`,
      [loopId, userId],
    );
    const row = loop.rows[0];
    if (!row) throw new LearningNotFoundError();
    const questions = await client.query<
      AdaptiveQuizLoopPublic['questions'][number]
    >(
      `SELECT question.id::text AS id, question.position, question.prompt,
              question.choices,
              jsonb_build_object(
                'resourceId', evidence.resource_id,
                'sourceUrl', evidence.source_url,
                'startSeconds', evidence.start_seconds,
                'endSeconds', evidence.end_seconds,
                'artifactId', evidence.artifact_id::text,
                'artifactGeneration', evidence.artifact_generation
              ) AS citation
       FROM adaptive_quiz_questions AS question
       JOIN adaptive_quiz_evidence AS evidence
         ON evidence.loop_id = question.loop_id
        AND evidence.position = question.evidence_position
       WHERE question.loop_id = $1 ORDER BY question.position`,
      [loopId],
    );
    return {
      ...row,
      watchedRange: row.watchedRanges[0],
      questions: questions.rows,
    };
  }

  private async requireAdaptiveSubmission(
    client: SqlClient,
    userId: number,
    loopId: string,
  ): Promise<AdaptiveQuizSubmission> {
    const attempt = await client.query<{
      id: string;
      score: string | number;
      submittedAt: Date | string;
    }>(
      `SELECT id::text AS id, score, submitted_at AS "submittedAt"
       FROM adaptive_quiz_attempts WHERE loop_id = $1 AND owner_id = $2`,
      [loopId, userId],
    );
    const row = attempt.rows[0];
    if (!row) throw new LearningNotFoundError();
    const answers = await client.query<
      AdaptiveQuizSubmission['attempt']['answers'][number]
    >(
      `SELECT question.id::text AS "questionId",
              answer.selected_choice_index AS "selectedChoiceIndex",
              answer.correct,
              question.correct_choice_index AS "correctChoiceIndex",
              question.explanation,
              jsonb_build_object(
                'resourceId', evidence.resource_id,
                'sourceUrl', evidence.source_url,
                'startSeconds', evidence.start_seconds,
                'endSeconds', evidence.end_seconds,
                'artifactId', evidence.artifact_id::text,
                'artifactGeneration', evidence.artifact_generation
              ) AS citation
       FROM adaptive_quiz_answers AS answer
       JOIN adaptive_quiz_questions AS question ON question.id = answer.question_id
       JOIN adaptive_quiz_evidence AS evidence
         ON evidence.loop_id = question.loop_id
        AND evidence.position = question.evidence_position
       WHERE answer.attempt_id = $1 ORDER BY question.position`,
      [row.id],
    );
    const review = await client.query<{
      kind: 'review_range';
      reasonCode: 'INCORRECT_ANSWER';
      citation: {
        sourceUrl: string;
        startSeconds: number;
        endSeconds: number;
      };
    }>(
      `SELECT kind, reason_code AS "reasonCode",
              jsonb_build_object(
                'sourceUrl', source_url,
                'startSeconds', start_seconds,
                'endSeconds', end_seconds
              ) AS citation
       FROM adaptive_quiz_review_proposals WHERE loop_id = $1`,
      [loopId],
    );
    return {
      state: 'evaluated',
      attempt: {
        id: row.id,
        score: Number(row.score),
        submittedAt: iso(row.submittedAt),
        answers: answers.rows,
      },
      reviewProposal: review.rows[0] ?? null,
    };
  }

  private async requireQuizAttempt(
    client: SqlClient,
    userId: number,
    attemptId: string,
  ): Promise<QuizAttemptResult> {
    const attempt = await client.query<{
      id: string;
      quizId: string;
      attemptNumber: number;
      score: string | number;
      submittedAt: Date | string;
      maxAttempts: number;
      bestScore: string | number;
      latestScore: string | number;
    }>(
      `
        SELECT qa.id, qa.quiz_id AS "quizId",
               qa.attempt_number AS "attemptNumber", qa.score,
               qa.submitted_at AS "submittedAt", q.max_attempts AS "maxAttempts",
               (
                 SELECT max(best.score)
                 FROM quiz_attempts best
                 WHERE best.quiz_id = qa.quiz_id AND best.user_id = qa.user_id
               ) AS "bestScore",
               (
                 SELECT latest.score
                 FROM quiz_attempts latest
                 WHERE latest.quiz_id = qa.quiz_id AND latest.user_id = qa.user_id
                 ORDER BY latest.attempt_number DESC
                 LIMIT 1
               ) AS "latestScore"
        FROM quiz_attempts qa
        JOIN quizzes q ON q.id = qa.quiz_id
        WHERE qa.user_id = $1 AND qa.id = $2
      `,
      [userId, attemptId],
    );
    const row = attempt.rows[0];
    if (!row) throw new LearningNotFoundError();
    const answers = await client.query<{
      questionId: string;
      selectedChoiceIndex: number;
      correct: boolean;
      correctChoiceIndex: number;
      explanation: string;
    }>(
      `
        SELECT a.question_id AS "questionId",
               a.selected_choice_index AS "selectedChoiceIndex",
               a.correct, q.correct_choice_index AS "correctChoiceIndex",
               q.explanation
        FROM quiz_answers a
        JOIN quiz_questions q ON q.id = a.question_id
        WHERE a.attempt_id = $1
        ORDER BY q.position
      `,
      [attemptId],
    );
    const total = await client.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM quiz_attempts WHERE quiz_id = $1 AND user_id = $2`,
      [row.quizId, userId],
    );
    return {
      id: row.id,
      quizId: row.quizId,
      attemptNumber: row.attemptNumber,
      score: Number(row.score),
      submittedAt: iso(row.submittedAt),
      answers: answers.rows,
      bestScore: Number(row.bestScore),
      latestScore: Number(row.latestScore),
      attemptsRemaining: Math.max(
        0,
        row.maxAttempts - (total.rows[0]?.count ?? 0),
      ),
    };
  }
}
