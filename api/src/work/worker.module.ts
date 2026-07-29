import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AiProxyService } from '../ai-proxy.service';
import { AuthModule } from '../auth/auth.module';
import { DatabaseService } from '../database.service';
import { VideoAssetService } from '../video-asset.service';
import { BullMqVideoAssetWorker } from './bullmq-video-asset.worker';
import { VideoAssetJobHandler } from './video-asset.worker';
import { WORK_REPOSITORY, type WorkRepository } from './work.repository';
import { resolveValkeyUrl } from './work.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['api/.env', '.env'],
    }),
    AuthModule,
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
      provide: VideoAssetJobHandler,
      useFactory: (
        database: DatabaseService,
        videoAssets: VideoAssetService,
        repository: WorkRepository,
      ) => new VideoAssetJobHandler(database, videoAssets, repository),
      inject: [DatabaseService, VideoAssetService, WORK_REPOSITORY],
    },
    {
      provide: BullMqVideoAssetWorker,
      useFactory: (config: ConfigService, handler: VideoAssetJobHandler) =>
        new BullMqVideoAssetWorker(resolveValkeyUrl(config), handler),
      inject: [ConfigService, VideoAssetJobHandler],
    },
  ],
})
export class WorkerModule {}
