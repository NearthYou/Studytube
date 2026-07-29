import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { BullMqWorkQueue } from '../src/work/bullmq-work.queue';
import { OutboxRelayService } from '../src/work/outbox-relay.service';
import { PostgresWorkRepository } from '../src/work/postgres-work.repository';
import {
  VIDEO_ASSET_HANDLER_VERSION,
  WORK_QUEUE_NAME,
  type WorkQueueJob,
} from '../src/work/work.queue';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://app:app@127.0.0.1:5432/app_dev';
const VALKEY_URL = process.env.VALKEY_URL ?? 'redis://127.0.0.1:6379';

describe('durable work queue (e2e)', () => {
  jest.setTimeout(15_000);

  it('converges on one BullMQ job when a relay dies after publish', async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const repository = new PostgresWorkRepository(pool);
    const publisher = BullMqWorkQueue.connect(VALKEY_URL);
    const inspector = new Queue<WorkQueueJob>(WORK_QUEUE_NAME, {
      connection: { url: VALKEY_URL },
    });
    const eventId = randomUUID();
    const jobId = `${eventId}-${VIDEO_ASSET_HANDLER_VERSION}`;

    try {
      await repository.appendOutboxEvent({
        id: eventId,
        eventType: 'video_asset.requested',
        aggregateType: 'post',
        aggregateId: '42',
        aggregateVersion: 1,
        payloadSchemaVersion: 1,
        payload: { postId: 42 },
        occurredAt: new Date('2000-01-01T00:00:00.000Z'),
        availableAt: new Date('2000-01-01T00:00:00.000Z'),
      });
      const [claimed] = await repository.claimOutboxBatch(1, 'crash-probe', 25);
      expect(claimed.id).toBe(eventId);

      await publisher.add(
        claimed.eventType,
        {
          eventId,
          eventType: claimed.eventType,
          handlerVersion: VIDEO_ASSET_HANDLER_VERSION,
          payloadSchemaVersion: claimed.payloadSchemaVersion,
          payload: claimed.payload,
        },
        {
          jobId,
          attempts: claimed.maxAttempts,
          backoff: { type: 'exponential', delay: 1000, jitter: 0.5 },
          removeOnComplete: false,
          removeOnFail: false,
        },
      );

      await new Promise((resolve) => setTimeout(resolve, 40));
      const relay = new OutboxRelayService(repository, publisher);
      expect(await relay.publishOnce()).toBeGreaterThanOrEqual(1);

      const job = await inspector.getJob(jobId);
      expect(job?.data).toMatchObject({
        eventId,
        handlerVersion: 'video-asset-v1',
      });
      const published = await pool.query<{ published: boolean }>(
        'SELECT published_at IS NOT NULL AS published FROM work_outbox_events WHERE id = $1',
        [eventId],
      );
      expect(published.rows[0]).toEqual({ published: true });

      await job?.remove();
    } finally {
      await pool.query('DELETE FROM work_outbox_events WHERE id = $1', [
        eventId,
      ]);
      await inspector.close();
      await publisher.close();
      await pool.end();
    }
  });
});
