import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { AiController } from './ai.controller';
import { AiProxyService } from './ai-proxy.service';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseService } from './database.service';
import { StudyBoardService } from './study-board.service';
import { VideoAssetController } from './video-asset.controller';
import { VideoAssetService } from './video-asset.service';
import { AuthModule } from './auth/auth.module';
import { CourseCutoverPolicy } from './course/course-cutover.policy';
import { CourseModule } from './course/course.module';
import { WorkModule } from './work/work.module';
import { ObservabilityModule } from './observability';
import { LearningModule } from './learning/learning.module';
import { McpModule } from './mcp/mcp.module';
import { runtimeConfigOptions } from './runtime-environment-files';
import { LiveCaptionService } from './live-caption.service';

@Module({
  imports: [
    ConfigModule.forRoot(runtimeConfigOptions(process.env)),
    ObservabilityModule,
    LearningModule,
    McpModule,
    AuthModule,
    CourseModule,
    WorkModule,
    HttpModule,
  ],
  controllers: [AppController, AiController, VideoAssetController],
  providers: [
    AppService,
    AiProxyService,
    {
      provide: LiveCaptionService,
      useFactory: (
        aiProxyService: AiProxyService,
        databaseService: DatabaseService,
      ) =>
        new LiveCaptionService(
          aiProxyService,
          databaseService.getLiveCaptionRepository(),
        ),
      inject: [AiProxyService, DatabaseService],
    },
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
        courseCutoverPolicy: CourseCutoverPolicy,
      ) =>
        new StudyBoardService(
          databaseService,
          videoAssetService,
          courseCutoverPolicy,
        ),
      inject: [DatabaseService, VideoAssetService, CourseCutoverPolicy],
    },
  ],
})
export class AppModule {}
