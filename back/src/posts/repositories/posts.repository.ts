import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { PostSort } from '../types/post-sort.type';

const DEFAULT_POST_IMAGE_URL =
  'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80';

type FindPostsParams = {
  q?: string;
  regionCode?: string;
  budgetCode?: string;
  themeCode?: string;
  season?: string;
  companion?: string;
  sort: PostSort;
  page: number;
  limit: number;
};

type CreatePostParams = {
  authorId: number;
  title: string;
  summary: string | null;
  content: string | null;
  imageUrl: string | null;
  regionId: number;
  budgetRangeId: number;
  themeId: number;
  season: string;
  companion: string;
  travelDate: string;
  tags: string[];
};

type PostCountRow = {
  total_count: number;
};

type PostRow = {
  id: number;
  author_id: number;
  title: string;
  summary: string | null;
  content: string | null;
  image_url: string | null;
  region_code: string;
  region_name: string;
  budget_code: string;
  budget_label: string;
  theme_code: string;
  theme_name: string;
  season: string;
  companion: string;
  travel_date: string;
  tags: string[] | null;
  view_count: number;
  comment_count: number;
  created_at: Date;
  updated_at: Date;
  author_name: string;
  author_nickname: string;
  author_bio: string | null;
  author_location: string | null;
};

type PostFilterRow = {
  region_id: number;
  region_code: string;
  region_name: string;
  budget_range_id: number;
  budget_code: string;
  budget_label: string;
  theme_id: number;
  theme_code: string;
  theme_name: string;
};

export type PostListItem = {
  id: number;
  title: string;
  summary: string;
  content: string;
  region: string;
  regionCode: string;
  budget: string;
  budgetCode: string;
  theme: string;
  themeCode: string;
  season: string;
  companion: string;
  createdAt: string;
  updatedAt: string;
  travelDate: string;
  views: number;
  discussionCount: number;
  imageUrl: string;
  tags: string[];
  authorId: number;
  author: {
    id: number;
    name: string;
    nickname: string;
    bio: string;
    location: string;
  };
};

@Injectable()
export class PostsRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async findPosts(params: FindPostsParams) {
    const fromClause = `
      FROM posts p
      JOIN users u
        ON u.id = p.author_id
      JOIN regions r
        ON r.id = p.region_id
      JOIN budget_ranges b
        ON b.id = p.budget_range_id
      JOIN themes t
        ON t.id = p.theme_id
    `;
    const { values, whereClause } = this.buildWhereClause(params);
    const countResult = await this.databaseService.query<PostCountRow>(
      `
        SELECT COUNT(*)::int AS total_count
        ${fromClause}
        ${whereClause}
      `,
      values,
    );

    const limitParamIndex = values.length + 1;
    const offsetParamIndex = values.length + 2;
    const offset = (params.page - 1) * params.limit;
    const rowsResult = await this.databaseService.query<PostRow>(
      `
        SELECT
          p.id,
          p.author_id,
          p.title,
          p.summary,
          p.content,
          p.image_url,
          r.code AS region_code,
          r.name AS region_name,
          b.code AS budget_code,
          b.label AS budget_label,
          t.code AS theme_code,
          t.name AS theme_name,
          p.season,
          p.companion,
          p.travel_date,
          p.tags,
          p.view_count,
          p.comment_count,
          p.created_at,
          p.updated_at,
          u.name AS author_name,
          u.nickname AS author_nickname,
          u.bio AS author_bio,
          u.location AS author_location
        ${fromClause}
        ${whereClause}
        ORDER BY ${this.getOrderByClause(params.sort)}
        LIMIT $${limitParamIndex}
        OFFSET $${offsetParamIndex}
      `,
      [...values, params.limit, offset],
    );

