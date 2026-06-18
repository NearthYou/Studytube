import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { FollowsController } from './follows.controller';
import { FollowsService } from './follows.service';
import { FollowsRepository } from './repositories/follows.repository';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [FollowsController],
  providers: [FollowsService, FollowsRepository],
  exports: [FollowsService, FollowsRepository],
})
export class FollowsModule {}
