import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { AiController } from './ai.controller';
import { AiProxyService } from './ai-proxy.service';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseService } from './database.service';
import { StudyBoardController } from './study-board.controller';
import { StudyBoardService } from './study-board.service';
import { VideoAssetController } from './video-asset.controller';
import { VideoAssetService } from './video-asset.service';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['api/.env', '.env'],
    }),
    AuthModule,
    HttpModule,
  ],
  controllers: [
    AppController,
    StudyBoardController,
    AiController,
    VideoAssetController,
  ],
  providers: [
    AppService,
    AiProxyService,
    {
      provide: VideoAssetService,
      useFactory: (
        databaseService: DatabaseService,
        aiProxyService: AiProxyService,
      ) => new VideoAssetService(databaseService, aiProxyService),
      inject: [DatabaseService, AiProxyService],
    },
    {
      provide: StudyBoardService,
      useFactory: (
        databaseService: DatabaseService,
        videoAssetService: VideoAssetService,
      ) => new StudyBoardService(databaseService, videoAssetService),
      inject: [DatabaseService, VideoAssetService],
    },
  ],
})
export class AppModule {}
