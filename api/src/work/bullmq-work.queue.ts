import { Queue } from 'bullmq';
import {
  WORK_QUEUE_NAME,
  type WorkQueueJob,
  type WorkQueueOptions,
  type WorkQueuePublisher,
} from './work.queue';

export interface BullMqQueueClient {
  add(
    name: string,
    data: WorkQueueJob,
    options: WorkQueueOptions,
  ): Promise<unknown>;
  close(): Promise<void>;
}

export class BullMqWorkQueue implements WorkQueuePublisher {
  static connect(url: string): BullMqWorkQueue {
    return new BullMqWorkQueue(
      new Queue<WorkQueueJob>(WORK_QUEUE_NAME, {
        connection: { url },
      }),
    );
  }

  constructor(private readonly client: BullMqQueueClient) {}

  async add(
    name: string,
    data: WorkQueueJob,
    options: WorkQueueOptions,
  ): Promise<void> {
    await this.client.add(name, data, options);
  }

  close(): Promise<void> {
    return this.client.close();
  }
}
