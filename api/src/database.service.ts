import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { Pool, PoolClient } from 'pg';
import {
  DEFAULT_LEARNING_PREFERENCES,
  iso,
  normalizeComment,
  normalizeFeedback,
  normalizeTagNames,
  publicUser,
  vectorLiteral,
  type PostRow,
  type UserRow,
} from './database-board.mapper';
import {
  MemoryBoardRepository,
  type MemoryBoardState,
} from './memory-board.repository';
import {
  Comment,
  CreatePostInput,
  LearningPreferences,
  PaginatedPosts,
  Playlist,
  PlaylistFeedback,
  Session,
  StudyPost,
  UpdatePlaylistInput,
  UpdatePostInput,
  User,
} from './study-board.types';

@Injectable()
export class DatabaseService
  extends MemoryBoardRepository
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: Pool;
  private readonly fallbackDataPath: string;
  private readonly databaseInitAttempts: number;
  private readonly databaseInitRetryDelayMs: number;
  private databaseAvailable = false;

  constructor(configService: ConfigService) {
    super();
    this.fallbackDataPath = resolve(
      configService.get<string>('BOARD_FALLBACK_DATA_PATH') ??
        this.defaultFallbackDataPath(),
    );
    this.databaseInitAttempts = this.positiveInteger(
      configService.get<string>('DB_INIT_ATTEMPTS'),
      15,
    );
    this.databaseInitRetryDelayMs = this.nonNegativeInteger(
      configService.get<string>('DB_INIT_RETRY_DELAY_MS'),
      1000,
    );
    this.pool = new Pool({
      connectionString:
        configService.get<string>('DATABASE_URL') ??
        'postgresql://app:app@localhost:5432/app_dev',
      connectionTimeoutMillis: 3000,
    });
  }

  async onModuleInit() {
    try {
      await this.initializeDatabaseWithRetry();
    } catch (error) {
      this.databaseAvailable = false;
      await this.loadFallbackState();
      this.logger.warn(
        `PostgreSQL unavailable, using file-backed fallback data: ${this.toErrorMessage(
          error,
        )}`,
      );
    }
  }

  private async initializeDatabaseWithRetry() {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.databaseInitAttempts; attempt += 1) {
      try {
        await this.ensureSchema();
        await this.seedDatabase();
        this.databaseAvailable = true;
        return;
      } catch (error) {
        lastError = error;

        if (attempt >= this.databaseInitAttempts) {
          break;
        }

        this.logger.warn(
          `PostgreSQL not ready, retrying database initialization (${attempt}/${this.databaseInitAttempts}): ${this.toErrorMessage(
            error,
          )}`,
        );
        await this.wait(this.databaseInitRetryDelayMs);
      }
    }

    throw lastError;
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  async health() {
    if (!this.databaseAvailable) {
      return {
        service: 'api',
        status: 'degraded',
        database: 'file-backed fallback',
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
        database: 'file-backed fallback',
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

      return publicUser(result.rows[0]);
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
            ...publicUser(result.rows[0]),
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

      return result.rows[0] ? publicUser(result.rows[0]) : null;
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

      return row ? { token: row.token, user: publicUser(row) } : null;
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

      return normalizeComment(result.rows[0]);
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

  override async updatePlaylist(
    id: number,
    input: UpdatePlaylistInput,
  ): Promise<Playlist | null> {
    if (!this.databaseAvailable) {
      return super.updatePlaylist(id, input);
    }

    const current = (await this.listPlaylists()).find(
      (playlist) => playlist.id === id,
    );

    if (!current) {
      return null;
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
          UPDATE playlists
          SET title = $2,
              description = $3
          WHERE id = $1
          RETURNING id, owner_id AS "ownerId", title, description, created_at AS "createdAt"
        `,
        [
          id,
          input.title ?? current.title,
          input.description ?? current.description,
        ],
      );

      if (input.postIds !== undefined) {
        await client.query(
          'DELETE FROM playlist_items WHERE playlist_id = $1',
          [id],
        );

        for (const [index, postId] of [...new Set(input.postIds)].entries()) {
          await client.query(
            `
              INSERT INTO playlist_items (playlist_id, post_id, position)
              VALUES ($1, $2, $3)
              ON CONFLICT (playlist_id, post_id) DO UPDATE
              SET position = EXCLUDED.position
            `,
            [id, postId, index + 1],
          );
        }
      }

      await client.query('COMMIT');

      return this.hydratePlaylist(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      this.fallback(error);
      return super.updatePlaylist(id, input);
    } finally {
      client.release();
    }
  }

  override async deletePlaylist(id: number): Promise<boolean> {
    if (!this.databaseAvailable) {
      return super.deletePlaylist(id);
    }

    try {
      const result = await this.pool.query(
        'DELETE FROM playlists WHERE id = $1',
        [id],
      );

      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      this.fallback(error);
      return super.deletePlaylist(id);
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
          WITH inserted AS (
            INSERT INTO playlist_feedback (playlist_id, author_id, rating, body)
            VALUES ($1, $2, $3, $4)
            RETURNING id, playlist_id, author_id, rating, body, created_at
          )
          SELECT inserted.id,
                 inserted.playlist_id AS "playlistId",
                 inserted.author_id AS "authorId",
                 users.name AS "authorName",
                 inserted.rating,
                 inserted.body,
                 inserted.created_at AS "createdAt"
          FROM inserted
          JOIN users ON users.id = inserted.author_id
        `,
        [input.playlistId, input.authorId, input.rating, input.body],
      );

      return normalizeFeedback(result.rows[0]);
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
        preferences JSONB NOT NULL DEFAULT '{"interests":["YouTube ?숈뒿","?꾨줎?몄뿏??],"pace":"?섎（ 20遺?,"goal":"吏㏃? ?곸긽?쇰줈 袁몄???蹂듭뒿?섍린"}'::jsonb,
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
    const defaultPreferences = JSON.stringify(
      DEFAULT_LEARNING_PREFERENCES,
    ).replace(/'/g, "''");

    await this.pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL
      DEFAULT '${defaultPreferences}'::jsonb
    `);
  }

  private async seedDatabase() {
    for (const user of this.users) {
      await this.pool.query(
        `
          INSERT INTO users (id, name, email, password_hash, preferences)
          VALUES ($1, $2, $3, $4, $5::jsonb)
          ON CONFLICT (id) DO UPDATE
          SET name = EXCLUDED.name,
              email = EXCLUDED.email,
              password_hash = EXCLUDED.password_hash,
              preferences = EXCLUDED.preferences
        `,
        [
          user.id,
          user.name,
          user.email,
          user.passwordHash,
          JSON.stringify(user.preferences),
        ],
      );
    }

    const seedPosts = await super.listPosts({ page: 1, pageSize: 200 });
    const seedPostUrls = new Map(
      seedPosts.items.map((post) => [post.id, post.videoUrl]),
    );

    for (const post of seedPosts.items) {
      const seedPostResult = await this.pool.query<{ id: number }>(
        `
          INSERT INTO posts (
            id, author_id, title, video_url, thumbnail_url, channel_name, summary, translated_notes
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (id) DO UPDATE
          SET title = EXCLUDED.title,
              author_id = EXCLUDED.author_id,
              thumbnail_url = EXCLUDED.thumbnail_url,
              channel_name = EXCLUDED.channel_name,
              summary = EXCLUDED.summary,
              translated_notes = EXCLUDED.translated_notes,
              updated_at = now()
          WHERE posts.video_url = EXCLUDED.video_url
          RETURNING id
        `,
        [
          post.id,
          post.authorId,
          post.title,
          post.videoUrl,
          post.thumbnailUrl,
          post.channelName,
          post.summary,
          post.translatedNotes,
        ],
      );

      if (seedPostResult.rowCount === 0) {
        continue;
      }

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

    const migratedRandomSeedUrls = seedPosts.items
      .filter((post) => post.id >= 101)
      .map((post) => post.videoUrl);

    if (migratedRandomSeedUrls.length > 0) {
      await this.pool.query(
        `
          DELETE FROM posts
          WHERE author_id = 1
            AND id < 101
            AND video_url = ANY($1::text[])
        `,
        [migratedRandomSeedUrls],
      );
    }

    await this.pool.query(`
      INSERT INTO comments (id, post_id, author_id, body)
      VALUES (1, 1, 1, 'useEffect dependency 설명이 입문자에게 특히 좋아요.')
      ON CONFLICT (id) DO UPDATE
      SET post_id = EXCLUDED.post_id,
          author_id = EXCLUDED.author_id,
          body = EXCLUDED.body;

      SELECT setval(pg_get_serial_sequence('users', 'id'), COALESCE((SELECT MAX(id) FROM users), 1));
      SELECT setval(pg_get_serial_sequence('posts', 'id'), COALESCE((SELECT MAX(id) FROM posts), 1));
      SELECT setval(pg_get_serial_sequence('comments', 'id'), COALESCE((SELECT MAX(id) FROM comments), 1));
      SELECT setval(pg_get_serial_sequence('playlists', 'id'), COALESCE((SELECT MAX(id) FROM playlists), 1));
      SELECT setval(pg_get_serial_sequence('playlist_feedback', 'id'), COALESCE((SELECT MAX(id) FROM playlist_feedback), 1));
    `);

    const seedPlaylists = await super.listPlaylists();

    for (const playlist of seedPlaylists) {
      await this.pool.query(
        `
          INSERT INTO playlists (id, owner_id, title, description)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (id) DO UPDATE
          SET owner_id = EXCLUDED.owner_id,
              title = EXCLUDED.title,
              description = EXCLUDED.description
        `,
        [playlist.id, playlist.ownerId, playlist.title, playlist.description],
      );
      await this.pool.query(
        'DELETE FROM playlist_items WHERE playlist_id = $1',
        [playlist.id],
      );

      for (const [index, postId] of playlist.postIds.entries()) {
        const seedPostUrl = seedPostUrls.get(postId);

        if (!seedPostUrl) {
          continue;
        }

        await this.pool.query(
          `
            INSERT INTO playlist_items (playlist_id, post_id, position)
            SELECT $1, p.id, $3
            FROM posts p
            WHERE p.id = $2 AND p.video_url = $4
            ON CONFLICT (playlist_id, post_id) DO UPDATE
            SET position = EXCLUDED.position
          `,
          [playlist.id, postId, index + 1, seedPostUrl],
        );
      }
    }

    await this.pool.query(`
      SELECT setval(pg_get_serial_sequence('playlists', 'id'), COALESCE((SELECT MAX(id) FROM playlists), 1));
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

    return result.rows[0] ? publicUser(result.rows[0]) : null;
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
      comments: comments.rows.map((comment) => normalizeComment(comment)),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
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
          SELECT pf.id,
                 pf.playlist_id AS "playlistId",
                 pf.author_id AS "authorId",
                 u.name AS "authorName",
                 pf.rating,
                 pf.body,
                 pf.created_at AS "createdAt"
          FROM playlist_feedback pf
          JOIN users u ON u.id = pf.author_id
          WHERE pf.playlist_id = $1
          ORDER BY pf.created_at DESC
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
      feedback: feedback.rows.map((item) => normalizeFeedback(item)),
      createdAt: iso(row.createdAt),
    };
  }

  private async syncTags(
    client: PoolClient,
    postId: number,
    tags: string[],
  ): Promise<void> {
    const normalized = normalizeTagNames(tags);
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
      [postId, content, vectorLiteral(content)],
    );
  }

  private fallback(error: unknown) {
    this.databaseAvailable = false;
    this.logger.warn(
      `Database operation failed, switching to file-backed fallback: ${this.toErrorMessage(
        error,
      )}`,
    );
  }

  protected async loadFallbackState() {
    try {
      const raw = await readFile(this.fallbackDataPath, 'utf8');
      this.restoreState(JSON.parse(raw) as MemoryBoardState);
    } catch (error) {
      if (this.isMissingFallbackFile(error)) {
        await this.persistState();
        return;
      }

      this.logger.warn(
        `Could not load fallback data file, using demo seed data: ${this.toErrorMessage(
          error,
        )}`,
      );
    }
  }

  protected override async persistState() {
    if (this.databaseAvailable) {
      return;
    }

    try {
      await mkdir(dirname(this.fallbackDataPath), { recursive: true });
      const temporaryPath = `${this.fallbackDataPath}.tmp`;
      await writeFile(
        temporaryPath,
        JSON.stringify(this.snapshotState(), null, 2),
        'utf8',
      );
      await rename(temporaryPath, this.fallbackDataPath);
    } catch (error) {
      this.logger.warn(
        `Could not persist fallback data file: ${this.toErrorMessage(error)}`,
      );
    }
  }

  private isMissingFallbackFile(error: unknown) {
    return (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    );
  }

  private defaultFallbackDataPath() {
    return basename(process.cwd()).toLowerCase() === 'api'
      ? '.data/board-fallback.json'
      : 'api/.data/board-fallback.json';
  }

  private positiveInteger(value: string | undefined, fallback: number) {
    const parsed = Number(value);

    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  private nonNegativeInteger(value: string | undefined, fallback: number) {
    const parsed = Number(value);

    return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
  }

  private wait(milliseconds: number) {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  }

  private toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
  }
}
