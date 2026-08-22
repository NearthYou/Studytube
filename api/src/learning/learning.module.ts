import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { LearningController } from './learning.controller';
import { LearningDatabase } from './learning.database';
import { DatabaseService } from '../database.service';
import {
  LEARNING_ITEM_REPOSITORY,
  type LearningItemRepository,
} from './learning-item.repository';
import {
  LEARNING_REPOSITORY,
  type LearningRepository,
} from './learning.repository';
import { LearningService } from './learning.service';
import { PostgresLearningRepository } from './postgres-learning.repository';

@Module({
  imports: [AuthModule, ConfigModule],
  controllers: [LearningController],
  providers: [
    LearningDatabase,
    {
      provide: LEARNING_ITEM_REPOSITORY,
      useFactory: (database: DatabaseService) =>
        database.getLearningItemRepository(),
      inject: [DatabaseService],
    },
    {
      provide: LEARNING_REPOSITORY,
      useFactory: (database: LearningDatabase) =>
        new PostgresLearningRepository(database.pool),
      inject: [LearningDatabase],
    },
    {
      provide: LearningService,
      useFactory: (repository: LearningRepository) =>
        new LearningService(repository),
      inject: [LEARNING_REPOSITORY],
    },
  ],
  exports: [LEARNING_ITEM_REPOSITORY, LEARNING_REPOSITORY, LearningService],
})
export class LearningModule {}
