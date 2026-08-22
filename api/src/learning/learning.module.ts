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
import { LearningItemController } from './learning-item.controller';
import { LearningItemService } from './learning-item.service';
import {
  LEARNING_NOTE_REPOSITORY,
  type LearningNoteRepository,
} from './learning-note.repository';
import { PostgresLearningNoteRepository } from './postgres-learning-note.repository';
import {
  PROVIDER_BUDGET_REPOSITORY,
  type ProviderBudgetRepository,
} from './provider-budget.repository';
import { PostgresProviderBudgetRepository } from './postgres-provider-budget.repository';
import {
  LEARNING_PROPOSAL_REPOSITORY,
  type LearningProposalRepository,
} from './learning-proposal.repository';
import { PostgresLearningProposalRepository } from './postgres-learning-proposal.repository';

@Module({
  imports: [AuthModule, ConfigModule],
  controllers: [LearningController, LearningItemController],
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
      provide: PROVIDER_BUDGET_REPOSITORY,
      useFactory: (database: LearningDatabase) =>
        new PostgresProviderBudgetRepository(database.pool, {
          enabled: process.env.AI_INTAKE_ENABLED !== 'false',
          maxGlobalDailyAudioSeconds: environmentInteger(
            'AI_GLOBAL_DAILY_AUDIO_SECONDS',
            28_800,
          ),
          maxUserDailyAudioSeconds: environmentInteger(
            'AI_USER_DAILY_AUDIO_SECONDS',
            7_200,
          ),
          maxConcurrentWorks: environmentInteger('AI_MAX_CONCURRENT_WORKS', 4),
          maxConcurrentWorksPerUser: environmentInteger(
            'AI_MAX_CONCURRENT_WORKS_PER_USER',
            1,
          ),
          microsPerAudioSecond: environmentInteger(
            'AI_ESTIMATED_MICROUNITS_PER_AUDIO_SECOND',
            1,
            true,
          ),
          maxGlobalDailyCostMicrounits: environmentInteger(
            'AI_GLOBAL_DAILY_COST_MICROUNITS',
            28_800,
          ),
        }),
      inject: [LearningDatabase],
    },
    {
      provide: LEARNING_NOTE_REPOSITORY,
      useFactory: (database: LearningDatabase): LearningNoteRepository =>
        new PostgresLearningNoteRepository(database.pool),
      inject: [LearningDatabase],
    },
    {
      provide: LearningItemService,
      useFactory: (
        budget: ProviderBudgetRepository,
        items: LearningItemRepository,
      ) => new LearningItemService(budget, items),
      inject: [PROVIDER_BUDGET_REPOSITORY, LEARNING_ITEM_REPOSITORY],
    },
    {
      provide: LEARNING_PROPOSAL_REPOSITORY,
      useFactory: (database: LearningDatabase): LearningProposalRepository =>
        new PostgresLearningProposalRepository(database.pool),
      inject: [LearningDatabase],
    },
    {
      provide: LearningService,
      useFactory: (
        repository: LearningRepository,
        proposals: LearningProposalRepository,
      ) => new LearningService(repository, proposals),
      inject: [LEARNING_REPOSITORY, LEARNING_PROPOSAL_REPOSITORY],
    },
  ],
  exports: [
    LEARNING_ITEM_REPOSITORY,
    LEARNING_NOTE_REPOSITORY,
    PROVIDER_BUDGET_REPOSITORY,
    LEARNING_REPOSITORY,
    LEARNING_PROPOSAL_REPOSITORY,
    LearningService,
  ],
})
export class LearningModule {}

function environmentInteger(
  name: string,
  fallback: number,
  allowZero = false,
): number {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < (allowZero ? 0 : 1)) {
    throw new RangeError(`${name} is invalid`);
  }
  return parsed;
}
