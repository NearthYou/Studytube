import type { Pool, PoolClient } from 'pg';
import {
  AccountErasureUnavailableError,
  type AccountErasureCommand,
  type AccountErasureRepository,
  type AccountErasureResult,
} from './account-erasure.repository';

type AccountErasurePool = Pick<Pool, 'connect'>;

export class PostgresAccountErasureRepository implements AccountErasureRepository {
  constructor(private readonly pool: AccountErasurePool) {}

  async erase(command: AccountErasureCommand): Promise<AccountErasureResult> {
    let client: PoolClient;
    try {
      client = await this.pool.connect();
    } catch {
      throw new AccountErasureUnavailableError();
    }
    let transactionOpen = false;
    const rollback = async () => {
      if (!transactionOpen) return;
      await client.query('ROLLBACK');
      transactionOpen = false;
    };

    try {
      await client.query('BEGIN');
      transactionOpen = true;
      const user = await client.query<{ id: number }>(
        'SELECT id FROM users WHERE id = $1 FOR UPDATE',
        [command.userId],
      );
      if (!user.rows[0]) {
        await rollback();
        return { status: 'not_found' };
      }
      const session = await client.query<{ id: string }>(
        `
          SELECT session.id
          FROM sessions AS session
          WHERE session.user_id = $1
            AND session.id = $2
            AND session.google_reauthenticated_at >= $3
            AND session.google_reauthenticated_at <= $4
            AND session.revoked_at IS NULL
            AND session.absolute_expires_at > $4
            AND session.idle_expires_at > $4
          FOR UPDATE
        `,
        [
          command.userId,
          command.sessionId,
          command.reauthCutoff,
          command.erasedAt,
        ],
      );
      if (!session.rows[0]) {
        await rollback();
        return { status: 'reauth_required' };
      }

      const candidates = await client.query<{ videoSourceId: string }>(
        `
          SELECT DISTINCT source_id::text AS "videoSourceId"
          FROM (
            SELECT item.video_source_id AS source_id
            FROM learning_items AS item
            WHERE item.user_id = $1
            UNION
            SELECT step.video_source_id
            FROM courses AS course
            JOIN course_steps AS step ON step.course_id = course.id
            WHERE course.owner_id = $1 AND step.video_source_id IS NOT NULL
            UNION
            SELECT mapping.video_source_id
            FROM legacy_learning_context_mappings AS mapping
            WHERE mapping.user_id = $1 AND mapping.video_source_id IS NOT NULL
          ) AS candidate
        `,
        [command.userId],
      );
      const candidateIds = candidates.rows.map((row) => row.videoSourceId);

      await client.query('DELETE FROM work_replay_audits WHERE actor_id = $1', [
        command.userId,
      ]);
      const deleted = await client.query<{ id: number }>(
        'DELETE FROM users WHERE id = $1 RETURNING id',
        [command.userId],
      );
      if (!deleted.rows[0]) throw new AccountErasureUnavailableError();

      await client.query(
        `
          DELETE FROM provider_work_reservations AS work
          WHERE NOT EXISTS (
            SELECT 1 FROM provider_subscription_reservations AS subscription
            WHERE subscription.work_reservation_id = work.id
          )
        `,
      );
      const orphaned = await client.query<{ id: string }>(
        `
          SELECT source.id::text AS id
          FROM video_sources AS source
          WHERE source.id = ANY($1::bigint[])
            AND NOT EXISTS (
              SELECT 1 FROM learning_items AS item
              WHERE item.video_source_id = source.id
            )
            AND NOT EXISTS (
              SELECT 1 FROM course_steps AS step
              WHERE step.video_source_id = source.id
            )
            AND NOT EXISTS (
              SELECT 1 FROM legacy_learning_context_mappings AS mapping
              WHERE mapping.video_source_id = source.id
            )
            AND NOT EXISTS (
              SELECT 1 FROM learning_proposals AS proposal
              WHERE proposal.video_source_id = source.id
            )
          FOR UPDATE
        `,
        [candidateIds],
      );
      const orphanIds = orphaned.rows.map((row) => row.id);
      if (orphanIds.length > 0)
        await this.deleteOrphanedSources(client, orphanIds);

      await client.query('COMMIT');
      transactionOpen = false;
      return { status: 'deleted' };
    } catch (error) {
      try {
        await rollback();
      } catch {
        throw new AccountErasureUnavailableError();
      }
      if (error instanceof AccountErasureUnavailableError) throw error;
      throw new AccountErasureUnavailableError();
    } finally {
      client.release();
    }
  }

  private async deleteOrphanedSources(
    client: PoolClient,
    sourceIds: string[],
  ): Promise<void> {
    await client.query(
      `UPDATE video_sources
       SET current_source_caption_artifact_id = NULL
       WHERE id = ANY($1::bigint[])`,
      [sourceIds],
    );
    await client.query(
      `DELETE FROM caption_work_failures
       WHERE work_event_id IN (
         SELECT work_event_id FROM caption_artifacts
         WHERE video_source_id = ANY($1::bigint[])
       )`,
      [sourceIds],
    );
    for (const kind of [
      'index',
      'translation',
      'transcription',
      'youtube_caption',
    ]) {
      await client.query(
        `DELETE FROM caption_artifacts
         WHERE video_source_id = ANY($1::bigint[]) AND kind = $2`,
        [sourceIds, kind],
      );
    }
    await client.query(
      'DELETE FROM video_sources WHERE id = ANY($1::bigint[])',
      [sourceIds],
    );
  }
}
