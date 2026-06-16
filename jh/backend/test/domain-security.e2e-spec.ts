import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { Client } from 'pg';
import { readFileSync, type Dirent } from 'node:fs';
import { access, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import type { Response as SupertestResponse } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ApiResponseInterceptor } from '../src/common/interceptors/api-response.interceptor';
import { toUploadLocalPath } from '../src/common/upload/upload-paths';
import { runSqlMigrations } from '../src/database/run-sql-migrations';

interface SeededUser {
  email: string;
  id: string;
  nickname: string;
}

interface SeededPost {
  content: string;
  id: string;
  title: string;
  userId: string;
}

interface SeededComment {
  content: string;
  id: string;
  postId: string;
  userId: string;
}

type ApiBody = Record<string, unknown>;

describe('Domain security with database (e2e)', () => {
  let app: INestApplication<App>;
  let baseDatabaseUrl: string;
  let categoryId: string;
  let database: Client;
  let jwtService: JwtService;
  let owner: SeededUser;
  let otherUser: SeededUser;
  let previousDatabaseUrl: string | undefined;
  let previousJwtExpiresInSeconds: string | undefined;
  let previousJwtSecret: string | undefined;
  let schemaName: string;

  beforeAll(async () => {
    previousDatabaseUrl = process.env.DATABASE_URL;
    previousJwtExpiresInSeconds = process.env.JWT_EXPIRES_IN_SECONDS;
    previousJwtSecret = process.env.JWT_SECRET;

    baseDatabaseUrl = getDatabaseUrl();
    schemaName = `e2e_domain_${Date.now()}`;
    await createSchema(baseDatabaseUrl, schemaName);

    process.env.DATABASE_URL = withSearchPath(baseDatabaseUrl, schemaName);
    process.env.JWT_SECRET = 'domain-e2e-jwt-secret';
    process.env.JWT_EXPIRES_IN_SECONDS = '3600';
    process.env.NODE_ENV = 'test';
    process.env.POST_IMAGE_ORPHAN_CLEANUP_INTERVAL_MINUTES = '1440';

    await runSqlMigrations();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
      }),
    );
    await app.init();

    jwtService = app.get(JwtService);
    database = new Client({
      connectionString: process.env.DATABASE_URL,
    });
    await database.connect();
    owner = await seedUser('owner@example.test', '소유자');
    otherUser = await seedUser('other@example.test', '다른사용자');
    categoryId = await getFirstCategoryId();
  });

  afterAll(async () => {
    await database?.end().catch(() => undefined);
    await app?.close();
    await dropSchema(baseDatabaseUrl, schemaName);

    restoreEnv('DATABASE_URL', previousDatabaseUrl);
    restoreEnv('JWT_EXPIRES_IN_SECONDS', previousJwtExpiresInSeconds);
    restoreEnv('JWT_SECRET', previousJwtSecret);
  });

  it('blocks non-owners from updating or deleting posts', async () => {
    const post = await seedPost(owner.id, {
      content: 'original content',
      title: 'original title',
    });

    await request(app.getHttpServer())
      .patch(`/api/posts/${post.id}`)
      .set('Authorization', await bearerToken(otherUser))
      .send({ title: 'hacked title' })
      .expect(403);

    await expectPostRow(post.id, {
      content: 'original content',
      title: 'original title',
    });

    await request(app.getHttpServer())
      .delete(`/api/posts/${post.id}`)
      .set('Authorization', await bearerToken(otherUser))
      .expect(403);

    await expectRowCount('posts', 'post_id', post.id, 1);
  });

  it('blocks non-owners from updating or deleting comments', async () => {
    const post = await seedPost(owner.id, {
      content: 'comment target',
      title: 'comment target',
    });
    const comment = await seedComment(post.id, owner.id, 'original comment');

    await request(app.getHttpServer())
      .patch(`/api/comments/${comment.id}`)
      .set('Authorization', await bearerToken(otherUser))
      .send({ content: 'hacked comment' })
      .expect(403);

    await expectCommentRow(comment.id, 'original comment');

    await request(app.getHttpServer())
      .delete(`/api/comments/${comment.id}`)
      .set('Authorization', await bearerToken(otherUser))
      .expect(403);

    await expectRowCount('comments', 'comment_id', comment.id, 1);
  });

  it('blocks attaching another user image to a new post', async () => {
    const imageId = await seedPostImage(owner.id, 'owner-image.webp');

    await request(app.getHttpServer())
      .post('/api/posts')
      .set('Authorization', await bearerToken(otherUser))
      .send({
        categoryIds: [categoryId],
        content: 'attempted image takeover',
        imageIds: [imageId],
        title: 'attempted image takeover',
      })
      .expect(403);

    const image = await database.query<{ post_id: string | null }>(
      'SELECT post_id::text FROM post_images WHERE image_id = $1',
      [imageId],
    );
    const createdPost = await database.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM posts WHERE title = $1',
      ['attempted image takeover'],
    );

    expect(image.rows[0].post_id).toBeNull();
    expect(createdPost.rows[0].count).toBe(0);
  });

  it('rejects spoofed post image bytes without persisting files or rows', async () => {
    const uploadFilesBefore = await listPostUploadFiles();
    const postImageRowsBefore = await countRows('post_images');

    await request(app.getHttpServer())
      .post('/api/posts/images')
      .set('Authorization', await bearerToken(owner))
      .attach('images', Buffer.from('<html></html>'), {
        contentType: 'image/png',
        filename: 'spoofed.png',
      })
      .expect(400);

    expect(await countRows('post_images')).toBe(postImageRowsBefore);
    expect(await listPostUploadFiles()).toEqual(uploadFilesBefore);
  });

  it('normalizes valid post image uploads to canonical webp files', async () => {
    const imageBuffer = await sharp({
      create: {
        background: '#0ea5e9',
        channels: 3,
        height: 900,
        width: 1200,
      },
    })
      .png()
      .toBuffer();
    const authorization = await bearerToken(owner);
    const response = await request(app.getHttpServer())
      .post('/api/posts/images')
      .set('Authorization', authorization)
      .attach('images', imageBuffer, {
        contentType: 'image/png',
        filename: 'upload.png',
      })
      .expect(201);
    const image = getSingleImage(getData(response));
    const imageId = String(image.id);
    const imageUrl = String(image.url);

    expect(imageUrl).toMatch(/^\/uploads\/posts\/[0-9a-f-]+\.webp$/);
    expect(image.originalUrl).toBe(imageUrl);
    expect(image.mimeType).toBe('image/webp');

    const metadata = await sharp(toLocalPublicPath(imageUrl)).metadata();

    expect(metadata.format).toBe('webp');
    expect(metadata.width).toBe(1200);
    expect(metadata.height).toBe(900);

    await request(app.getHttpServer())
      .delete(`/api/posts/images/${imageId}`)
      .set('Authorization', authorization)
      .expect(200);

    await expectRowCount('post_images', 'image_id', imageId, 0);
    await expectPublicPathMissing(imageUrl);
  });

  it('keeps post likes idempotent', async () => {
    const post = await seedPost(owner.id, {
      content: 'like target',
      title: 'like target',
    });
    const authorization = await bearerToken(otherUser);

    await request(app.getHttpServer())
      .post(`/api/posts/${post.id}/likes`)
      .set('Authorization', authorization)
      .expect(201)
      .expect((response) => {
        const data = getData(response);

        expect(data.likeCount).toBe(1);
        expect(data.likedByMe).toBe(true);
      });

    await request(app.getHttpServer())
      .post(`/api/posts/${post.id}/likes`)
      .set('Authorization', authorization)
      .expect(201)
      .expect((response) => {
        const data = getData(response);

        expect(data.likeCount).toBe(1);
        expect(data.likedByMe).toBe(true);
      });

    await expectRowCount('post_likes', 'post_id', post.id, 1);

    await request(app.getHttpServer())
      .delete(`/api/posts/${post.id}/likes`)
      .set('Authorization', authorization)
      .expect(200)
      .expect((response) => {
        const data = getData(response);

        expect(data.likeCount).toBe(0);
        expect(data.likedByMe).toBe(false);
      });

    await request(app.getHttpServer())
      .delete(`/api/posts/${post.id}/likes`)
      .set('Authorization', authorization)
      .expect(200)
      .expect((response) => {
        const data = getData(response);

        expect(data.likeCount).toBe(0);
        expect(data.likedByMe).toBe(false);
      });

    await expectRowCount('post_likes', 'post_id', post.id, 0);

    await request(app.getHttpServer())
      .post('/api/posts/999999999999/likes')
      .set('Authorization', authorization)
      .expect(404);
  });

  it('returns persisted comment pagination without duplicates', async () => {
    const post = await seedPost(owner.id, {
      content: 'pagination target',
      title: 'pagination target',
    });
    const seededCommentIds: string[] = [];

    for (let index = 1; index <= 21; index += 1) {
      const comment = await seedComment(
        post.id,
        owner.id,
        `page comment ${index.toString().padStart(2, '0')}`,
        index,
      );

      seededCommentIds.push(comment.id);
    }

    const firstPage = await request(app.getHttpServer())
      .get(`/api/posts/${post.id}/comments?page=1&limit=20`)
      .expect(200);
    const firstPageData = getData(firstPage);
    const firstPageItems = getItems(firstPageData);

    expect(firstPageItems).toHaveLength(20);
    expect(firstPageData.totalCount).toBe(21);
    expect(firstPageData.totalPages).toBe(2);

    const secondPage = await request(app.getHttpServer())
      .get(`/api/posts/${post.id}/comments?page=2&limit=20`)
      .expect(200);
    const secondPageData = getData(secondPage);
    const secondPageItems = getItems(secondPageData);
    const responseIds = [...firstPageItems, ...secondPageItems].map((item) =>
      String(item.id),
    );

    expect(secondPageItems).toHaveLength(1);
    expect(new Set(responseIds).size).toBe(21);
    expect(responseIds).toEqual(seededCommentIds);
  });

  async function seedUser(
    email: string,
    nickname: string,
  ): Promise<SeededUser> {
    const result = await database.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, nickname)
       VALUES ($1, $2, $3)
       RETURNING user_id::text AS id`,
      [email, 'test-password-hash', nickname],
    );

    return {
      email,
      id: result.rows[0].id,
      nickname,
    };
  }

  async function seedPost(
    userId: string,
    post: Pick<SeededPost, 'content' | 'title'>,
  ): Promise<SeededPost> {
    const result = await database.query<{
      content: string;
      id: string;
      title: string;
      user_id: string;
    }>(
      `INSERT INTO posts (user_id, title, content)
       VALUES ($1, $2, $3)
       RETURNING post_id::text AS id, user_id::text, title, content`,
      [userId, post.title, post.content],
    );

    return {
      content: result.rows[0].content,
      id: result.rows[0].id,
      title: result.rows[0].title,
      userId: result.rows[0].user_id,
    };
  }

  async function seedComment(
    postId: string,
    userId: string,
    content: string,
    secondsOffset = 0,
  ): Promise<SeededComment> {
    const result = await database.query<{
      content: string;
      id: string;
      post_id: string;
      user_id: string;
    }>(
      `INSERT INTO comments (post_id, user_id, content, created_at)
       VALUES ($1, $2, $3, now() + ($4::int * interval '1 second'))
       RETURNING comment_id::text AS id, post_id::text, user_id::text, content`,
      [postId, userId, content, secondsOffset],
    );

    return {
      content: result.rows[0].content,
      id: result.rows[0].id,
      postId: result.rows[0].post_id,
      userId: result.rows[0].user_id,
    };
  }

  async function seedPostImage(userId: string, filename: string) {
    const result = await database.query<{ id: string }>(
      `INSERT INTO post_images
         (user_id, original_filename, stored_filename, file_path, file_size, mime_type)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING image_id::text AS id`,
      [
        userId,
        filename,
        `stored-${filename}`,
        `/uploads/posts/stored-${filename}`,
        128,
        'image/webp',
      ],
    );

    return result.rows[0].id;
  }

  async function getFirstCategoryId() {
    const result = await database.query<{ id: string }>(
      `SELECT category_id::text AS id
       FROM categories
       ORDER BY category_id ASC
       LIMIT 1`,
    );

    return result.rows[0].id;
  }

  async function bearerToken(user: SeededUser) {
    const token = await jwtService.signAsync({
      email: user.email,
      nickname: user.nickname,
      profileImageUrl: null,
      sub: user.id,
    });

    return `Bearer ${token}`;
  }

  async function expectPostRow(
    postId: string,
    expected: Pick<SeededPost, 'content' | 'title'>,
  ) {
    const result = await database.query<{ content: string; title: string }>(
      'SELECT title, content FROM posts WHERE post_id = $1',
      [postId],
    );

    expect(result.rows[0]).toEqual(expected);
  }

  async function expectCommentRow(commentId: string, expectedContent: string) {
    const result = await database.query<{ content: string }>(
      'SELECT content FROM comments WHERE comment_id = $1',
      [commentId],
    );

    expect(result.rows[0].content).toBe(expectedContent);
  }

  async function expectRowCount(
    tableName: 'comments' | 'post_images' | 'post_likes' | 'posts',
    idColumn: 'comment_id' | 'image_id' | 'post_id',
    id: string,
    expectedCount: number,
  ) {
    const result = await database.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM ${tableName} WHERE ${idColumn} = $1`,
      [id],
    );

    expect(result.rows[0].count).toBe(expectedCount);
  }

  async function countRows(
    tableName: 'comment_likes' | 'comments' | 'post_images' | 'post_likes',
  ) {
    const result = await database.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM ${tableName}`,
    );

    return result.rows[0].count;
  }
});

function getData(response: SupertestResponse): ApiBody {
  const body = response.body as ApiBody;

  expect(body.success).toBe(true);
  expect(body.data).toEqual(expect.any(Object));

  return body.data as ApiBody;
}

function getSingleImage(data: ApiBody): ApiBody {
  const images = data.images;

  expect(Array.isArray(images)).toBe(true);
  expect(images).toHaveLength(1);

  return images[0] as ApiBody;
}

function getItems(data: ApiBody): ApiBody[] {
  const items = data.items;

  expect(Array.isArray(items)).toBe(true);

  return items as ApiBody[];
}

async function listPostUploadFiles(): Promise<string[]> {
  return await listUploadFiles(join(process.cwd(), 'uploads', 'posts'));
}

async function listUploadFiles(
  rootDirectory: string,
  current = rootDirectory,
): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true }).catch(
    (): Dirent[] => [],
  );
  const files = await Promise.all<string[]>(
    entries.map((entry) => {
      const childPath = join(current, entry.name);

      if (entry.isDirectory()) {
        return listUploadFiles(rootDirectory, childPath);
      }

      return Promise.resolve([relative(rootDirectory, childPath)]);
    }),
  );

  return files.flat().sort();
}

function toLocalPublicPath(publicPath: string) {
  return toUploadLocalPath(publicPath);
}

async function expectPublicPathMissing(publicPath: string) {
  await expect(access(toLocalPublicPath(publicPath))).rejects.toThrow();
}

function getDatabaseUrl() {
  const databaseUrl =
    process.env.E2E_DATABASE_URL ??
    process.env.DATABASE_URL ??
    readEnvFile().DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL or E2E_DATABASE_URL is required.');
  }

  assertLocalDatabaseUrl(databaseUrl);

  return databaseUrl;
}

function readEnvFile() {
  const envText = readFileSync('.env', 'utf8');
  const env: Record<string, string> = {};

  for (const line of envText.split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith('#') || !line.includes('=')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    const key = line.slice(0, separatorIndex).trim();
    const value = line
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');

    env[key] = value;
  }

  return env;
}

function assertLocalDatabaseUrl(databaseUrl: string) {
  const url = new URL(databaseUrl);
  const allowedHosts = new Set(['127.0.0.1', '::1', 'localhost']);

  if (!allowedHosts.has(url.hostname)) {
    throw new Error('Domain e2e tests only run against a local Postgres host.');
  }
}

function withSearchPath(databaseUrl: string, schema: string) {
  const url = new URL(databaseUrl);

  url.searchParams.set('options', `-c search_path=${schema},public`);

  return url.toString();
}

async function createSchema(databaseUrl: string, schema: string) {
  const client = new Client({ connectionString: databaseUrl });

  await client.connect();

  try {
    await client.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
  } finally {
    await client.end();
  }
}

async function dropSchema(databaseUrl: string, schema: string) {
  if (!schema) {
    return;
  }

  const client = new Client({ connectionString: databaseUrl });

  await client.connect();

  try {
    await client.query(
      `DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`,
    );
  } finally {
    await client.end();
  }
}

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
