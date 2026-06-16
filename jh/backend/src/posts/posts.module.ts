import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { CategoryEntity } from '../categories/category.entity';
import { CommentEntity } from '../comments/comment.entity';
import { PostLikeEntity } from '../likes/post-like.entity';
import { PostImageEntity } from './entities/post-image.entity';
import { PostEntity } from './entities/post.entity';
import { TagEntity } from './entities/tag.entity';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      PostEntity,
      CategoryEntity,
      PostImageEntity,
      PostLikeEntity,
      CommentEntity,
      TagEntity,
    ]),
  ],
  controllers: [PostsController],
  providers: [PostsService],
  exports: [PostsService],
})
export class PostsModule {}
