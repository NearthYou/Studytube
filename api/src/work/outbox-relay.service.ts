import type { WorkRepository } from './work.repository';
import {
  VIDEO_ASSET_HANDLER_VERSION,
  type WorkQueuePublisher,
} from './work.queue';

export type OutboxRelayOptions = {
  pollIntervalMs: number;
  onError?: (error: unknown) => void;
};

export class OutboxRelayService {
  private stopped = true;
  private timer?: NodeJS.Timeout;
  private inFlight?: Promise<void>;

  constructor(
    private readonly repository: WorkRepository,
    private readonly queue: WorkQueuePublisher,
    private readonly options: OutboxRelayOptions = { pollIntervalMs: 1000 },
  ) {}

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
      30_000,
    );
    let published = 0;

    for (const event of events) {
      const handlerVersion = this.handlerVersion(event.eventType);
      try {
        await this.queue.add(
          event.eventType,
          {
            eventId: event.id,
            eventType: event.eventType,
            handlerVersion,
            payloadSchemaVersion: event.payloadSchemaVersion,
            payload: event.payload,
          },
          {
            jobId: `${event.id}-${handlerVersion}`,
            attempts: event.maxAttempts,
            backoff: { type: 'exponential', delay: 1000, jitter: 0.5 },
            removeOnComplete: false,
            removeOnFail: false,
          },
        );
        await this.repository.ackOutboxEvent(event.id, event.leaseToken);
        published += 1;
      } catch (error) {
        if (this.isLeaseLoss(error)) {
          throw error;
        }
        await this.repository.retryOutboxEvent(
          event.id,
          event.leaseToken,
          handlerVersion,
          {
            code: 'QUEUE_UNAVAILABLE',
            message: this.errorMessage(error),
            retryDelayMs: 1000,
          },
        );
      }
    }

    return published;
  }

  private handlerVersion(eventType: string): string {
    if (eventType === 'video_asset.requested') {
      return VIDEO_ASSET_HANDLER_VERSION;
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

  private errorMessage(error: unknown): string {
    return error instanceof Error
      ? error.message.replace(/\s+/g, ' ').trim().slice(0, 500)
      : 'Queue publish failed';
  }
}
