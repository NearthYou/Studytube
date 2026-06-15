import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

type UserRow = {
  id: number;
  login_id: string;
  name: string;
  nickname: string;
  bio: string | null;
  location: string | null;
  created_at: Date;
  updated_at: Date;
};

export type PublicUser = {
  id: number;
  loginId: string;
  name: string;
  nickname: string;
  bio: string;
  location: string;
  createdAt: string;
  updatedAt: string;
};

@Injectable()
export class UsersRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async findUserById(userId: number) {
    const result = await this.databaseService.query<UserRow>(
      `
        SELECT
          id,
          login_id,
          name,
          nickname,
          bio,
          location,
          created_at,
          updated_at
        FROM users
        WHERE id = $1
      `,
      [userId],
    );

    if (!result.rowCount) {
      return null;
    }

    return this.toPublicUser(result.rows[0]);
  }

  async updateUserProfile(params: {
    userId: number;
    nickname?: string;
    passwordHash?: string;
    bio?: string | null;
    location?: string | null;
  }) {
    const updates: string[] = [];
    const values: unknown[] = [];

    if (params.nickname !== undefined) {
      values.push(params.nickname);
      updates.push(`nickname = $${values.length}`);
    }

    if (params.passwordHash !== undefined) {
      values.push(params.passwordHash);
      updates.push(`password_hash = $${values.length}`);
    }

    if (params.bio !== undefined) {
      values.push(params.bio);
      updates.push(`bio = $${values.length}`);
    }

    if (params.location !== undefined) {
      values.push(params.location);
      updates.push(`location = $${values.length}`);
    }

    if (!updates.length) {
      return this.findUserById(params.userId);
    }

    values.push(params.userId);

    const result = await this.databaseService.query<UserRow>(
      `
        UPDATE users
        SET
          ${updates.join(', ')}
        WHERE id = $${values.length}
        RETURNING
          id,
          login_id,
          name,
          nickname,
          bio,
          location,
          created_at,
          updated_at
      `,
      values,
    );

    if (!result.rowCount) {
      return null;
    }

    return this.toPublicUser(result.rows[0]);
  }

  async isNicknameTakenByAnotherUser(userId: number, nickname: string) {
    const result = await this.databaseService.query<{ exists: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM users
          WHERE LOWER(nickname) = LOWER($1)
            AND id <> $2
        ) AS exists
      `,
      [nickname, userId],
    );

    return result.rows[0]?.exists ?? false;
  }

  private toPublicUser(row: UserRow): PublicUser {
    return {
      id: row.id,
      loginId: row.login_id,
      name: row.name,
      nickname: row.nickname,
      bio: row.bio ?? '',
      location: row.location ?? '',
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
}
