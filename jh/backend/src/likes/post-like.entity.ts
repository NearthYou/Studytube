import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { PostEntity } from '../posts/entities/post.entity';
import { UserEntity } from '../users/user.entity';

@Entity({ name: 'post_likes' })
@Unique('uq_post_likes_user_post', ['userId', 'postId'])
export class PostLikeEntity {
  @PrimaryGeneratedColumn('increment', {
    name: 'post_like_id',
    type: 'bigint',
  })
  id: string;

  @Column({ name: 'user_id', type: 'bigint' })
  userId: string;

  @Column({ name: 'post_id', type: 'bigint' })
  postId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @ManyToOne(() => PostEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'post_id' })
  post: PostEntity;
}
