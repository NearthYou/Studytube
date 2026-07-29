export const WORK_QUEUE_NAME = 'studytube-work';
export const VIDEO_ASSET_HANDLER_VERSION = 'video-asset-v1';
export const WORK_QUEUE_PUBLISHER = Symbol('WORK_QUEUE_PUBLISHER');

export type WorkQueueJob = {
  eventId: string;
  eventType: string;
  handlerVersion: string;
  payloadSchemaVersion: number;
  payload: Record<string, unknown>;
};

export type WorkQueueOptions = {
  jobId: string;
  attempts: number;
  backoff: { type: 'exponential'; delay: number; jitter: number };
  removeOnComplete: false;
  removeOnFail: false;
};

export interface WorkQueuePublisher {
  add(
    name: string,
    data: WorkQueueJob,
    options: WorkQueueOptions,
  ): Promise<void>;
  close(): Promise<void>;
}
