import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserEntity } from '../../users/user.entity';
import { PostEntity } from './post.entity';

@Entity({ name: 'post_images' })
export class PostImageEntity {
  @PrimaryGeneratedColumn('increment', { name: 'image_id', type: 'bigint' })
  id: string;

  @Column({ name: 'post_id', type: 'bigint', nullable: true })
  postId: string | null;

  @Column({ name: 'user_id', type: 'bigint', nullable: true })
  userId: string | null;

  @Column({ name: 'original_filename', type: 'varchar', length: 255 })
  originalFilename: string;

  @Column({
    name: 'stored_filename',
    type: 'varchar',
    length: 255,
    unique: true,
  })
  storedFilename: string;

  @Column({ name: 'file_path', type: 'text', unique: true })
  filePath: string;

  @Column({ name: 'thumbnail_path', type: 'text', nullable: true })
  thumbnailPath: string | null;

  @Column({ name: 'card_path', type: 'text', nullable: true })
  cardPath: string | null;

  @Column({ name: 'detail_path', type: 'text', nullable: true })
  detailPath: string | null;

  @Column({ name: 'file_size', type: 'bigint' })
  fileSize: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 100 })
  mimeType: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => PostEntity, (post) => post.images, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'post_id' })
  post: PostEntity | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity | null;
}
