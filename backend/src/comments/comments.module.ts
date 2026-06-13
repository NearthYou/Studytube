import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { CommentLikeEntity } from '../likes/comment-like.entity';
import { PostEntity } from '../posts/entities/post.entity';
import { CommentEntity } from './comment.entity';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([CommentEntity, PostEntity, CommentLikeEntity]),
  ],
  controllers: [CommentsController],
  providers: [CommentsService],
})
export class CommentsModule {}
