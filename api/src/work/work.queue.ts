export const WORK_QUEUE_NAME = 'studytube-work';
export const VIDEO_ASSET_HANDLER_VERSION = 'video-asset-v1';
export const LEARNING_CAPTION_HANDLER_VERSION = 'learning-caption-v1';
export const RETRIEVAL_EMBEDDING_HANDLER_VERSION = 'retrieval-embedding-v2';
export const QUIZ_GENERATION_HANDLER_VERSION = 'quiz-generation-v2';
export const LEARNING_SUMMARY_HANDLER_VERSION = 'learning-summary-v1';
export const WORK_QUEUE_PUBLISHER = Symbol('WORK_QUEUE_PUBLISHER');

export type WorkQueueJob = {
  eventId: string;
  ownerId: number | null;
  eventType: string;
  handlerVersion: string;
  payloadSchemaVersion: number;
  payload: Record<string, unknown>;
  telemetry?: Record<string, string>;
};

export type WorkAttemptContext = {
  attemptNumber: number;
  maxAttempts: number;
  isFinalAttempt: boolean;
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
