import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { PostsModule } from '../posts/posts.module';
import { CategoriesController } from './categories.controller';
import { CategoryEntity } from './category.entity';
import { CategoriesService } from './categories.service';

@Module({
  imports: [
    AuthModule,
    PostsModule,
    TypeOrmModule.forFeature([CategoryEntity]),
  ],
  controllers: [CategoriesController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
