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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['api/.env', '.env'],
    }),
    HttpModule,
  ],
  controllers: [AppController, StudyBoardController, AiController],
  providers: [
    AppService,
    DatabaseService,
    AiProxyService,
    {
      provide: StudyBoardService,
      useFactory: (databaseService: DatabaseService) =>
        new StudyBoardService(databaseService),
      inject: [DatabaseService],
    },
  ],
})
export class AppModule {}
