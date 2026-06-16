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

type CommentActivityCountRow = {
  total_count: number;
};

type CommentActivityRow = {
  id: number;
  post_id: number;
  post_title: string;
  content: string;
  created_at: Date;
  updated_at: Date;
  activity_type: 'comment' | 'reply';
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

export type CommentActivityItem = {
  id: number;
  postId: number;
  postTitle: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  type: 'comment' | 'reply';
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

  async findCommentsByAuthorId(authorId: number, page: number, limit: number) {
    const offset = (page - 1) * limit;
    const countResult = await this.databaseService.query<CommentActivityCountRow>(
      `
        SELECT COUNT(*)::int AS total_count
        FROM (
          SELECT c.id
          FROM comments c
          WHERE c.author_id = $1
            AND c.is_deleted = FALSE

          UNION ALL

          SELECT r.id
          FROM comment_replies r
          WHERE r.author_id = $1
            AND r.is_deleted = FALSE
        ) activity
      `,
      [authorId],
    );

    const result = await this.databaseService.query<CommentActivityRow>(
      `
        SELECT
          c.id,
          c.post_id,
          p.title AS post_title,
          c.content,
          c.created_at,
          c.updated_at,
          'comment'::text AS activity_type
        FROM comments c
        JOIN posts p
          ON p.id = c.post_id
        WHERE c.author_id = $1
          AND c.is_deleted = FALSE

        UNION ALL

        SELECT
          r.id,
          c.post_id,
          p.title AS post_title,
          r.content,
          r.created_at,
          r.updated_at,
          'reply'::text AS activity_type
        FROM comment_replies r
        JOIN comments c
          ON c.id = r.comment_id
        JOIN posts p
          ON p.id = c.post_id
        WHERE r.author_id = $1
          AND r.is_deleted = FALSE

        ORDER BY created_at DESC, id DESC
        LIMIT $2
        OFFSET $3
      `,
      [authorId, limit, offset],
    );

    return {
      totalCount: countResult.rows[0]?.total_count ?? 0,
      items: result.rows.map((row) => ({
        id: row.id,
        postId: row.post_id,
        postTitle: row.post_title,
        content: row.content,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        type: row.activity_type,
      })),
    };
  }

  async findCommentByIdForOwnership(commentId: number) {
    const result = await this.databaseService.query<{
      id: number;
      post_id: number;
      author_id: number;
      is_deleted: boolean;
    }>(
      `
        SELECT id, post_id, author_id, is_deleted
        FROM comments
        WHERE id = $1
      `,
      [commentId],
    );

    if (!result.rowCount || result.rows[0].is_deleted) {
      return null;
    }

    return result.rows[0];
  }

  async findReplyByIdForOwnership(replyId: number) {
    const result = await this.databaseService.query<{
      id: number;
      comment_id: number;
      author_id: number;
      is_deleted: boolean;
    }>(
      `
        SELECT id, comment_id, author_id, is_deleted
        FROM comment_replies
        WHERE id = $1
      `,
      [replyId],
    );

    if (!result.rowCount || result.rows[0].is_deleted) {
      return null;
    }

    return result.rows[0];
  }

  async updateComment(commentId: number, content: string) {
    await this.databaseService.query(
      `
        UPDATE comments
        SET content = $2
        WHERE id = $1
      `,
      [commentId, content],
    );

    return this.findCommentById(commentId);
  }

  async deleteComment(commentId: number) {
    await this.databaseService.query(
      `
        UPDATE comments
        SET
          is_deleted = TRUE,
          content = '[deleted]'
        WHERE id = $1
      `,
      [commentId],
    );
  }

  async updateReply(replyId: number, content: string) {
    await this.databaseService.query(
      `
        UPDATE comment_replies
        SET content = $2
        WHERE id = $1
      `,
      [replyId, content],
    );

    return this.findReplyById(replyId);
  }

  async deleteReply(replyId: number) {
    await this.databaseService.query(
      `
        UPDATE comment_replies
        SET
          is_deleted = TRUE,
          content = '[deleted]'
        WHERE id = $1
      `,
      [replyId],
    );
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
          AND c.is_deleted = FALSE
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
          AND r.is_deleted = FALSE
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
