import { HttpModule } from '@nestjs/axios';
import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { AiProxyService } from '../ai-proxy.service';
import { AuthModule } from '../auth/auth.module';
import { DatabaseService } from '../database.service';
import { VideoAssetService } from '../video-asset.service';
import { RetrievalEmbeddingJobHandler } from '../retrieval/retrieval-embedding.worker';
import {
  resolveRetrievalEmbeddingCacheMaintenanceOptions,
  RetrievalEmbeddingCacheMaintenance,
} from '../retrieval/retrieval-embedding-cache.maintenance';
import { BullMqVideoAssetWorker } from './bullmq-video-asset.worker';
import { DurableWorkRouter } from './durable-work.router';
import { VideoAssetJobHandler } from './video-asset.worker';
import { WORK_REPOSITORY, type WorkRepository } from './work.repository';
import { UnsupportedWorkJobHandler } from './unsupported-work.worker';
import { resolveValkeyUrl } from './work.module';
import { LearningModule } from '../learning/learning.module';
import { LearningService } from '../learning/learning.service';
import { QuizGenerationJobHandler } from '../learning/quiz-generation.worker';
import { AgentRunProcessor } from '../learning/agent-run.processor';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import { fromInstanceMetadata } from '@smithy/credential-provider-imds';
import {
  resolveVerificationEmailConfig,
  resolveVerificationPepper,
} from '../auth/verification-email.config';
import {
  CaptureVerificationEmailSender,
  SesV2VerificationEmailSender,
  VERIFICATION_EMAIL_SENDER,
  type VerificationEmailSender,
} from '../auth/verification-email-sender';
import { VerificationEmailOutboxWorker } from '../auth/verification-email-outbox.worker';
import { observabilityRuntime } from '../observability/runtime';
import { runtimeConfigOptions } from '../runtime-environment-files';
import { DurableJobExecutor } from './durable-job.executor';
import type { JobExecutionStore } from './job-execution.store';

