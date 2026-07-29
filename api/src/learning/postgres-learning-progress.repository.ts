import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { mergeWatchedRanges, shouldCompleteLearning } from './learning.domain';
import { LearningNotFoundError } from './learning.errors';
import type { RecordProgressCommand } from './learning.repository';
import type { LearningProgress, WatchedRange } from './learning.types';
import {
  assertOrAdoptLegacyHash,
  mutate,
  nullableIso,
  type SqlClient,
  translatePostgresError,
} from './postgres-learning.persistence';

type ProgressRow = {
  courseStepId: string;
  watchedRanges: WatchedRange[];
  lastPositionSeconds: string | number;
  watchedCoverage: string | number;
  bestQuizScore: string | number | null;
  completedAt: Date | string | null;
  version: number;
};

export class PostgresLearningProgressRepository {
  constructor(private readonly pool: Pool) {}

  async recordProgress(
    command: RecordProgressCommand,
  ): Promise<LearningProgress> {
    return mutate(this.pool, async (client) => {
      await client.query(
        'SELECT pg_advisory_xact_lock($1::integer, hashtext($2))',
        [command.userId, command.courseStepId],
      );
      const step = await client.query<{ durationSeconds: number }>(
        `
          SELECT cs.duration_seconds AS "durationSeconds"
          FROM course_steps cs
          JOIN courses c ON c.id = cs.course_id
          WHERE cs.id = $1::bigint
            AND (c.owner_id = $2 OR (c.status = 'published' AND c.visibility = 'public'))
        `,
        [command.courseStepId, command.userId],
      );
      const durationSeconds = step.rows[0]?.durationSeconds;
      if (!durationSeconds) throw new LearningNotFoundError();

      const duplicate = await client.query<{ id: string; payloadHash: Buffer }>(
        `
          SELECT id, payload_hash AS "payloadHash"
          FROM learning_progress_events
          WHERE user_id = $1 AND course_step_id = $2::bigint
            AND idempotency_key_digest = $3
        `,
        [command.userId, command.courseStepId, command.idempotencyKeyDigest],
      );
      if (duplicate.rows[0]) {
        await assertOrAdoptLegacyHash(
          client,
          'learning_progress_events',
          duplicate.rows[0].id,
          duplicate.rows[0].payloadHash,
          command.payloadHash,
        );
        return this.requireProgress(
          client,
          command.userId,
          command.courseStepId,
        );
      }

      const current = await this.findProgress(
        client,
        command.userId,
        command.courseStepId,
        true,
      );
      const merged = mergeWatchedRanges(
        current?.watchedRanges ?? [],
        { start: command.startSeconds, end: command.endSeconds },
        durationSeconds,
      );
      const previousLast = current?.lastPositionSeconds ?? 0;
      const lastPosition = Math.max(
        previousLast,
        Math.min(durationSeconds, command.lastPositionSeconds),
      );
      const useIncomingOccurrence =
        !current || command.lastPositionSeconds > previousLast;
      const completed = shouldCompleteLearning(
        merged.coverage,
        current?.bestQuizScore ?? null,
      );
      await client.query(
        `
          INSERT INTO learning_progress_events (
            id, user_id, course_step_id, idempotency_key_digest,
            payload_hash, start_seconds, end_seconds,
            last_position_seconds, occurred_at
          )
          VALUES ($1, $2, $3::bigint, $4, $5, $6, $7, $8, $9)
        `,
        [
          randomUUID(),
          command.userId,
          command.courseStepId,
          command.idempotencyKeyDigest,
          command.payloadHash,
          command.startSeconds,
          command.endSeconds,
          command.lastPositionSeconds,
          command.occurredAt,
        ],
      );
      await client.query(
        `
          INSERT INTO learning_progress (
            user_id, course_step_id, watched_ranges,
            last_position_seconds, last_position_occurred_at,
            watched_coverage, best_quiz_score, completed_at,
            version, updated_at
          )
          VALUES (
            $1, $2::bigint, $3::jsonb, $4, $5, $6, $7,
            CASE WHEN $8 THEN statement_timestamp() ELSE NULL END,
            1, statement_timestamp()
          )
          ON CONFLICT (user_id, course_step_id) DO UPDATE
          SET watched_ranges = EXCLUDED.watched_ranges,
              last_position_seconds = EXCLUDED.last_position_seconds,
              last_position_occurred_at = CASE
                WHEN $9 THEN EXCLUDED.last_position_occurred_at
                ELSE learning_progress.last_position_occurred_at
              END,
              watched_coverage = EXCLUDED.watched_coverage,
              completed_at = CASE
                WHEN learning_progress.completed_at IS NOT NULL
                  THEN learning_progress.completed_at
                WHEN $8 THEN statement_timestamp()
                ELSE NULL
              END,
              version = learning_progress.version + 1,
              updated_at = statement_timestamp()
        `,
        [
          command.userId,
          command.courseStepId,
          JSON.stringify(merged.ranges),
          lastPosition,
          useIncomingOccurrence ? command.occurredAt : null,
          merged.coverage,
          current?.bestQuizScore ?? null,
          completed,
          useIncomingOccurrence,
        ],
      );
      return this.requireProgress(client, command.userId, command.courseStepId);
    });
  }

