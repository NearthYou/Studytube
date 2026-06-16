import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { CommentEntity } from '../comments/comment.entity';
import { PostEntity } from '../posts/entities/post.entity';
import { CommentLikeEntity } from './comment-like.entity';
import { LikesController } from './likes.controller';
import { LikesService } from './likes.service';
import { PostLikeEntity } from './post-like.entity';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      PostEntity,
      CommentEntity,
      PostLikeEntity,
      CommentLikeEntity,
    ]),
  ],
  controllers: [LikesController],
  providers: [LikesService],
})
export class LikesModule {}
