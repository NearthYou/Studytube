import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { BookmarksModule } from './bookmarks/bookmarks.module';
import { CommentsModule } from './comments/comments.module';
import { DatabaseModule } from './database/database.module';
import { FollowsModule } from './follows/follows.module';
import { LookupsModule } from './lookups/lookups.module';
import { MeModule } from './me/me.module';
import { PostsModule } from './posts/posts.module';
import { AiSyncModule } from './ai-sync/ai-sync.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
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
})
export class AppModule {}
