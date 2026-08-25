import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  MAX_LEARNING_AUDIO_SECONDS,
  ProviderBudgetUnavailableError,
  type ProviderBudgetRepository,
  type ProviderBudgetReservation,
  type ReserveProviderWorkCommand,
} from './provider-budget.repository';

export type ProviderBudgetPolicy = Readonly<{
  enabled: boolean;
  maxGlobalDailyAudioSeconds: number;
  maxUserDailyAudioSeconds: number;
  maxConcurrentWorks: number;
  maxConcurrentWorksPerUser: number;
  microsPerAudioSecond: number;
  maxGlobalDailyCostMicrounits: number;
  maxGlobalMonthlyCostMicrounits: number;
}>;

type ExistingReservationRow = ProviderBudgetReservation;
type ExistingWorkRow = {
  id: string;
  workId: string;
  state: 'reserved' | 'committed';
};
type BudgetSnapshotRow = {
  globalAudioSeconds: number;
  globalCostMicrounits: number;
  globalMonthlyCostMicrounits: number;
  userAudioSeconds: number;
  globalConcurrentWorks: number;
  userConcurrentWorks: number;
};

export class PostgresProviderBudgetRepository implements ProviderBudgetRepository {
  constructor(
    private readonly pool: Pool,
    private readonly policy: ProviderBudgetPolicy,
  ) {}

