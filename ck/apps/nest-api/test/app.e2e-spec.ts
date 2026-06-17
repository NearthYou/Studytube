import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

type ErrorResponse = {
  statusCode?: number;
  message?: unknown;
};

type RegisterResponse = {
  id: string;
};

type LoginResponse = {
  accessToken: string;
};

type MeResponse = {
  email?: string;
};

type TagResponse = {
  id: string;
  name: string;
  type: string;
};

type ReviewResponse = {
  id: string;
  content?: string;
  tags: TagResponse[];
  delete?: boolean;
};

type CommentResponse = {
  id: string;
  content?: string;
  deleted?: boolean;
};

type SearchResponse = {
  total: number;
  page: number;
  limit: number;
  hasNext: boolean;
  items: ReviewResponse[];
};

describe('HealthController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/health (GET)', () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    return request(server)
      .get('/health')
      .expect(200)
      .expect((response) => {
        const body = response.body as {
          status?: unknown;
          database?: unknown;
        };

        expect(body.status).toBe('ok');
        expect(body.database).toBe('connected');
      });
  });

  afterEach(async () => {
    await app.close();
  });
});

describe('Core feature integration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];
  const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const createdUserIds: bigint[] = [];
  const createdTheaterIds: bigint[] = [];
  const createdMusicalIds: bigint[] = [];
  const createdPerformanceIds: bigint[] = [];
  const createdTagIds: bigint[] = [];
  const createdReviewIds: bigint[] = [];
  const createdCommentIds: bigint[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    server = app.getHttpServer() as Parameters<typeof request>[0];
  });

  afterAll(async () => {
    await prisma.comment.deleteMany({
      where: { id: { in: createdCommentIds } },
    });
    await prisma.seatReviewTag.deleteMany({
      where: { seatReviewId: { in: createdReviewIds } },
    });
    await prisma.seatReview.deleteMany({
      where: { id: { in: createdReviewIds } },
    });
    await prisma.performance.deleteMany({
      where: { id: { in: createdPerformanceIds } },
    });
    await prisma.tag.deleteMany({
      where: { id: { in: createdTagIds } },
    });
    await prisma.musical.deleteMany({
      where: { id: { in: createdMusicalIds } },
    });
    await prisma.theater.deleteMany({
      where: { id: { in: createdTheaterIds } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: createdUserIds } },
    });
    await app.close();
  });

  it('connects auth, reviews, comments, tags, search, permissions, and error formats', async () => {
    const theater = await prisma.theater.create({
      data: { name: `Integration Theater ${runId}` },
    });
    const musical = await prisma.musical.create({
      data: { title: `Integration Musical ${runId}` },
    });
    const performance = await prisma.performance.create({
      data: {
        theaterId: theater.id,
        musicalId: musical.id,
        seasonLabel: `Integration Season ${runId}`,
      },
    });
    const tag = await prisma.tag.create({
      data: { name: `Integration Tag ${runId}`, type: 'seat_feature' },
    });
    createdTheaterIds.push(theater.id);
    createdMusicalIds.push(musical.id);
    createdPerformanceIds.push(performance.id);
    createdTagIds.push(tag.id);

    const authorEmail = `core-author-${runId}@example.com`;
    const otherEmail = `core-other-${runId}@example.com`;
    const password = 'password1234';

    const authorRegisterResponse = await request(server)
      .post('/auth/register')
      .send({
        email: authorEmail,
        password,
        nickname: 'author-core',
      })
      .expect(201);
    const otherRegisterResponse = await request(server)
      .post('/auth/register')
      .send({
        email: otherEmail,
        password,
        nickname: 'other-core',
      })
      .expect(201);
    const authorRegisterBody = authorRegisterResponse.body as RegisterResponse;
    const otherRegisterBody = otherRegisterResponse.body as RegisterResponse;
    createdUserIds.push(
      BigInt(authorRegisterBody.id),
      BigInt(otherRegisterBody.id),
    );

    const authorLoginResponse = await request(server)
      .post('/auth/login')
      .send({ email: authorEmail, password })
      .expect(201);
    const otherLoginResponse = await request(server)
      .post('/auth/login')
      .send({ email: otherEmail, password })
      .expect(201);
    const authorLoginBody = authorLoginResponse.body as LoginResponse;
    const otherLoginBody = otherLoginResponse.body as LoginResponse;
    const authorToken = authorLoginBody.accessToken;
    const otherToken = otherLoginBody.accessToken;

    await request(server)
      .get('/auth/me')
      .set('Authorization', `Bearer ${authorToken}`)
      .expect(200)
      .expect((response) => {
        const body = response.body as MeResponse;

        expect(body.email).toBe(authorEmail);
      });

    const reviewPayload = {
      theaterId: theater.id.toString(),
      musicalId: musical.id.toString(),
      performanceId: performance.id.toString(),
      seatFloor: '1F',
      seatSection: 'A',
      seatRow: '1',
      seatNumber: '8',
      viewRating: 5,
      soundRating: 4,
      comfortRating: 4,
      expressionRating: 5,
      stageVisibilityRating: 5,
      content: 'Integration review content.',
      tagIds: [tag.id.toString()],
    };

    await request(server)
      .post('/seat-reviews')
      .send(reviewPayload)
      .expect(401)
      .expect((response) => {
        const body = response.body as ErrorResponse;

        expect(body.statusCode).toBe(401);
        expect(body.message).toBeDefined();
      });

    const createReviewResponse = await request(server)
      .post('/seat-reviews')
      .set('Authorization', `Bearer ${authorToken}`)
      .send(reviewPayload)
      .expect(201);
    const createReviewBody = createReviewResponse.body as ReviewResponse;
    const reviewId = createReviewBody.id;
    createdReviewIds.push(BigInt(reviewId));
    expect(createReviewBody.tags).toEqual([
      {
        id: tag.id.toString(),
        name: tag.name,
        type: tag.type,
      },
    ]);

    await request(server)
      .get(`/seat-reviews/${reviewId}`)
      .expect(200)
      .expect((response) => {
        const body = response.body as ReviewResponse;

        expect(body.tags).toHaveLength(1);
        expect(body.tags[0].name).toBe(tag.name);
      });

    await request(server)
      .patch(`/seat-reviews/${reviewId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ content: 'Other user cannot edit this review.' })
      .expect(403)
      .expect((response) => {
        const body = response.body as ErrorResponse;

        expect(body.statusCode).toBe(403);
      });

    await request(server)
      .patch(`/seat-reviews/${reviewId}`)
      .set('Authorization', `Bearer ${authorToken}`)
      .send({ content: 'Author updated integration review.' })
      .expect(200)
      .expect((response) => {
        const body = response.body as ReviewResponse;

        expect(body.content).toBe('Author updated integration review.');
      });

    const createCommentResponse = await request(server)
      .post(`/seat-reviews/${reviewId}/comments`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ content: 'Integration comment content.' })
      .expect(201);
    const createCommentBody = createCommentResponse.body as CommentResponse;
    const commentId = createCommentBody.id;
    createdCommentIds.push(BigInt(commentId));

    await request(server)
      .patch(`/comments/${commentId}`)
      .set('Authorization', `Bearer ${authorToken}`)
      .send({ content: 'Other user cannot edit this comment.' })
      .expect(403)
      .expect((response) => {
        const body = response.body as ErrorResponse;

        expect(body.statusCode).toBe(403);
      });

    await request(server)
      .patch(`/comments/${commentId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ content: 'Comment owner updated the comment.' })
      .expect(200)
      .expect((response) => {
        const body = response.body as CommentResponse;

        expect(body.content).toBe('Comment owner updated the comment.');
      });

    await request(server)
      .get(
        `/seat-reviews/search?theater=${encodeURIComponent(
          theater.name,
        )}&tagId=${tag.id.toString()}&sort=rating&page=1&limit=10`,
      )
      .expect(200)
      .expect((response) => {
        const body = response.body as SearchResponse;

        expect(body).toMatchObject({
          total: 1,
          page: 1,
          limit: 10,
          hasNext: false,
        });
        expect(body.items[0].id).toBe(reviewId);
        expect(body.items[0].tags[0].name).toBe(tag.name);
      });

    await request(server)
      .get('/seat-reviews/999999999999999')
      .expect(404)
      .expect((response) => {
        const body = response.body as ErrorResponse;

        expect(body.statusCode).toBe(404);
      });

    await request(server)
      .delete(`/comments/${commentId}`)
      .set('Authorization', `Bearer ${authorToken}`)
      .expect(403);

    await request(server)
      .delete(`/comments/${commentId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200)
      .expect((response) => {
        const body = response.body as CommentResponse;

        expect(body.deleted).toBe(true);
      });
    createdCommentIds.pop();

    await request(server)
      .delete(`/seat-reviews/${reviewId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403);

    await request(server)
      .delete(`/seat-reviews/${reviewId}`)
      .set('Authorization', `Bearer ${authorToken}`)
      .expect(200)
      .expect((response) => {
        const body = response.body as ReviewResponse;

        expect(body.delete).toBe(true);
      });
    createdReviewIds.pop();

    await request(server)
      .get(`/seat-reviews/${reviewId}/comments`)
      .expect(404)
      .expect((response) => {
        const body = response.body as ErrorResponse;

        expect(body.statusCode).toBe(404);
      });
  });
});
