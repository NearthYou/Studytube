import type { WorkRepository } from './work.repository';
import {
  LEARNING_CAPTION_HANDLER_VERSION,
  LEARNING_SUMMARY_HANDLER_VERSION,
  RETRIEVAL_EMBEDDING_HANDLER_VERSION,
  QUIZ_GENERATION_HANDLER_VERSION,
  VIDEO_ASSET_HANDLER_VERSION,
  type WorkQueuePublisher,
} from './work.queue';
import {
  observabilityRuntime,
  type ObservabilityRuntime,
} from '../observability/runtime';

export type OutboxRelayOptions = {
  pollIntervalMs: number;
  publishTimeoutMs?: number;
  onError?: (error: unknown) => void;
};

const OUTBOX_LEASE_MS = 30_000;
const DEFAULT_PUBLISH_TIMEOUT_MS = 20_000;

export class OutboxRelayService {
  private stopped = true;
  private timer?: NodeJS.Timeout;
  private inFlight?: Promise<void>;

  constructor(
    private readonly repository: WorkRepository,
    private readonly queue: WorkQueuePublisher,
    private readonly options: OutboxRelayOptions = { pollIntervalMs: 1000 },
    private readonly observability: ObservabilityRuntime = observabilityRuntime,
  ) {
    const publishTimeoutMs =
      this.options.publishTimeoutMs ?? DEFAULT_PUBLISH_TIMEOUT_MS;
    if (
      !Number.isSafeInteger(publishTimeoutMs) ||
      publishTimeoutMs <= 0 ||
      publishTimeoutMs >= OUTBOX_LEASE_MS
    ) {
      throw new RangeError(
        `Outbox publish timeout must be an integer between 1 and ${OUTBOX_LEASE_MS - 1} milliseconds`,
      );
    }
  }

  onModuleInit(): void {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.schedule(0);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.inFlight;
    await this.queue.close();
  }

  async publishOnce(): Promise<number> {
    const events = await this.repository.claimOutboxBatch(
      25,
      'outbox-relay',
      OUTBOX_LEASE_MS,
    );
    let published = 0;

    for (const event of events) {
      const handlerVersion = this.handlerVersion(event.eventType);
      try {
        await this.withPublishTimeout(
          this.queue.add(
            event.eventType,
            {
              eventId: event.id,
              eventType: event.eventType,
              handlerVersion,
              payloadSchemaVersion: event.payloadSchemaVersion,
              payload: event.payload,
              telemetry: {
                ...event.traceContext,
                'x-studytube-job-id': event.id,
              },
            },
            {
              jobId: `${event.id}-${handlerVersion}`,
              attempts: event.maxAttempts,
              backoff: { type: 'exponential', delay: 1000, jitter: 0.5 },
              removeOnComplete: false,
              removeOnFail: false,
            },
          ),
        );
        await this.repository.ackOutboxEvent(event.id, event.leaseToken);
        published += 1;
      } catch (error) {
        if (this.isLeaseLoss(error)) {
          throw error;
        }
        const outcome = await this.repository.retryOutboxEvent(
          event.id,
          event.leaseToken,
          handlerVersion,
          {
            code: 'QUEUE_UNAVAILABLE',
            message: this.errorMessage(error),
            retryDelayMs: 1000,
          },
        );
        this.observability.metrics.outboxFailure(
          event.eventType,
          outcome === 'dead_lettered',
        );
        this.observability.logger.warn('outbox_publish_failed', {
          event_id: event.id,
          event_type: event.eventType,
          outcome,
          error,
        });
      }
    }

    const snapshot = await this.repository.readOutboxHealthSnapshot?.();
    if (snapshot) {
      this.observability.metrics.outboxSnapshot(
        snapshot.pending,
        snapshot.oldestAgeSeconds,
      );
    }

    return published;
  }

  private handlerVersion(eventType: string): string {
    if (eventType === 'learning_intake.requested') {
      return LEARNING_CAPTION_HANDLER_VERSION;
    }
    if (eventType === 'video_asset.requested') {
      return VIDEO_ASSET_HANDLER_VERSION;
    }
    if (eventType === 'retrieval_embedding.requested') {
      return RETRIEVAL_EMBEDDING_HANDLER_VERSION;
    }
    if (eventType === 'quiz_generation.requested') {
      return QUIZ_GENERATION_HANDLER_VERSION;
    }
    if (eventType === 'learning_summary.requested') {
      return LEARNING_SUMMARY_HANDLER_VERSION;
    }
    return 'unsupported-event-v1';
  }

  private schedule(delayMs: number): void {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.inFlight = this.runCycle();
      void this.inFlight;
    }, delayMs);
    this.timer.unref?.();
  }

  private async runCycle(): Promise<void> {
    try {
      await this.publishOnce();
    } catch (error) {
      this.options.onError?.(error);
    } finally {
      this.inFlight = undefined;
      this.schedule(this.options.pollIntervalMs);
    }
  }

  private isLeaseLoss(error: unknown): boolean {
    return (
      error instanceof Error &&
      'code' in error &&
      error.code === 'OUTBOX_LEASE_LOST'
    );
  }

  private async withPublishTimeout(publish: Promise<void>): Promise<void> {
    const timeoutMs =
      this.options.publishTimeoutMs ?? DEFAULT_PUBLISH_TIMEOUT_MS;
    let timeout: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        reject(new Error(`Queue publish timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timeout.unref?.();
    });

    try {
      await Promise.race([publish, deadline]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error
      ? error.message.replace(/\s+/g, ' ').trim().slice(0, 500)
      : 'Queue publish failed';
  }
}