    return {
      totalCount: countResult.rows[0]?.total_count ?? 0,
      items: rowsResult.rows.map((row) => this.toPostListItem(row)),
    };
  }

  async findPostById(postId: number) {
    const result = await this.databaseService.query<PostRow>(
      `
        SELECT
          p.id,
          p.author_id,
          p.title,
          p.summary,
          p.content,
          p.image_url,
          r.code AS region_code,
          r.name AS region_name,
          b.code AS budget_code,
          b.label AS budget_label,
          t.code AS theme_code,
          t.name AS theme_name,
          p.season,
          p.companion,
          p.travel_date,
          p.tags,
          p.view_count,
          p.comment_count,
          p.created_at,
          p.updated_at,
          u.name AS author_name,
          u.nickname AS author_nickname,
          u.bio AS author_bio,
          u.location AS author_location
        FROM posts p
        JOIN users u
          ON u.id = p.author_id
        JOIN regions r
          ON r.id = p.region_id
        JOIN budget_ranges b
          ON b.id = p.budget_range_id
        JOIN themes t
          ON t.id = p.theme_id
        WHERE p.id = $1
      `,
      [postId],
    );

    if (!result.rowCount) {
      return null;
    }

    return this.toPostListItem(result.rows[0]);
  }

  async incrementViewCount(postId: number) {
    const result = await this.databaseService.query<{ view_count: number }>(
      `
        UPDATE posts
        SET view_count = view_count + 1
        WHERE id = $1
        RETURNING view_count
      `,
      [postId],
    );

    if (!result.rowCount) {
      return null;
    }

    return {
      postId,
      viewCount: result.rows[0].view_count,
    };
  }

  async resolvePostFiltersByCode(
    regionCode: string,
    budgetCode: string,
    themeCode: string,
  ) {
    const result = await this.databaseService.query<PostFilterRow>(
      `
        SELECT
          r.id AS region_id,
          r.code AS region_code,
          r.name AS region_name,
          b.id AS budget_range_id,
          b.code AS budget_code,
          b.label AS budget_label,
          t.id AS theme_id,
          t.code AS theme_code,
          t.name AS theme_name
        FROM regions r
        CROSS JOIN budget_ranges b
        CROSS JOIN themes t
        WHERE r.code = $1
          AND b.code = $2
          AND t.code = $3
        LIMIT 1
      `,
      [regionCode, budgetCode, themeCode],
    );

    if (!result.rowCount) {
      return null;
    }

    return result.rows[0];
  }

  async createPost(params: CreatePostParams) {
    const result = await this.databaseService.query<{ id: number }>(
      `
        INSERT INTO posts (
          author_id,
          title,
          summary,
          content,
          image_url,
          region_id,
          budget_range_id,
          theme_id,
          season,
          companion,
          travel_date,
          tags
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
        )
        RETURNING id
      `,
      [
        params.authorId,
        params.title,
        params.summary,
        params.content,
        params.imageUrl,
        params.regionId,
        params.budgetRangeId,
        params.themeId,
        params.season,
        params.companion,
        params.travelDate,
        params.tags,
      ],
    );

    return result.rows[0].id;
  }

  private buildWhereClause(params: FindPostsParams) {
    const clauses: string[] = [];
    const values: unknown[] = [];

    const appendClause = (sql: string, value: unknown) => {
      values.push(value);
      clauses.push(sql.replaceAll('?', `$${values.length}`));
    };

    if (params.q) {
      appendClause(
        `
          (
            p.title ILIKE '%' || ? || '%'
            OR COALESCE(p.summary, '') ILIKE '%' || ? || '%'
            OR COALESCE(p.content, '') ILIKE '%' || ? || '%'
            OR COALESCE(array_to_string(p.tags, ' '), '') ILIKE '%' || ? || '%'
            OR u.nickname ILIKE '%' || ? || '%'
            OR r.name ILIKE '%' || ? || '%'
            OR b.label ILIKE '%' || ? || '%'
            OR t.name ILIKE '%' || ? || '%'
          )
        `,
        params.q,
      );
    }

    if (params.regionCode) {
      appendClause('r.code = ?', params.regionCode);
    }

    if (params.budgetCode) {
      appendClause('b.code = ?', params.budgetCode);
    }

    if (params.themeCode) {
      appendClause('t.code = ?', params.themeCode);
    }

    if (params.season) {
      appendClause('p.season = ?', params.season);
    }

    if (params.companion) {
      appendClause('p.companion = ?', params.companion);
    }

    return {
      values,
      whereClause: clauses.length
        ? `WHERE ${clauses.join(' AND ')}`
        : '',
    };
  }

  private getOrderByClause(sort: PostSort) {
    if (sort === 'popular') {
      return 'p.view_count DESC, p.created_at DESC, p.id DESC';
    }

    if (sort === 'comments') {
      return 'p.comment_count DESC, p.created_at DESC, p.id DESC';
    }

    return 'p.created_at DESC, p.id DESC';
  }

  private toPostListItem(row: PostRow): PostListItem {
    return {
      id: row.id,
      title: row.title,
      summary: row.summary ?? '',
      content: row.content ?? '',
      region: row.region_name,
      regionCode: row.region_code,
      budget: row.budget_label,
      budgetCode: row.budget_code,
      theme: row.theme_name,
      themeCode: row.theme_code,
      season: row.season,
      companion: row.companion,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      travelDate: row.travel_date,
      views: row.view_count,
      discussionCount: row.comment_count,
      imageUrl: row.image_url ?? DEFAULT_POST_IMAGE_URL,
      tags: row.tags ?? [],
      authorId: row.author_id,
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
