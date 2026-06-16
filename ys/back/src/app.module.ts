import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { BookmarksModule } from './bookmarks/bookmarks.module';
import { CommentsModule } from './comments/comments.module';
import { RateLimitGuard } from './common/guards/rate-limit.guard';
import { DatabaseModule } from './database/database.module';
import { FollowsModule } from './follows/follows.module';
import { LookupsModule } from './lookups/lookups.module';
import { MeModule } from './me/me.module';
import { PostsModule } from './posts/posts.module';
import { AiSyncModule } from './ai-sync/ai-sync.module';
import { UsersModule } from './users/users.module';
import { validateEnvironment } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate: validateEnvironment,
    }),
    DatabaseModule,
    AiSyncModule,
    AuthModule,
    PostsModule,
    LookupsModule,
    CommentsModule,
    BookmarksModule,
    FollowsModule,
    MeModule,
    UsersModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
  ],
})
export class AppModule {}