  async findOwnerProgress(
    userId: number,
    courseStepId: string,
  ): Promise<LearningProgress | null> {
    try {
      return await this.findProgress(this.pool, userId, courseStepId, false);
    } catch (error) {
      throw translatePostgresError(error);
    }
  }

  async updateFromQuiz(
    client: SqlClient,
    userId: number,
    courseStepId: string,
    score: number,
  ): Promise<void> {
    await client.query(
      `
        INSERT INTO learning_progress (
          user_id, course_step_id, best_quiz_score,
          watched_ranges, watched_coverage, version, updated_at
        )
        VALUES ($1, $2::bigint, $3, '[]'::jsonb, 0, 1, statement_timestamp())
        ON CONFLICT (user_id, course_step_id) DO UPDATE
        SET best_quiz_score = GREATEST(
              COALESCE(learning_progress.best_quiz_score, 0),
              EXCLUDED.best_quiz_score
            ),
            completed_at = CASE
              WHEN learning_progress.completed_at IS NOT NULL
                THEN learning_progress.completed_at
              WHEN learning_progress.watched_coverage >= 0.8
                AND GREATEST(
                  COALESCE(learning_progress.best_quiz_score, 0),
                  EXCLUDED.best_quiz_score
                ) >= 70
                THEN statement_timestamp()
              ELSE NULL
            END,
            version = learning_progress.version + 1,
            updated_at = statement_timestamp()
      `,
      [userId, courseStepId, score],
    );
  }

  private async requireProgress(
    client: SqlClient,
    userId: number,
    courseStepId: string,
  ): Promise<LearningProgress> {
    const progress = await this.findProgress(
      client,
      userId,
      courseStepId,
      false,
    );
    if (!progress) throw new LearningNotFoundError();
    return progress;
  }

  private async findProgress(
    client: SqlClient,
    userId: number,
    courseStepId: string,
    forUpdate: boolean,
  ): Promise<LearningProgress | null> {
    const result = await client.query<ProgressRow>(
      `
        SELECT course_step_id::text AS "courseStepId",
               watched_ranges AS "watchedRanges",
               last_position_seconds AS "lastPositionSeconds",
               watched_coverage AS "watchedCoverage",
               best_quiz_score AS "bestQuizScore",
               completed_at AS "completedAt", version
        FROM learning_progress
        WHERE user_id = $1 AND course_step_id = $2::bigint
        ${forUpdate ? 'FOR UPDATE' : ''}
      `,
      [userId, courseStepId],
    );
    const row = result.rows[0];
    return row ? hydrateProgress(row) : null;
  }
}

function hydrateProgress(row: ProgressRow): LearningProgress {
  return {
    courseStepId: row.courseStepId,
    watchedRanges: row.watchedRanges,
    lastPositionSeconds: Number(row.lastPositionSeconds),
    watchedCoverage: Number(row.watchedCoverage),
    bestQuizScore:
      row.bestQuizScore === null ? null : Number(row.bestQuizScore),
    completedAt: nullableIso(row.completedAt),
    version: row.version,
  };
}