  async reserve(
    command: ReserveProviderWorkCommand,
  ): Promise<ProviderBudgetReservation> {
    validate(command, this.policy);
    if (!this.policy.enabled) {
      throw new ProviderBudgetUnavailableError('DISABLED');
    }
    const usageDay = new Date().toISOString().slice(0, 10);
    const processingRangeKey = `0-${command.requestedAudioSeconds}`;
    const workKey = providerWorkKey(command);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`provider-budget:${usageDay}`],
      );

      const existingSubscription = await client.query<ExistingReservationRow>(
        `SELECT subscription.id::text AS "reservationId",
                work.work_id::text AS "workId",
                'joined'::text AS admission,
                subscription.reserved_audio_seconds AS "reservedAudioSeconds",
                false AS "subscriptionCreated"
         FROM provider_subscription_reservations AS subscription
         JOIN provider_work_reservations AS work
           ON work.id = subscription.work_reservation_id
         WHERE subscription.user_id = $1
           AND work.work_key = $2
           AND subscription.state IN ('reserved', 'committed')
           AND work.state IN ('reserved', 'committed')
         FOR UPDATE OF work`,
        [command.userId, workKey],
      );
      if (existingSubscription.rows[0]) {
        await client.query('COMMIT');
        return existingSubscription.rows[0];
      }

      const existingWorkResult = await client.query<ExistingWorkRow>(
        `SELECT id::text AS id, work_id::text AS "workId", state
         FROM provider_work_reservations
         WHERE work_key = $1 AND state IN ('reserved', 'committed')
         FOR UPDATE`,
        [workKey],
      );
      const existingWork = existingWorkResult.rows[0];
      const snapshot = await this.readBudgetSnapshot(
        client,
        command.userId,
        usageDay,
      );
      this.assertAvailable(
        snapshot,
        command.requestedAudioSeconds,
        existingWork !== undefined,
      );

      const work =
        existingWork ??
        (await this.createWork(
          client,
          command,
          usageDay,
          processingRangeKey,
          workKey,
        ));
      const subscription = await client.query<{ reservationId: string }>(
        `INSERT INTO provider_subscription_reservations (
           work_reservation_id, user_id, usage_day, reserved_audio_seconds
         ) VALUES ($1::bigint, $2, $3::date, $4)
         RETURNING id::text AS "reservationId"`,
        [work.id, command.userId, usageDay, command.requestedAudioSeconds],
      );
      const reservationId = subscription.rows[0]?.reservationId;
      if (!reservationId)
        throw new Error('Provider subscription reservation was not persisted');
      await client.query('COMMIT');
      return {
        reservationId,
        workId: work.workId,
        admission: existingWork ? 'joined' : 'created',
        reservedAudioSeconds: command.requestedAudioSeconds,
        subscriptionCreated: true,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async commitWork(
    workId: string,
    actualCostMicrounits: number,
  ): Promise<boolean> {
    if (
      !Number.isSafeInteger(actualCostMicrounits) ||
      actualCostMicrounits < 0
    ) {
      throw new RangeError('actualCostMicrounits is invalid');
    }
    const result = await this.pool.query(
      `WITH committed_work AS (
         UPDATE provider_work_reservations
         SET state = 'committed', actual_cost_microunits = $2,
             committed_at = statement_timestamp()
         WHERE work_id = $1::uuid AND state = 'reserved'
         RETURNING id
       )
       UPDATE provider_subscription_reservations AS subscription
       SET state = 'committed', committed_at = statement_timestamp()
       FROM committed_work
       WHERE subscription.work_reservation_id = committed_work.id
         AND subscription.state = 'reserved'`,
      [workId, actualCostMicrounits],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async attachContext(
    userId: number,
    reservationId: string,
    studyContextId: string,
  ): Promise<boolean> {
    validatePositiveInteger(userId, 'userId');
    validateDecimalId(reservationId, 'reservationId');
    validateDecimalId(studyContextId, 'studyContextId');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const attached = await client.query<{ contextId: string }>(
        `UPDATE provider_subscription_reservations AS subscription
         SET study_context_id = $3::bigint,
             state = CASE WHEN work.state = 'committed'
               THEN 'committed' ELSE subscription.state END,
             committed_at = CASE WHEN work.state = 'committed'
               THEN COALESCE(subscription.committed_at, statement_timestamp())
               ELSE subscription.committed_at END
         FROM study_contexts AS context,
              provider_work_reservations AS work
         WHERE subscription.id = $1::bigint
           AND subscription.user_id = $2
           AND subscription.state IN ('reserved', 'committed')
           AND work.id = subscription.work_reservation_id
           AND work.state IN ('reserved', 'committed')
           AND context.id = $3::bigint
           AND context.user_id = $2
           AND (
             subscription.study_context_id IS NULL OR
             subscription.study_context_id = context.id
           )
         RETURNING context.id::text AS "contextId"`,
        [reservationId, userId, studyContextId],
      );
      if (!attached.rows[0]) {
        await client.query('ROLLBACK');
        return false;
      }
      await client.query(
        `UPDATE study_contexts AS context
         SET current_source_caption_artifact_id = source.current_source_caption_artifact_id,
             updated_at = statement_timestamp()
         FROM learning_items AS item
         JOIN video_sources AS source ON source.id = item.video_source_id
         WHERE context.id = $1::bigint
           AND context.learning_item_id = item.id`,
        [studyContextId],
      );
      await client.query(
        `UPDATE study_contexts AS context
         SET current_translation_caption_artifact_id = (
               SELECT artifact.id
               FROM learning_items AS item
               JOIN video_sources AS source ON source.id = item.video_source_id
               JOIN caption_artifacts AS artifact
                 ON artifact.video_source_id = source.id
               JOIN caption_generation_states AS state
                 ON state.artifact_id = artifact.id AND state.status = 'ready'
               WHERE item.id = context.learning_item_id
                 AND artifact.kind = 'translation'
                 AND artifact.parent_artifact_id =
                     source.current_source_caption_artifact_id
                 AND artifact.target_language = 'ko'
               ORDER BY artifact.generation DESC, artifact.id DESC
               LIMIT 1
             ),
             updated_at = statement_timestamp()
         WHERE context.id = $1::bigint
           AND context.source_language_override IS NULL`,
        [studyContextId],
      );
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async releaseSubscription(
    userId: number,
    reservationId: string,
  ): Promise<boolean> {
    validatePositiveInteger(userId, 'userId');
    validateDecimalId(reservationId, 'reservationId');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const lockedWork = await client.query<{
        workId: string;
        workReservationId: string;
      }>(
        `SELECT work.id::text AS "workReservationId",
                work.work_id::text AS "workId"
         FROM provider_subscription_reservations AS subscription
         JOIN provider_work_reservations AS work
           ON work.id = subscription.work_reservation_id
         WHERE subscription.id = $1::bigint
           AND subscription.user_id = $2
           AND subscription.state = 'reserved'
           AND work.state = 'reserved'
         FOR UPDATE OF work`,
        [reservationId, userId],
      );
      const work = lockedWork.rows[0];
      if (!work) {
        await client.query('COMMIT');
        return false;
      }
      const released = await client.query<{ reservationId: string }>(
        `UPDATE provider_subscription_reservations
         SET state = 'released', released_at = statement_timestamp()
         WHERE id = $1::bigint AND user_id = $2 AND state = 'reserved'
         RETURNING id::text AS "reservationId"`,
        [reservationId, userId],
      );
      if (!released.rows[0])
        throw new Error('Locked subscription was not released');
      await client.query(
        `WITH released_work AS (
           UPDATE provider_work_reservations AS work
           SET state = 'released', released_at = statement_timestamp()
           WHERE work.id = $1::bigint AND work.state = 'reserved'
             AND NOT EXISTS (
               SELECT 1 FROM provider_subscription_reservations AS subscription
               WHERE subscription.work_reservation_id = work.id
                 AND subscription.state = 'reserved'
             )
           RETURNING work.work_id
         )
         UPDATE work_outbox_events AS event
         SET terminal_at = statement_timestamp()
         FROM released_work
         WHERE event.id = released_work.work_id AND event.published_at IS NULL`,
        [work.workReservationId],
      );
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async readBudgetSnapshot(
    client: PoolClient,
    userId: number,
    usageDay: string,
  ): Promise<BudgetSnapshotRow> {
    const result = await client.query<BudgetSnapshotRow>(
      `SELECT
         COALESCE((SELECT sum(
             CASE
               WHEN state = 'committed' AND actual_cost_microunits = 0 THEN 0
               ELSE reserved_audio_seconds
             END
           )::int
           FROM provider_work_reservations
           WHERE usage_day = $2::date AND state IN ('reserved', 'committed')), 0)
           AS "globalAudioSeconds",
         COALESCE((SELECT sum(
             CASE WHEN state = 'committed'
               THEN COALESCE(actual_cost_microunits, estimated_cost_microunits)
               ELSE estimated_cost_microunits END
           )::float8
           FROM provider_work_reservations
           WHERE usage_day = $2::date AND state IN ('reserved', 'committed')), 0)
           AS "globalCostMicrounits",
         COALESCE((SELECT sum(
             CASE WHEN state = 'committed'
               THEN COALESCE(actual_cost_microunits, estimated_cost_microunits)
               ELSE estimated_cost_microunits END
           )::float8
           FROM provider_work_reservations
           WHERE usage_day >= date_trunc('month', $2::date)::date
             AND usage_day < (date_trunc('month', $2::date) + interval '1 month')::date
             AND state IN ('reserved', 'committed')), 0)
           AS "globalMonthlyCostMicrounits",
         COALESCE((SELECT sum(
             CASE
               WHEN work.state = 'committed'
                 AND work.actual_cost_microunits = 0 THEN 0
               ELSE subscription.reserved_audio_seconds
             END
           )::int
           FROM provider_subscription_reservations AS subscription
           JOIN provider_work_reservations AS work
             ON work.id = subscription.work_reservation_id
           WHERE subscription.user_id = $1
             AND subscription.usage_day = $2::date
             AND subscription.state IN ('reserved', 'committed')), 0)
           AS "userAudioSeconds",
         (SELECT count(*)::int FROM provider_work_reservations
           WHERE state = 'reserved') AS "globalConcurrentWorks",
         (SELECT count(*)::int FROM provider_subscription_reservations
           WHERE user_id = $1 AND state = 'reserved') AS "userConcurrentWorks"`,
      [userId, usageDay],
    );
    return (
      result.rows[0] ?? {
        globalAudioSeconds: 0,
        globalCostMicrounits: 0,
        globalMonthlyCostMicrounits: 0,
        userAudioSeconds: 0,
        globalConcurrentWorks: 0,
        userConcurrentWorks: 0,
      }
    );
  }

  private assertAvailable(
    snapshot: BudgetSnapshotRow,
    requestedSeconds: number,
    joinsExistingWork: boolean,
  ): void {
    if (
      !joinsExistingWork &&
      snapshot.globalMonthlyCostMicrounits +
        requestedSeconds * this.policy.microsPerAudioSecond >
        this.policy.maxGlobalMonthlyCostMicrounits
    ) {
      throw new ProviderBudgetUnavailableError('MONTHLY_CAP');
    }
    if (
      !joinsExistingWork &&
      snapshot.globalAudioSeconds + requestedSeconds >
        this.policy.maxGlobalDailyAudioSeconds
    ) {
      throw new ProviderBudgetUnavailableError('DAILY_CAP');
    }
    if (
      !joinsExistingWork &&
      snapshot.globalCostMicrounits +
        requestedSeconds * this.policy.microsPerAudioSecond >
        this.policy.maxGlobalDailyCostMicrounits
    ) {
      throw new ProviderBudgetUnavailableError('DAILY_CAP');
    }
    if (
      snapshot.userAudioSeconds + requestedSeconds >
      this.policy.maxUserDailyAudioSeconds
    ) {
      throw new ProviderBudgetUnavailableError('USER_DAILY_CAP');
    }
    if (
      !joinsExistingWork &&
      snapshot.globalConcurrentWorks >= this.policy.maxConcurrentWorks
    ) {
      throw new ProviderBudgetUnavailableError('CONCURRENCY_CAP');
    }
    if (snapshot.userConcurrentWorks >= this.policy.maxConcurrentWorksPerUser) {
      throw new ProviderBudgetUnavailableError('USER_CONCURRENCY_CAP');
    }
  }

  private async createWork(
    client: PoolClient,
    command: ReserveProviderWorkCommand,
    usageDay: string,
    processingRangeKey: string,
    workKey: string,
  ): Promise<ExistingWorkRow> {
    const workId = randomUUID();
    const estimatedCost =
      command.requestedAudioSeconds * this.policy.microsPerAudioSecond;
    const result = await client.query<{ id: string }>(
      `INSERT INTO provider_work_reservations (
         work_id, work_key, provider, canonical_video_id,
         processing_range_key, usage_day, reserved_audio_seconds,
         estimated_cost_microunits
       ) VALUES ($1::uuid, $2, $3, $4, $5, $6::date, $7, $8)
       RETURNING id::text AS id`,
      [
        workId,
        workKey,
        command.provider,
        command.canonicalVideoId,
        processingRangeKey,
        usageDay,
        command.requestedAudioSeconds,
        estimatedCost,
      ],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error('Provider work reservation was not persisted');
    await client.query(
      `INSERT INTO work_outbox_events (
         id, event_type, aggregate_type, aggregate_id, aggregate_version,
         payload_schema_version, payload
       ) VALUES ($1::uuid, 'learning_intake.requested', 'provider_work', $2, 1, 1, $3::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [
        workId,
        id,
        JSON.stringify({
          schemaVersion: 1,
          provider: command.provider,
          canonicalVideoId: command.canonicalVideoId,
          processingRangeKey,
          reservationId: id,
        }),
      ],
    );
    return { id, workId, state: 'reserved' };
  }
}

export function providerWorkKey(command: ReserveProviderWorkCommand) {
  const processingRangeKey = `0-${command.requestedAudioSeconds}`;
  const purpose = command.processingPurpose ?? 'initial';
  const initialKey = `${command.provider}:${command.canonicalVideoId}:${processingRangeKey}`;
  return purpose === 'initial' ? initialKey : `${initialKey}:${purpose}`;
}

function validate(
  command: ReserveProviderWorkCommand,
  policy: ProviderBudgetPolicy,
): void {
  validatePositiveInteger(command.userId, 'userId');
  validatePositiveInteger(
    command.requestedAudioSeconds,
    'requestedAudioSeconds',
  );
  if (command.requestedAudioSeconds > MAX_LEARNING_AUDIO_SECONDS)
    throw new RangeError('requestedAudioSeconds is too large');
  for (const value of [
    policy.maxGlobalDailyAudioSeconds,
    policy.maxUserDailyAudioSeconds,
    policy.maxConcurrentWorks,
    policy.maxConcurrentWorksPerUser,
    policy.maxGlobalDailyCostMicrounits,
  ])
    validatePositiveInteger(value, 'provider budget policy');
  if (
    !Number.isSafeInteger(policy.microsPerAudioSecond) ||
    policy.microsPerAudioSecond < 0
  ) {
    throw new RangeError('microsPerAudioSecond is invalid');
  }
}

function validatePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new RangeError(`${name} is invalid`);
}

function validateDecimalId(value: string, name: string): void {
  if (!/^[1-9]\d*$/u.test(value)) throw new RangeError(`${name} is invalid`);
}
