import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  LearningAttemptLimitError,
  LearningIdempotencyConflictError,
  LearningNotFoundError,
  LearningValidationError,
} from './learning.errors';
import type {
  CreateQuizCommand,
  QuizQuestionInput,
  SubmitQuizCommand,
} from './learning.repository';
import type { QuizAttemptResult, QuizPublic } from './learning.types';
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
