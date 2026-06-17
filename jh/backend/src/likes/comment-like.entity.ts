import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { CommentEntity } from '../comments/comment.entity';
import { UserEntity } from '../users/user.entity';

@Entity({ name: 'comment_likes' })
@Unique('uq_comment_likes_user_comment', ['userId', 'commentId'])
export class CommentLikeEntity {
  @PrimaryGeneratedColumn('increment', {
    name: 'comment_like_id',
    type: 'bigint',
  })
  id: string;

  @Column({ name: 'user_id', type: 'bigint' })
  userId: string;

  @Column({ name: 'comment_id', type: 'bigint' })
  commentId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @ManyToOne(() => CommentEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'comment_id' })
  comment: CommentEntity;
}
