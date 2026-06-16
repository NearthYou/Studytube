import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class BookmarksRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async existsPost(postId: number) {
    const result = await this.databaseService.query<{ exists: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM posts
          WHERE id = $1
        ) AS exists
      `,
      [postId],
    );

    return result.rows[0]?.exists ?? false;
  }

  async addBookmark(userId: number, postId: number) {
    await this.databaseService.query(
      `
        INSERT INTO post_bookmarks (
          user_id,
          post_id
        )
        VALUES ($1, $2)
        ON CONFLICT (user_id, post_id) DO NOTHING
      `,
      [userId, postId],
    );
  }

  async removeBookmark(userId: number, postId: number) {
    await this.databaseService.query(
      `
        DELETE FROM post_bookmarks
        WHERE user_id = $1
          AND post_id = $2
      `,
      [userId, postId],
    );
  }
}