@Module({
  imports: [
    ConfigModule.forRoot(runtimeConfigOptions(process.env)),
    AuthModule,
    LearningModule,
    HttpModule,
  ],
  providers: [
    AiProxyService,
    {
      provide: VideoAssetService,
      useFactory: (database: DatabaseService, aiProxy: AiProxyService) =>
        new VideoAssetService(database, aiProxy),
      inject: [DatabaseService, AiProxyService],
    },
    {
      provide: WORK_REPOSITORY,
      useFactory: (database: DatabaseService) => database.getWorkRepository(),
      inject: [DatabaseService],
    },
    {
      provide: DurableJobExecutor,
      useFactory: (
        repository: WorkRepository & JobExecutionStore,
        config: ConfigService,
      ) =>
        new DurableJobExecutor(repository, {
          leaseOwner:
            config.get<string>('WORK_JOB_LEASE_OWNER')?.trim() ||
            `job-executor-${process.pid}-${randomUUID()}`,
          leaseMs: positiveInteger(
            config.get<string>('WORK_JOB_LEASE_MS'),
            300_000,
          ),
        }),
      inject: [WORK_REPOSITORY, ConfigService],
    },
    {
      provide: VideoAssetJobHandler,
      useFactory: (
        database: DatabaseService,
        videoAssets: VideoAssetService,
        repository: WorkRepository,
        executor: DurableJobExecutor,
      ) =>
        new VideoAssetJobHandler(database, videoAssets, repository, executor),
      inject: [
        DatabaseService,
        VideoAssetService,
        WORK_REPOSITORY,
        DurableJobExecutor,
      ],
    },
    {
      provide: RetrievalEmbeddingJobHandler,
      useFactory: (
        database: DatabaseService,
        aiProxy: AiProxyService,
        executor: DurableJobExecutor,
      ) =>
        new RetrievalEmbeddingJobHandler(
          aiProxy,
          database.getRetrievalRepository(),
          executor,
        ),
      inject: [DatabaseService, AiProxyService, DurableJobExecutor],
    },
    {
      provide: RetrievalEmbeddingCacheMaintenance,
      useFactory: (database: DatabaseService) =>
        new RetrievalEmbeddingCacheMaintenance(
          database.getRetrievalRepository(),
          {
            ...resolveRetrievalEmbeddingCacheMaintenanceOptions(process.env),
            onError: () =>
              observabilityRuntime.logger.error(
                'retrieval_embedding_cache_maintenance_failed',
                undefined,
                { error_code: 'cache_maintenance_failed' },
              ),
          },
        ),
      inject: [DatabaseService],
    },
    {
      provide: QuizGenerationJobHandler,
      useFactory: (
        learning: LearningService,
        aiProxy: AiProxyService,
        executor: DurableJobExecutor,
      ) => new QuizGenerationJobHandler(learning, aiProxy, executor),
      inject: [LearningService, AiProxyService, DurableJobExecutor],
    },
    {
      provide: UnsupportedWorkJobHandler,
      useFactory: (executor: DurableJobExecutor) =>
        new UnsupportedWorkJobHandler(executor),
      inject: [DurableJobExecutor],
    },
    {
      provide: DurableWorkRouter,
      useFactory: (
        videoAssets: VideoAssetJobHandler,
        retrieval: RetrievalEmbeddingJobHandler,
        unsupported: UnsupportedWorkJobHandler,
        quiz: QuizGenerationJobHandler,
        learning: LearningService,
      ) =>
        new DurableWorkRouter(
          videoAssets,
          retrieval,
          unsupported,
          quiz,
          learning,
        ),
      inject: [
        VideoAssetJobHandler,
        RetrievalEmbeddingJobHandler,
        UnsupportedWorkJobHandler,
        QuizGenerationJobHandler,
        LearningService,
      ],
    },
    {
      provide: BullMqVideoAssetWorker,
      useFactory: (config: ConfigService, handler: DurableWorkRouter) =>
        new BullMqVideoAssetWorker(resolveValkeyUrl(config), handler),
      inject: [ConfigService, DurableWorkRouter],
    },
    {
      provide: AgentRunProcessor,
      useFactory: (
        learning: LearningService,
        aiProxy: AiProxyService,
        database: DatabaseService,
        config: ConfigService,
      ) => {
        const logger = new Logger(AgentRunProcessor.name);
        const leaseMs = positiveInteger(
          config.get<string>('AGENT_RUN_LEASE_MS'),
          300_000,
        );
        return new AgentRunProcessor(learning, aiProxy, database, {
          workerId:
            config.get<string>('AGENT_RUN_WORKER_ID')?.trim() ||
            `agent-run-${process.pid}`,
          leaseMs,
          processTimeoutMs: Math.min(
            positiveInteger(
              config.get<string>('AGENT_RUN_PROCESS_TIMEOUT_MS'),
              150_000,
            ),
            leaseMs - 1,
          ),
          pollIntervalMs: positiveInteger(
            config.get<string>('AGENT_RUN_POLL_INTERVAL_MS'),
            1_000,
          ),
          onError: (error) =>
            logger.error(
              error instanceof Error
                ? `AgentRun processor cycle failed: ${safeMessage(error.message)}`
                : 'AgentRun processor cycle failed',
            ),
        });
      },
      inject: [LearningService, AiProxyService, DatabaseService, ConfigService],
    },
    {
      provide: VERIFICATION_EMAIL_SENDER,
      useFactory: (): VerificationEmailSender => {
        const config = resolveVerificationEmailConfig(process.env);
        if (config.provider === 'capture') {
          if (!config.captureDirectory) {
            throw new RangeError('AUTH_EMAIL_CAPTURE_DIR is required');
          }
          return new CaptureVerificationEmailSender(config.captureDirectory);
        }
        if (!config.region) {
          throw new RangeError('AWS_REGION is required for SES email');
        }
        if (config.sesCredentialSource !== 'instance-role') {
          throw new RangeError('EC2 instance role is required for SES email');
        }
        return new SesV2VerificationEmailSender(
          new SESv2Client({
            region: config.region,
            credentials: fromInstanceMetadata({
              ec2MetadataV1Disabled: true,
              maxRetries: 3,
              timeout: 1_000,
            }),
          }),
          config.sendTimeoutMs,
          config.configurationSetName,
        );
      },
    },
    {
      provide: VerificationEmailOutboxWorker,
      useFactory: (
        database: DatabaseService,
        sender: VerificationEmailSender,
      ) => {
        const config = resolveVerificationEmailConfig(process.env);
        const verificationPepper = resolveVerificationPepper(process.env);
        return new VerificationEmailOutboxWorker(
          database.getVerificationEmailOutboxRepository(),
          sender,
          {
            verificationPepper,
            clock: () => new Date(),
            pollIntervalMs: config.pollIntervalMs,
            leaseMs: config.leaseMs,
            sendTimeoutMs: config.sendTimeoutMs,
            maxAttempts: config.maxAttempts,
            retryBaseMs: config.retryBaseMs,
            retryMaxMs: config.retryMaxMs,
            log: (event, fields) => {
              if (event === 'verification_email_sent') {
                observabilityRuntime.logger.info(event, fields);
              } else {
                observabilityRuntime.logger.warn(event, fields);
              }
            },
            onError: () =>
              observabilityRuntime.logger.error(
                'verification_email_worker_cycle_failed',
                undefined,
                { error_code: 'worker_cycle_failed' },
              ),
          },
        );
      },
      inject: [DatabaseService, VERIFICATION_EMAIL_SENDER],
    },
  ],
})
export class WorkerModule {}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function safeMessage(message: string): string {
  return message.replace(/\s+/gu, ' ').trim().slice(0, 500);
}
