import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

type UserCountRow = {
  total_count: number;
};

type FollowUserRow = {
  id: number;
  login_id: string;
  name: string;
  email: string;
  nickname: string;
  bio: string | null;
  location: string | null;
  created_at: Date;
  updated_at: Date;
};

export type FollowUserItem = {
  id: number;
  loginId: string;
  name: string;
  email: string;
  nickname: string;
  bio: string;
  location: string;
  createdAt: string;
  updatedAt: string;
};

@Injectable()
export class FollowsRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async existsUser(userId: number) {
    const result = await this.databaseService.query<{ exists: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM users
          WHERE id = $1
        ) AS exists
      `,
      [userId],
    );

    return result.rows[0]?.exists ?? false;
  }

  async addFollow(followerId: number, followingId: number) {
    await this.databaseService.query(
      `
        INSERT INTO user_follows (
          follower_id,
          following_id
        )
        VALUES ($1, $2)
        ON CONFLICT (follower_id, following_id) DO NOTHING
      `,
      [followerId, followingId],
    );
  }

  async removeFollow(followerId: number, followingId: number) {
    await this.databaseService.query(
      `
        DELETE FROM user_follows
        WHERE follower_id = $1
          AND following_id = $2
      `,
      [followerId, followingId],
    );
  }

  async findFollowingIds(followerId: number) {
    const result = await this.databaseService.query<{ following_id: number }>(
      `
        SELECT following_id
        FROM user_follows
        WHERE follower_id = $1
        ORDER BY created_at DESC, following_id DESC
      `,
      [followerId],
    );

    return result.rows.map((row) => row.following_id);
  }

  async findFollowers(userId: number, page: number, limit: number) {
    return this.findPagedUsers(
      `
        FROM user_follows uf
        JOIN users u
          ON u.id = uf.follower_id
        WHERE uf.following_id = $1
      `,
      `
        ORDER BY uf.created_at DESC, uf.follower_id DESC
      `,
      [userId],
      page,
      limit,
    );
  }

  async findFollowings(userId: number, page: number, limit: number) {
    return this.findPagedUsers(
      `
        FROM user_follows uf
        JOIN users u
          ON u.id = uf.following_id
        WHERE uf.follower_id = $1
      `,
      `
        ORDER BY uf.created_at DESC, uf.following_id DESC
      `,
      [userId],
      page,
      limit,
    );
  }

  private async findPagedUsers(
    fromClause: string,
    orderByClause: string,
    values: unknown[],
    page: number,
    limit: number,
  ) {
    const offset = (page - 1) * limit;
    const countResult = await this.databaseService.query<UserCountRow>(
      `
        SELECT COUNT(*)::int AS total_count
        ${fromClause}
      `,
      values,
    );

    const rowsResult = await this.databaseService.query<FollowUserRow>(
      `
        SELECT
          u.id,
          u.login_id,
          u.name,
          u.email,
          u.nickname,
          u.bio,
          u.location,
          u.created_at,
          u.updated_at
        ${fromClause}
        ${orderByClause}
        LIMIT $${values.length + 1}
        OFFSET $${values.length + 2}
      `,
      [...values, limit, offset],
    );

    return {
      totalCount: countResult.rows[0]?.total_count ?? 0,
      items: rowsResult.rows.map((row) => this.toFollowUserItem(row)),
    };
  }

  private toFollowUserItem(row: FollowUserRow): FollowUserItem {
    return {
      id: row.id,
      loginId: row.login_id,
      name: row.name,
      email: row.email,
      nickname: row.nickname,
      bio: row.bio ?? '',
      location: row.location ?? '',
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
}
