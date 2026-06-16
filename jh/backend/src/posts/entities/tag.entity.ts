import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PostEntity } from './post.entity';

@Entity({ name: 'tags' })
export class TagEntity {
  @PrimaryGeneratedColumn('increment', { name: 'tag_id', type: 'bigint' })
  id: string;

  @Column({ name: 'name', type: 'varchar', length: 20, unique: true })
  name: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToMany(() => PostEntity, (post) => post.tags)
  posts: PostEntity[];
}
