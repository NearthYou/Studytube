import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { MemoryBoardRepository } from './memory-board.repository';
import {
  Comment,
  CreatePostInput,
  LearningPreferences,
  PaginatedPosts,
  Playlist,
  PlaylistFeedback,
  Session,
  StudyPost,
  UpdatePostInput,
  User,
} from './study-board.types';

type UserRow = {
  id: number;
  name: string;
  email: string;
  passwordHash: string;
  preferences: unknown;
  createdAt: Date | string;
};

type PostRow = {
  id: number;
  authorId: number;
  authorName: string;
  title: string;
  videoUrl: string;
  thumbnailUrl: string;
  channelName: string;
  summary: string;
  translatedNotes: string;
  createdAt: Date | string;
  updatedAt: Date | string;
};

@Injectable()
export class DatabaseService
  extends MemoryBoardRepository
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: Pool;
  private databaseAvailable = false;

  constructor(configService: ConfigService) {
    super();
    this.pool = new Pool({
      connectionString:
        configService.get<string>('DATABASE_URL') ??
        'postgresql://app:app@localhost:5432/app_dev',
      connectionTimeoutMillis: 3000,
    });
  }

  async onModuleInit() {
    try {
      await this.ensureSchema();
      await this.seedDatabase();
      this.databaseAvailable = true;
    } catch (error) {
      this.databaseAvailable = false;
      this.logger.warn(
        `PostgreSQL unavailable, using in-memory demo data: ${this.toErrorMessage(
          error,
        )}`,
      );
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  async health() {
    if (!this.databaseAvailable) {
      return {
        service: 'api',
        status: 'degraded',
        database: 'in-memory fallback',
        timestamp: new Date().toISOString(),
      };
    }

    try {
      const result = await this.pool.query<{ ok: number }>('SELECT 1 AS ok');

      return {
        service: 'api',
        status: result.rows[0]?.ok === 1 ? 'ok' : 'unknown',
        database: 'postgresql + pgvector',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.databaseAvailable = false;

      return {
        service: 'api',
        status: 'degraded',
        database: 'in-memory fallback',
        message: this.toErrorMessage(error),
      };
    }
  }

  override async createUser(input: {
    name: string;
    email: string;
    passwordHash: string;
  }): Promise<User> {
    if (!this.databaseAvailable) {
      return super.createUser(input);
    }

    try {
      const result = await this.pool.query<UserRow>(
        `
          INSERT INTO users (name, email, password_hash)
          VALUES ($1, $2, $3)
          RETURNING id, name, email, password_hash AS "passwordHash", preferences, created_at AS "createdAt"
        `,
        [input.name, input.email, input.passwordHash],
      );

      return this.publicUser(result.rows[0]);
    } catch (error) {
      this.fallback(error);
      return super.createUser(input);
    }
  }

  override async findUserByEmail(
    email: string,
  ): Promise<(User & { passwordHash: string }) | null> {
    if (!this.databaseAvailable) {
      return super.findUserByEmail(email);
    }

    try {
      const result = await this.pool.query<UserRow>(
        `
          SELECT id, name, email, password_hash AS "passwordHash",
                 preferences, created_at AS "createdAt"
          FROM users
          WHERE lower(email) = lower($1)
        `,
        [email],
      );

      return result.rows[0]
        ? {
            ...this.publicUser(result.rows[0]),
            passwordHash: result.rows[0].passwordHash,
          }
        : null;
    } catch (error) {
      this.fallback(error);
      return super.findUserByEmail(email);
    }
  }

  override async updateUser(
    id: number,
    input: {
      name?: string;
      passwordHash?: string;
      preferences?: LearningPreferences;
    },
  ): Promise<User | null> {
    if (!this.databaseAvailable) {
      return super.updateUser(id, input);
    }

    try {
      const result = await this.pool.query<UserRow>(
        `
          UPDATE users
          SET name = COALESCE($2, name),
              password_hash = COALESCE($3, password_hash),
              preferences = COALESCE($4::jsonb, preferences)
          WHERE id = $1
          RETURNING id, name, email, password_hash AS "passwordHash", preferences, created_at AS "createdAt"
        `,
        [
          id,
          input.name ?? null,
          input.passwordHash ?? null,
          input.preferences ? JSON.stringify(input.preferences) : null,
        ],
      );

      return result.rows[0] ? this.publicUser(result.rows[0]) : null;
    } catch (error) {
      this.fallback(error);
      return super.updateUser(id, input);
    }
  }

  override async createSession(
    userId: number,
    token: string,
  ): Promise<Session> {
    if (!this.databaseAvailable) {
      return super.createSession(userId, token);
    }

    try {
      await this.pool.query(
        `
          INSERT INTO sessions (token, user_id)
          VALUES ($1, $2)
        `,
        [token, userId],
      );

      const user = await this.findUserById(userId);

      if (!user) {
        throw new Error('User not found');
      }

      return { token, user };
    } catch (error) {
      this.fallback(error);
      return super.createSession(userId, token);
    }
  }

  override async findSession(token: string): Promise<Session | null> {
    if (!this.databaseAvailable) {
      return super.findSession(token);
    }

    try {
      const result = await this.pool.query<UserRow & { token: string }>(
        `
          SELECT s.token, u.id, u.name, u.email, u.password_hash AS "passwordHash",
                 u.preferences, u.created_at AS "createdAt"
          FROM sessions s
          JOIN users u ON u.id = s.user_id
          WHERE s.token = $1
        `,
        [token],
      );
      const row = result.rows[0];

      return row ? { token: row.token, user: this.publicUser(row) } : null;
    } catch (error) {
      this.fallback(error);
      return super.findSession(token);
    }
  }

  override async listPosts(input: {
    authorId?: number;
    search?: string;
    page: number;
    pageSize: number;
  }): Promise<PaginatedPosts> {
    if (!this.databaseAvailable) {
      return super.listPosts(input);
    }

    try {
      const search = input.search?.trim() || null;
      const offset = (input.page - 1) * input.pageSize;
      const authorId = input.authorId ?? null;
      const where = `
        ($1::integer IS NULL OR p.author_id = $1)
        AND ($2::text IS NULL
          OR p.title ILIKE '%' || $2 || '%'
          OR p.summary ILIKE '%' || $2 || '%'
          OR p.channel_name ILIKE '%' || $2 || '%'
          OR p.translated_notes ILIKE '%' || $2 || '%'
          OR EXISTS (
            SELECT 1 FROM post_tags pt
            JOIN tags t ON t.id = pt.tag_id
            WHERE pt.post_id = p.id AND t.name ILIKE '%' || $2 || '%'
          )
        )
      `;
      const [countResult, postsResult] = await Promise.all([
        this.pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM posts p WHERE ${where}`,
          [authorId, search],
        ),
        this.pool.query<PostRow>(
          `
            SELECT p.id, p.author_id AS "authorId", u.name AS "authorName",
                   p.title, p.video_url AS "videoUrl", p.thumbnail_url AS "thumbnailUrl",
                   p.channel_name AS "channelName", p.summary,
                   p.translated_notes AS "translatedNotes",
                   p.created_at AS "createdAt", p.updated_at AS "updatedAt"
            FROM posts p
            JOIN users u ON u.id = p.author_id
            WHERE ${where}
            ORDER BY p.updated_at DESC
            LIMIT $3 OFFSET $4
          `,
          [authorId, search, input.pageSize, offset],
        ),
      ]);
      const items = await Promise.all(
        postsResult.rows.map((row) => this.hydratePost(row)),
      );

      return {
        items,
        total: Number(countResult.rows[0]?.count ?? 0),
        page: input.page,
        pageSize: input.pageSize,
      };
    } catch (error) {
      this.fallback(error);
      return super.listPosts(input);
    }
  }

  override async findPost(id: number): Promise<StudyPost | null> {
    if (!this.databaseAvailable) {
      return super.findPost(id);
    }

    try {
      const result = await this.pool.query<PostRow>(
        `
          SELECT p.id, p.author_id AS "authorId", u.name AS "authorName",
                 p.title, p.video_url AS "videoUrl", p.thumbnail_url AS "thumbnailUrl",
                 p.channel_name AS "channelName", p.summary,
                 p.translated_notes AS "translatedNotes",
                 p.created_at AS "createdAt", p.updated_at AS "updatedAt"
          FROM posts p
          JOIN users u ON u.id = p.author_id
          WHERE p.id = $1
        `,
        [id],
      );

      return result.rows[0] ? this.hydratePost(result.rows[0]) : null;
    } catch (error) {
      this.fallback(error);
      return super.findPost(id);
    }
  }

  override async createPost(input: CreatePostInput): Promise<StudyPost> {
    if (!this.databaseAvailable) {
      return super.createPost(input);
    }

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const result = await client.query<PostRow>(
        `
          INSERT INTO posts (
            author_id, title, video_url, thumbnail_url, channel_name, summary, translated_notes
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id, author_id AS "authorId",
                    (SELECT name FROM users WHERE id = $1) AS "authorName",
                    title, video_url AS "videoUrl", thumbnail_url AS "thumbnailUrl",
                    channel_name AS "channelName", summary,
                    translated_notes AS "translatedNotes",
                    created_at AS "createdAt", updated_at AS "updatedAt"
        `,
        [
          input.authorId,
          input.title,
          input.videoUrl,
          input.thumbnailUrl ??
            'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
          input.channelName ?? 'Unknown channel',
          input.summary,
          input.translatedNotes,
        ],
      );
      const post = result.rows[0];
      await this.syncTags(client, post.id, input.tags);
      await this.upsertEmbedding(
        client,
        post.id,
        [
          input.title,
          input.summary,
          input.translatedNotes,
          input.tags.join(' '),
        ].join('\n'),
      );
      await client.query('COMMIT');

      return this.hydratePost(post);
    } catch (error) {
      await client.query('ROLLBACK');
      this.fallback(error);
      return super.createPost(input);
    } finally {
      client.release();
    }
  }

  override async updatePost(
    id: number,
    input: UpdatePostInput,
  ): Promise<StudyPost | null> {
    if (!this.databaseAvailable) {
      return super.updatePost(id, input);
    }

    const current = await this.findPost(id);

    if (!current) {
      return null;
    }

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const next = {
        title: input.title ?? current.title,
        videoUrl: input.videoUrl ?? current.videoUrl,
        thumbnailUrl: input.thumbnailUrl ?? current.thumbnailUrl,
        channelName: input.channelName ?? current.channelName,
        summary: input.summary ?? current.summary,
        translatedNotes: input.translatedNotes ?? current.translatedNotes,
        tags: input.tags ?? current.tags,
      };
      const result = await client.query<PostRow>(
        `
          UPDATE posts
          SET title = $2,
              video_url = $3,
              thumbnail_url = $4,
              channel_name = $5,
              summary = $6,
              translated_notes = $7,
              updated_at = now()
          WHERE id = $1
          RETURNING id, author_id AS "authorId",
                    (SELECT name FROM users WHERE id = author_id) AS "authorName",
                    title, video_url AS "videoUrl", thumbnail_url AS "thumbnailUrl",
                    channel_name AS "channelName", summary,
                    translated_notes AS "translatedNotes",
                    created_at AS "createdAt", updated_at AS "updatedAt"
        `,
        [
          id,
          next.title,
          next.videoUrl,
          next.thumbnailUrl,
          next.channelName,
          next.summary,
          next.translatedNotes,
        ],
      );
      await this.syncTags(client, id, next.tags);
      await this.upsertEmbedding(
        client,
        id,
        [
          next.title,
          next.summary,
          next.translatedNotes,
          next.tags.join(' '),
        ].join('\n'),
      );
      await client.query('COMMIT');

      return this.hydratePost(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      this.fallback(error);
      return super.updatePost(id, input);
    } finally {
      client.release();
    }
  }

  override async deletePost(id: number): Promise<boolean> {
    if (!this.databaseAvailable) {
      return super.deletePost(id);
    }

    try {
      const result = await this.pool.query('DELETE FROM posts WHERE id = $1', [
        id,
      ]);

      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      this.fallback(error);
      return super.deletePost(id);
    }
  }

  override async addComment(input: {
    postId: number;
    authorId: number;
    body: string;
  }): Promise<Comment> {
    if (!this.databaseAvailable) {
      return super.addComment(input);
    }

    try {
      const result = await this.pool.query<Comment>(
        `
          INSERT INTO comments (post_id, author_id, body)
          VALUES ($1, $2, $3)
          RETURNING id, post_id AS "postId", author_id AS "authorId",
                    (SELECT name FROM users WHERE id = $2) AS "authorName",
                    body, created_at AS "createdAt"
        `,
        [input.postId, input.authorId, input.body],
      );

      return this.normalizeComment(result.rows[0]);
    } catch (error) {
      this.fallback(error);
      return super.addComment(input);
    }
  }

  override async deleteComment(
    postId: number,
    commentId: number,
  ): Promise<boolean> {
    if (!this.databaseAvailable) {
      return super.deleteComment(postId, commentId);
    }

    try {
      const result = await this.pool.query(
        'DELETE FROM comments WHERE post_id = $1 AND id = $2',
        [postId, commentId],
      );

      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      this.fallback(error);
      return super.deleteComment(postId, commentId);
    }
  }

  override async listPlaylists(ownerId?: number): Promise<Playlist[]> {
    if (!this.databaseAvailable) {
      return super.listPlaylists(ownerId);
    }

    try {
      const result = await this.pool.query<{
        id: number;
        ownerId: number;
        title: string;
        description: string;
        createdAt: Date | string;
      }>(
        `
          SELECT id, owner_id AS "ownerId", title, description, created_at AS "createdAt"
          FROM playlists
          WHERE ($1::int IS NULL OR owner_id = $1)
          ORDER BY created_at DESC
        `,
        [ownerId ?? null],
      );

      return Promise.all(result.rows.map((row) => this.hydratePlaylist(row)));
    } catch (error) {
      this.fallback(error);
      return super.listPlaylists(ownerId);
    }
  }

  override async createPlaylist(input: {
    ownerId: number;
    title: string;
    description: string;
    postIds: number[];
  }): Promise<Playlist> {
    if (!this.databaseAvailable) {
      return super.createPlaylist(input);
    }

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const result = await client.query<{
        id: number;
        ownerId: number;
        title: string;
        description: string;
        createdAt: Date | string;
      }>(
        `
          INSERT INTO playlists (owner_id, title, description)
          VALUES ($1, $2, $3)
          RETURNING id, owner_id AS "ownerId", title, description, created_at AS "createdAt"
        `,
        [input.ownerId, input.title, input.description],
      );

      for (const postId of [...new Set(input.postIds)]) {
        await client.query(
          `
            INSERT INTO playlist_items (playlist_id, post_id)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
          `,
          [result.rows[0].id, postId],
        );
      }

      await client.query('COMMIT');

      return this.hydratePlaylist(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      this.fallback(error);
      return super.createPlaylist(input);
    } finally {
      client.release();
    }
  }

  override async addPlaylistItem(
    playlistId: number,
    postId: number,
  ): Promise<Playlist | null> {
    if (!this.databaseAvailable) {
      return super.addPlaylistItem(playlistId, postId);
    }

    try {
      await this.pool.query(
        `
          INSERT INTO playlist_items (playlist_id, post_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
        `,
        [playlistId, postId],
      );

      const playlists = await this.listPlaylists();

      return playlists.find((playlist) => playlist.id === playlistId) ?? null;
    } catch (error) {
      this.fallback(error);
      return super.addPlaylistItem(playlistId, postId);
    }
  }

  override async addPlaylistFeedback(input: {
    playlistId: number;
    authorId: number;
    rating: number;
    body: string;
  }): Promise<PlaylistFeedback> {
    if (!this.databaseAvailable) {
      return super.addPlaylistFeedback(input);
    }

    try {
      const result = await this.pool.query<PlaylistFeedback>(
        `
          INSERT INTO playlist_feedback (playlist_id, author_id, rating, body)
          VALUES ($1, $2, $3, $4)
          RETURNING id, playlist_id AS "playlistId", author_id AS "authorId",
                    rating, body, created_at AS "createdAt"
        `,
        [input.playlistId, input.authorId, input.rating, input.body],
      );

      return this.normalizeFeedback(result.rows[0]);
    } catch (error) {
      this.fallback(error);
      return super.addPlaylistFeedback(input);
    }
  }

  private async ensureSchema() {
    await this.pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        preferences JSONB NOT NULL DEFAULT '{"interests":["YouTube 학습","프론트엔드"],"pace":"하루 20분","goal":"짧은 영상으로 꾸준히 복습하기"}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS posts (
        id SERIAL PRIMARY KEY,
        author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        video_url TEXT NOT NULL,
        thumbnail_url TEXT NOT NULL,
        channel_name TEXT NOT NULL,
        summary TEXT NOT NULL,
        translated_notes TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS tags (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE
      );

      CREATE TABLE IF NOT EXISTS post_tags (
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (post_id, tag_id)
      );

      CREATE TABLE IF NOT EXISTS comments (
        id SERIAL PRIMARY KEY,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS playlists (
        id SERIAL PRIMARY KEY,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS playlist_items (
        playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (playlist_id, post_id)
      );

      CREATE TABLE IF NOT EXISTS playlist_feedback (
        id SERIAL PRIMARY KEY,
        playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
        body TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS post_embeddings (
        post_id INTEGER PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        embedding vector(64) NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await this.pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL
      DEFAULT '{"interests":["YouTube 학습","프론트엔드"],"pace":"하루 20분","goal":"짧은 영상으로 꾸준히 복습하기"}'::jsonb
    `);
  }

  private async seedDatabase() {
    const passwordHash = createHash('sha256').update('demo1234').digest('hex');
    await this.pool.query(
      `
        INSERT INTO users (id, name, email, password_hash)
        VALUES (1, 'Demo Learner', 'demo@studytube.local', $1)
        ON CONFLICT (id) DO NOTHING
      `,
      [passwordHash],
    );

    const seedPosts = await super.listPosts({ page: 1, pageSize: 24 });

    for (const post of seedPosts.items) {
      await this.pool.query(
        `
          INSERT INTO posts (
            id, author_id, title, video_url, thumbnail_url, channel_name, summary, translated_notes
          )
          VALUES ($1, 1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (id) DO NOTHING
        `,
        [
          post.id,
          post.title,
          post.videoUrl,
          post.thumbnailUrl,
          post.channelName,
          post.summary,
          post.translatedNotes,
        ],
      );

      const client = await this.pool.connect();
      try {
        await this.syncTags(client, post.id, post.tags);
        await this.upsertEmbedding(
          client,
          post.id,
          [
            post.title,
            post.summary,
            post.translatedNotes,
            post.tags.join(' '),
          ].join('\n'),
        );
      } finally {
        client.release();
      }
    }

    await this.pool.query(`
      INSERT INTO comments (id, post_id, author_id, body)
      VALUES (1, 1, 1, 'useEffect dependency 설명이 입문자에게 특히 좋아요.')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO playlists (id, owner_id, title, description)
      VALUES (1, 1, 'React 기초 복습 루트', 'React 훅과 서버 상태 관리를 차례대로 복습합니다.')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO playlist_items (playlist_id, post_id, position)
      VALUES (1, 1, 1), (1, 2, 2)
      ON CONFLICT DO NOTHING;

      SELECT setval(pg_get_serial_sequence('users', 'id'), COALESCE((SELECT MAX(id) FROM users), 1));
      SELECT setval(pg_get_serial_sequence('posts', 'id'), COALESCE((SELECT MAX(id) FROM posts), 1));
      SELECT setval(pg_get_serial_sequence('comments', 'id'), COALESCE((SELECT MAX(id) FROM comments), 1));
      SELECT setval(pg_get_serial_sequence('playlists', 'id'), COALESCE((SELECT MAX(id) FROM playlists), 1));
      SELECT setval(pg_get_serial_sequence('playlist_feedback', 'id'), COALESCE((SELECT MAX(id) FROM playlist_feedback), 1));
    `);
  }

  private async findUserById(id: number): Promise<User | null> {
    const result = await this.pool.query<UserRow>(
      `
        SELECT id, name, email, password_hash AS "passwordHash", preferences, created_at AS "createdAt"
        FROM users
        WHERE id = $1
      `,
      [id],
    );

    return result.rows[0] ? this.publicUser(result.rows[0]) : null;
  }

  private async hydratePost(row: PostRow): Promise<StudyPost> {
    const [tags, comments] = await Promise.all([
      this.pool.query<{ name: string }>(
        `
          SELECT t.name
          FROM tags t
          JOIN post_tags pt ON pt.tag_id = t.id
          WHERE pt.post_id = $1
          ORDER BY t.name
        `,
        [row.id],
      ),
      this.pool.query<Comment>(
        `
          SELECT c.id, c.post_id AS "postId", c.author_id AS "authorId",
                 u.name AS "authorName", c.body, c.created_at AS "createdAt"
          FROM comments c
          JOIN users u ON u.id = c.author_id
          WHERE c.post_id = $1
          ORDER BY c.created_at ASC
        `,
        [row.id],
      ),
    ]);

    return {
      id: row.id,
      authorId: row.authorId,
      authorName: row.authorName,
      title: row.title,
      videoUrl: row.videoUrl,
      thumbnailUrl: row.thumbnailUrl,
      channelName: row.channelName,
      summary: row.summary,
      translatedNotes: row.translatedNotes,
      tags: tags.rows.map((tag) => tag.name),
      comments: comments.rows.map((comment) => this.normalizeComment(comment)),
      createdAt: this.iso(row.createdAt),
      updatedAt: this.iso(row.updatedAt),
    };
  }

  private async hydratePlaylist(row: {
    id: number;
    ownerId: number;
    title: string;
    description: string;
    createdAt: Date | string;
  }): Promise<Playlist> {
    const [items, feedback] = await Promise.all([
      this.pool.query<{ postId: number }>(
        `
          SELECT post_id AS "postId"
          FROM playlist_items
          WHERE playlist_id = $1
          ORDER BY position ASC, post_id ASC
        `,
        [row.id],
      ),
      this.pool.query<PlaylistFeedback>(
        `
          SELECT id, playlist_id AS "playlistId", author_id AS "authorId",
                 rating, body, created_at AS "createdAt"
          FROM playlist_feedback
          WHERE playlist_id = $1
          ORDER BY created_at DESC
        `,
        [row.id],
      ),
    ]);

    return {
      id: row.id,
      ownerId: row.ownerId,
      title: row.title,
      description: row.description,
      postIds: items.rows.map((item) => item.postId),
      feedback: feedback.rows.map((item) => this.normalizeFeedback(item)),
      createdAt: this.iso(row.createdAt),
    };
  }

  private async syncTags(
    client: PoolClient,
    postId: number,
    tags: string[],
  ): Promise<void> {
    const normalized = [
      ...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)),
    ];
    await client.query('DELETE FROM post_tags WHERE post_id = $1', [postId]);

    for (const tag of normalized) {
      const tagResult = await client.query<{ id: number }>(
        `
          INSERT INTO tags (name)
          VALUES ($1)
          ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
          RETURNING id
        `,
        [tag],
      );
      await client.query(
        `
          INSERT INTO post_tags (post_id, tag_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
        `,
        [postId, tagResult.rows[0].id],
      );
    }
  }

  private async upsertEmbedding(
    client: PoolClient,
    postId: number,
    content: string,
  ): Promise<void> {
    await client.query(
      `
        INSERT INTO post_embeddings (post_id, content, embedding)
        VALUES ($1, $2, $3::vector)
        ON CONFLICT (post_id)
        DO UPDATE SET content = EXCLUDED.content,
                      embedding = EXCLUDED.embedding,
                      updated_at = now()
      `,
      [postId, content, this.vectorLiteral(content)],
    );
  }

  private vectorLiteral(content: string): string {
    const digest = createHash('sha256').update(content).digest();
    const values = Array.from({ length: 64 }, (_, index) => {
      const byte = digest[index % digest.length];
      return ((byte / 255) * 2 - 1).toFixed(5);
    });

    return `[${values.join(',')}]`;
  }

  private publicUser(row: UserRow): User {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      preferences: this.normalizePreferences(row.preferences),
      createdAt: this.iso(row.createdAt),
    };
  }

  private normalizePreferences(value: unknown): LearningPreferences {
    const fallback: LearningPreferences = {
      interests: ['YouTube 학습', '프론트엔드'],
      pace: '하루 20분',
      goal: '짧은 영상으로 꾸준히 복습하기',
    };

    if (!value || typeof value !== 'object') {
      return fallback;
    }

    const candidate = value as Partial<LearningPreferences>;

    return {
      interests: Array.isArray(candidate.interests)
        ? candidate.interests
            .filter((item): item is string => typeof item === 'string')
            .slice(0, 8)
        : fallback.interests,
      pace: typeof candidate.pace === 'string' ? candidate.pace : fallback.pace,
      goal: typeof candidate.goal === 'string' ? candidate.goal : fallback.goal,
    };
  }

  private normalizeComment(comment: Comment): Comment {
    return {
      ...comment,
      createdAt: this.iso(comment.createdAt),
    };
  }

  private normalizeFeedback(feedback: PlaylistFeedback): PlaylistFeedback {
    return {
      ...feedback,
      createdAt: this.iso(feedback.createdAt),
    };
  }

  private iso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : value;
  }

  private fallback(error: unknown) {
    this.databaseAvailable = false;
    this.logger.warn(
      `Database operation failed, switching to in-memory fallback: ${this.toErrorMessage(
        error,
      )}`,
    );
  }

  private toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
  }
}
