import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PostEntity } from '../posts/entities/post.entity';
import { UserEntity } from '../users/user.entity';

@Entity({ name: 'comments' })
export class CommentEntity {
  @PrimaryGeneratedColumn('increment', {
    name: 'comment_id',
    type: 'bigint',
  })
  id: string;

  @Column({ name: 'post_id', type: 'bigint' })
  postId: string;

  @Column({ name: 'user_id', type: 'bigint' })
  userId: string;

  @Column({ name: 'content', type: 'text' })
  content: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', nullable: true })
  updatedAt: Date | null;

  @ManyToOne(() => PostEntity, (post) => post.comments, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'post_id' })
  post: PostEntity;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'user_id' })
  author: UserEntity;
}
