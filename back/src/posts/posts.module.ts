import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { PostsRepository } from './repositories/posts.repository';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [PostsController],
  providers: [PostsService, PostsRepository],
  exports: [PostsService, PostsRepository],
})
export class PostsModule {}
