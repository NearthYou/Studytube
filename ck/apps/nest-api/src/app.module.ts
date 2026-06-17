import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { CommentsModule } from './comments/comments.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { MetadataModule } from './metadata/metadata.module';
import { RagModule } from './rag/rag.module';
import { SeatReviewsModule } from './seat-reviews/seat-reviews.module';
import { TagsModule } from './tags/tags.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    AdminModule,
    HealthModule,
    AuthModule,
    MetadataModule,
    SeatReviewsModule,
    CommentsModule,
    TagsModule,
    RagModule,
  ],
})
export class AppModule {}
