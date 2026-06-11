import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

type CommentRow = {
  id: number;
  post_id: number;
  author_id: number;
  content: string;
  created_at: Date;
  updated_at: Date;
  author_name: string;
  author_nickname: string;
  author_bio: string | null;
  author_location: string | null;
};

type ReplyRow = {
  id: number;
  comment_id: number;
  author_id: number;
  content: string;
  created_at: Date;
  updated_at: Date;
  author_name: string;
  author_nickname: string;
  author_bio: string | null;
  author_location: string | null;
};

export type ReplyView = {
  id: number;
  authorId: number;
  content: string;
  createdAt: string;
  updatedAt: string;
  author: {
    id: number;
    name: string;
    nickname: string;
    bio: string;
    location: string;
  };
};

export type CommentView = {
  id: number;
  authorId: number;
  content: string;
  createdAt: string;
  updatedAt: string;
  author: {
    id: number;
    name: string;
    nickname: string;
    bio: string;
    location: string;
  };
  replies: ReplyView[];
};

@Injectable()
export class CommentsRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async findPostComments(postId: number) {
    const commentsResult = await this.databaseService.query<CommentRow>(
      `
        SELECT
          c.id,
          c.post_id,
          c.author_id,
          c.content,
          c.created_at,
          c.updated_at,
          u.name AS author_name,
          u.nickname AS author_nickname,
          u.bio AS author_bio,
          u.location AS author_location
        FROM comments c
        JOIN users u
          ON u.id = c.author_id
        WHERE c.post_id = $1
          AND c.is_deleted = FALSE
        ORDER BY c.created_at DESC, c.id DESC
      `,
      [postId],
    );

    if (!commentsResult.rowCount) {
      return [] as CommentView[];
    }

    const commentIds = commentsResult.rows.map((row) => row.id);
    const repliesResult = await this.databaseService.query<ReplyRow>(
      `
        SELECT
          r.id,
          r.comment_id,
          r.author_id,
          r.content,
          r.created_at,
          r.updated_at,
          u.name AS author_name,
          u.nickname AS author_nickname,
          u.bio AS author_bio,
          u.location AS author_location
        FROM comment_replies r
        JOIN users u
          ON u.id = r.author_id
        WHERE r.comment_id = ANY($1::bigint[])
          AND r.is_deleted = FALSE
        ORDER BY r.created_at ASC, r.id ASC
      `,
      [commentIds],
    );

    const repliesByCommentId = new Map<number, ReplyView[]>();

    for (const row of repliesResult.rows) {
      const entry = repliesByCommentId.get(row.comment_id) ?? [];
      entry.push(this.toReplyView(row));
      repliesByCommentId.set(row.comment_id, entry);
    }

    return commentsResult.rows.map((row) => ({
      ...this.toCommentBase(row),
      replies: repliesByCommentId.get(row.id) ?? [],
    }));
  }

  async createComment(postId: number, authorId: number, content: string) {
    const result = await this.databaseService.query<{ id: number }>(
      `
        INSERT INTO comments (
          post_id,
          author_id,
          content
        )
        VALUES ($1, $2, $3)
        RETURNING id
      `,
      [postId, authorId, content],
    );

    return this.findCommentById(result.rows[0].id);
  }

  async createReply(commentId: number, authorId: number, content: string) {
    const result = await this.databaseService.query<{ id: number }>(
      `
        INSERT INTO comment_replies (
          comment_id,
          author_id,
          content
        )
        VALUES ($1, $2, $3)
        RETURNING id
      `,
      [commentId, authorId, content],
    );

    return this.findReplyById(result.rows[0].id);
  }

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

  async findCommentPostId(commentId: number) {
    const result = await this.databaseService.query<{ post_id: number }>(
      `
        SELECT post_id
        FROM comments
        WHERE id = $1
          AND is_deleted = FALSE
      `,
      [commentId],
    );

    if (!result.rowCount) {
      return null;
    }

    return result.rows[0].post_id;
  }

  private async findCommentById(commentId: number) {
    const result = await this.databaseService.query<CommentRow>(
      `
        SELECT
          c.id,
          c.post_id,
          c.author_id,
          c.content,
          c.created_at,
          c.updated_at,
          u.name AS author_name,
          u.nickname AS author_nickname,
          u.bio AS author_bio,
          u.location AS author_location
        FROM comments c
        JOIN users u
          ON u.id = c.author_id
        WHERE c.id = $1
      `,
      [commentId],
    );

    if (!result.rowCount) {
      return null;
    }

    return {
      ...this.toCommentBase(result.rows[0]),
      replies: [],
    };
  }

  private async findReplyById(replyId: number) {
    const result = await this.databaseService.query<ReplyRow>(
      `
        SELECT
          r.id,
          r.comment_id,
          r.author_id,
          r.content,
          r.created_at,
          r.updated_at,
          u.name AS author_name,
          u.nickname AS author_nickname,
          u.bio AS author_bio,
          u.location AS author_location
        FROM comment_replies r
        JOIN users u
          ON u.id = r.author_id
        WHERE r.id = $1
      `,
      [replyId],
    );

    if (!result.rowCount) {
      return null;
    }

    return this.toReplyView(result.rows[0]);
  }

  private toCommentBase(row: CommentRow) {
    return {
      id: row.id,
      authorId: row.author_id,
      content: row.content,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      author: {
        id: row.author_id,
        name: row.author_name,
        nickname: row.author_nickname,
        bio: row.author_bio ?? '',
        location: row.author_location ?? '',
      },
    };
  }

  private toReplyView(row: ReplyRow): ReplyView {
    return {
      id: row.id,
      authorId: row.author_id,
      content: row.content,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      author: {
        id: row.author_id,
        name: row.author_name,
        nickname: row.author_nickname,
        bio: row.author_bio ?? '',
        location: row.author_location ?? '',
      },
    };
  }
}
