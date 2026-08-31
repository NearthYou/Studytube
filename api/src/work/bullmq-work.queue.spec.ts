import type { WorkQueueJob, WorkQueueOptions } from './work.queue';
import { BullMqWorkQueue } from './bullmq-work.queue';

class RecordingQueue {
  added: { name: string; data: WorkQueueJob; options: WorkQueueOptions }[] = [];
  closed = false;

  add(
    name: string,
    data: WorkQueueJob,
    options: WorkQueueOptions,
  ): Promise<unknown> {
    this.added.push({ name, data, options });
    return Promise.resolve({ id: options.jobId });
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

describe('BullMqWorkQueue', () => {
  it('forwards retained deterministic jobs and closes its connection', async () => {
    const client = new RecordingQueue();
    const queue = new BullMqWorkQueue(client);
    const data: WorkQueueJob = {
      eventId: '11111111-1111-4111-8111-111111111111',
      ownerId: 7,
      eventType: 'video_asset.requested',
      handlerVersion: 'video-asset-v1',
      payloadSchemaVersion: 1,
      payload: { postId: 42 },
    };
    const options: WorkQueueOptions = {
      jobId: `${data.eventId}-${data.handlerVersion}`,
      attempts: 8,
      backoff: { type: 'exponential', delay: 1000, jitter: 0.5 },
      removeOnComplete: false,
      removeOnFail: false,
    };

    await queue.add(data.eventType, data, options);
    await queue.close();

    expect(client.added).toEqual([{ name: data.eventType, data, options }]);
    expect(client.closed).toBe(true);
  });
});
