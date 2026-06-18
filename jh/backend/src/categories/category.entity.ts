import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PostEntity } from '../posts/entities/post.entity';

@Entity({ name: 'categories' })
export class CategoryEntity {
  @PrimaryGeneratedColumn('increment', {
    name: 'category_id',
    type: 'bigint',
  })
  id: string;

  @Column({ name: 'name', type: 'varchar', length: 50, unique: true })
  name: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToMany(() => PostEntity, (post) => post.categories)
  posts: PostEntity[];
}
