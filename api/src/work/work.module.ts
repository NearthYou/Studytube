import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { DatabaseService } from '../database.service';
import { BullMqWorkQueue } from './bullmq-work.queue';
import { OutboxRelayService } from './outbox-relay.service';
import { WORK_QUEUE_PUBLISHER, type WorkQueuePublisher } from './work.queue';
import { WORK_REPOSITORY, type WorkRepository } from './work.repository';

@Module({
  imports: [AuthModule, ConfigModule],
  providers: [
    {
      provide: WORK_REPOSITORY,
      useFactory: (database: DatabaseService) => database.getWorkRepository(),
      inject: [DatabaseService],
    },
    {
      provide: WORK_QUEUE_PUBLISHER,
      useFactory: (config: ConfigService) =>
        BullMqWorkQueue.connect(resolveValkeyUrl(config)),
      inject: [ConfigService],
    },
    {
      provide: OutboxRelayService,
      useFactory: (
        repository: WorkRepository,
        queue: WorkQueuePublisher,
        config: ConfigService,
      ) => {
        const logger = new Logger(OutboxRelayService.name);
        return new OutboxRelayService(repository, queue, {
          pollIntervalMs: resolveOutboxPollInterval(config),
          publishTimeoutMs: resolveOutboxPublishTimeout(config),
          onError: (error) =>
            logger.error(
              error instanceof Error
                ? `Outbox relay cycle failed: ${safeMessage(error.message)}`
                : 'Outbox relay cycle failed',
            ),
        });
      },
      inject: [WORK_REPOSITORY, WORK_QUEUE_PUBLISHER, ConfigService],
    },
  ],
  exports: [WORK_REPOSITORY],
})
export class WorkModule {}

export function resolveValkeyUrl(config: ConfigService): string {
  const value = config.get<string>('VALKEY_URL')?.trim();
  if (value) {
    return value;
  }
  if (config.get<string>('NODE_ENV') === 'production') {
    throw new RangeError('VALKEY_URL must be configured in production');
  }
  return 'redis://127.0.0.1:6379';
}

export function resolveOutboxPollInterval(config: ConfigService): number {
  const value = Number(config.get<string>('OUTBOX_POLL_INTERVAL_MS'));
  return Number.isInteger(value) && value > 0 ? value : 1000;
}

export function resolveOutboxPublishTimeout(config: ConfigService): number {
  const value = Number(config.get<string>('OUTBOX_PUBLISH_TIMEOUT_MS'));
  return Number.isInteger(value) && value > 0 && value < 30_000
    ? value
    : 20_000;
}

function safeMessage(message: string): string {
  return message
    .replace(/\b(redis(?:s)?:\/\/)[^\s/@?#]+@/giu, '$1[redacted]@')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}
