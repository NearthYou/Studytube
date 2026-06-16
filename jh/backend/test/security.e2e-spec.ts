import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { Response as SupertestResponse } from 'supertest';
import { App } from 'supertest/types';
import { AgentController } from '../src/agent/agent.controller';
import { AgentService } from '../src/agent/agent.service';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../src/auth/guards/optional-jwt-auth.guard';
import { CommentsController } from '../src/comments/comments.controller';
import { CommentsService } from '../src/comments/comments.service';
import { LikesController } from '../src/likes/likes.controller';
import { LikesService } from '../src/likes/likes.service';
import { PostsController } from '../src/posts/posts.controller';
import { PostsService } from '../src/posts/posts.service';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ApiResponseInterceptor } from '../src/common/interceptors/api-response.interceptor';
import { toUploadLocalPath } from '../src/common/upload/upload-paths';

type TestMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST';

describe('Protected routes (e2e)', () => {
  let app: INestApplication<App>;
  let agentService: { chat: jest.Mock };
  let authService: { logout: jest.Mock; signup: jest.Mock };
  let commentsService: {
    create: jest.Mock;
    findByPost: jest.Mock;
    remove: jest.Mock;
    update: jest.Mock;
  };
  let jwtService: { verifyAsync: jest.Mock };
  let likesService: {
    likeComment: jest.Mock;
    likePost: jest.Mock;
    unlikeComment: jest.Mock;
    unlikePost: jest.Mock;
  };
  let postsService: {
    create: jest.Mock;
    deleteImage: jest.Mock;
    findAll: jest.Mock;
    findOne: jest.Mock;
    incrementViews: jest.Mock;
    remove: jest.Mock;
    search: jest.Mock;
    update: jest.Mock;
    uploadImages: jest.Mock;
  };

  beforeEach(async () => {
    agentService = {
      chat: jest.fn().mockResolvedValue({
        answer: 'ok',
        message: 'Assistant 응답을 생성했습니다.',
        riskLevel: 'none',
        usedTools: ['conversation_reply'],
      }),
    };
    jwtService = {
      verifyAsync: jest.fn(),
    };
    authService = {
      logout: jest.fn().mockReturnValue({ message: '로그아웃되었습니다.' }),
      signup: jest.fn(),
    };
    commentsService = {
      create: jest.fn(),
      findByPost: jest.fn().mockResolvedValue({ message: 'comments ok' }),
      remove: jest.fn(),
      update: jest.fn(),
    };
    likesService = {
      likeComment: jest.fn(),
      likePost: jest.fn(),
      unlikeComment: jest.fn(),
      unlikePost: jest.fn(),
    };
    postsService = {
      create: jest.fn(),
      deleteImage: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn().mockResolvedValue({ message: 'post ok' }),
      incrementViews: jest.fn(),
      remove: jest.fn(),
      search: jest.fn(),
      update: jest.fn(),
      uploadImages: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [
        AgentController,
        AuthController,
        CommentsController,
        LikesController,
        PostsController,
      ],
      providers: [
        JwtAuthGuard,
        OptionalJwtAuthGuard,
        { provide: AgentService, useValue: agentService },
        {
          provide: AuthService,
          useValue: authService,
        },
        {
          provide: CommentsService,
          useValue: commentsService,
        },
        {
          provide: LikesService,
          useValue: likesService,
        },
        {
          provide: PostsService,
          useValue: postsService,
        },
        { provide: JwtService, useValue: jwtService },
      ],
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
  });

  afterEach(async () => {
    await app.close();
  });

  it.each<[TestMethod, string]>([
    ['POST', '/api/agent/chat'],
    ['POST', '/api/auth/logout'],
    ['POST', '/api/posts'],
    ['PATCH', '/api/posts/1'],
    ['DELETE', '/api/posts/1'],
    ['POST', '/api/posts/1/comments'],
    ['PATCH', '/api/comments/1'],
    ['DELETE', '/api/comments/1'],
    ['POST', '/api/posts/1/likes'],
    ['DELETE', '/api/posts/1/likes'],
  ])('%s %s rejects anonymous requests', async (method, path) => {
    await makeRequest(method, path)
      .send({ message: 'hello' })
      .expect(401)
      .expect((response) => {
        expect(getBody(response)).toEqual(
          expect.objectContaining({
            errorCode: 'UNAUTHORIZED',
            message: '로그인이 필요합니다.',
            success: false,
          }),
        );
      });

    expectProtectedServicesNotCalled();
  });

  it('rejects invalid bearer tokens before agent service execution', async () => {
    jwtService.verifyAsync.mockRejectedValueOnce(new Error('invalid token'));

    await request(app.getHttpServer())
      .post('/api/agent/chat')
      .set('Authorization', 'Bearer invalid-token')
      .send({ message: '강아지가 산책 중 짖어요' })
      .expect(401)
      .expect((response) => {
        expect(getBody(response)).toEqual(
          expect.objectContaining({
            errorCode: 'UNAUTHORIZED',
            message: '유효하지 않은 로그인 토큰입니다.',
            success: false,
          }),
        );
      });

    expect(agentService.chat).not.toHaveBeenCalled();
  });

  it('rejects purpose tokens before agent service execution', async () => {
    jwtService.verifyAsync.mockResolvedValueOnce({
      email: 'user@example.com',
      nickname: '테스터',
      purpose: 'email_verification',
      sub: '7',
    });

    await request(app.getHttpServer())
      .post('/api/agent/chat')
      .set('Authorization', 'Bearer purpose-token')
      .send({ message: '안녕' })
      .expect(401)
      .expect((response) => {
        expect(getBody(response)).toEqual(
          expect.objectContaining({
            errorCode: 'UNAUTHORIZED',
            message: '유효하지 않은 로그인 토큰입니다.',
            success: false,
          }),
        );
      });

    expect(agentService.chat).not.toHaveBeenCalled();
  });

  it('passes authenticated users into the agent route', async () => {
    jwtService.verifyAsync.mockResolvedValueOnce({
      email: 'user@example.com',
      nickname: '테스터',
      sub: '7',
    });

    await request(app.getHttpServer())
      .post('/api/agent/chat')
      .set('Authorization', 'Bearer valid-token')
      .send({ message: '안녕' })
      .expect(201)
      .expect((response) => {
        const body = getBody(response);

        expect(body.success).toBe(true);
        expect(body.data).toEqual(expect.objectContaining({ answer: 'ok' }));
      });

    expect(agentService.chat).toHaveBeenCalledWith(
      expect.objectContaining({ message: '안녕' }),
      expect.objectContaining({
        email: 'user@example.com',
        id: '7',
        nickname: '테스터',
      }),
    );
  });

  it('allows optional public post reads without a token', async () => {
    await request(app.getHttpServer())
      .get('/api/posts/1')
      .expect(200)
      .expect((response) => {
        const body = getBody(response);

        expect(body.success).toBe(true);
        expect(body.data).toEqual(
          expect.objectContaining({ message: 'post ok' }),
        );
      });

    expect(postsService.findOne).toHaveBeenCalledWith('1', undefined);
  });

  it('ignores invalid optional tokens on public reads', async () => {
    jwtService.verifyAsync.mockRejectedValueOnce(new Error('invalid token'));

    await request(app.getHttpServer())
      .get('/api/posts/1/comments')
      .set('Authorization', 'Bearer invalid-token')
      .expect(200);

    expect(commentsService.findByPost).toHaveBeenCalledWith(
      '1',
      expect.any(Object),
      undefined,
    );
  });

  it('passes valid optional auth users to public reads', async () => {
    jwtService.verifyAsync.mockResolvedValueOnce({
      email: 'user@example.com',
      nickname: '테스터',
      sub: '7',
    });

    await request(app.getHttpServer())
      .get('/api/posts/1/comments')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);

    expect(commentsService.findByPost).toHaveBeenCalledWith(
      '1',
      expect.any(Object),
      expect.objectContaining({ id: '7' }),
    );
  });

  it.each([
    ['GET', '/api/posts/0'],
    ['GET', '/api/posts/abc'],
    ['GET', '/api/posts/1/comments?limit=51'],
  ] satisfies Array<[TestMethod, string]>)(
    '%s %s rejects invalid public input',
    async (method, path) => {
      await makeRequest(method, path)
        .expect(400)
        .expect((response) => {
          expect(getBody(response)).toEqual(
            expect.objectContaining({
              errorCode: 'BAD_REQUEST',
              success: false,
            }),
          );
        });
    },
  );

  it('rejects invalid protected input before service execution', async () => {
    jwtService.verifyAsync.mockResolvedValueOnce({
      email: 'user@example.com',
      nickname: '테스터',
      sub: '7',
    });

    await request(app.getHttpServer())
      .post('/api/agent/chat')
      .set('Authorization', 'Bearer valid-token')
      .send({ message: '' })
      .expect(400);

    expect(agentService.chat).not.toHaveBeenCalled();
  });

  it('rejects unsupported upload MIME types before post image service execution', async () => {
    jwtService.verifyAsync.mockResolvedValueOnce({
      email: 'user@example.com',
      nickname: '테스터',
      sub: '7',
    });

    await request(app.getHttpServer())
      .post('/api/posts/images')
      .set('Authorization', 'Bearer valid-token')
      .attach('images', Buffer.from('<html></html>'), {
        contentType: 'text/html',
        filename: 'payload.html',
      })
      .expect(400)
      .expect((response) => {
        expect(getBody(response)).toEqual(
          expect.objectContaining({
            errorCode: 'BAD_REQUEST',
            success: false,
          }),
        );
      });

    expect(postsService.uploadImages).not.toHaveBeenCalled();
  });

  it('rejects spoofed profile image bytes before signup service execution', async () => {
    const profileUploadsBefore = await listProfileUploads();

    await request(app.getHttpServer())
      .post('/api/auth/signup')
      .field('email', 'profile@example.test')
      .field('nickname', '프로필테스터')
      .field('password', 'Password1!')
      .field('passwordConfirm', 'Password1!')
      .field('emailVerificationToken', 'verified-email-token')
      .field('termsAccepted', 'true')
      .attach('profileImage', Buffer.from('<html></html>'), {
        contentType: 'image/png',
        filename: 'profile.png',
      })
      .expect(400)
      .expect((response) => {
        expect(getBody(response)).toEqual(
          expect.objectContaining({
            errorCode: 'BAD_REQUEST',
            success: false,
          }),
        );
      });

    expect(authService.signup).not.toHaveBeenCalled();
    expect(await listProfileUploads()).toEqual(profileUploadsBefore);
  });

  it('normalizes valid profile images before signup service execution', async () => {
    const previousUploadPublicPrefix = process.env.UPLOAD_PUBLIC_PREFIX;

    process.env.UPLOAD_PUBLIC_PREFIX = '/media';
    const profileUploadsBefore = await listProfileUploads();
    const profileImage = await sharp({
      create: {
        background: '#7c3aed',
        channels: 3,
        height: 720,
        width: 640,
      },
    })
      .png()
      .toBuffer();
    let capturedProfileImageUrl: string | null | undefined;

    authService.signup.mockImplementationOnce(
      (_dto: unknown, profileImageUrl: string | null) => {
        capturedProfileImageUrl = profileImageUrl;

        return Promise.resolve({
          message: '회원가입이 완료되었습니다.',
          user: { id: '7' },
        });
      },
    );

    try {
      await request(app.getHttpServer())
        .post('/api/auth/signup')
        .field('email', 'profile-ok@example.test')
        .field('nickname', '프로필성공')
        .field('password', 'Password1!')
        .field('passwordConfirm', 'Password1!')
        .field('emailVerificationToken', 'verified-email-token')
        .field('termsAccepted', 'true')
        .attach('profileImage', profileImage, {
          contentType: 'image/png',
          filename: 'profile.png',
        })
        .expect(201);

      expect(capturedProfileImageUrl).toMatch(
        /^\/media\/profiles\/[0-9a-f-]+\.webp$/,
      );

      const metadata = await sharp(
        toLocalPublicPath(capturedProfileImageUrl),
      ).metadata();

      expect(metadata.format).toBe('webp');
      expect(metadata.width).toBeLessThanOrEqual(512);
      expect(metadata.height).toBeLessThanOrEqual(512);
    } finally {
      await Promise.all(
        (await listProfileUploads())
          .filter((filename) => !profileUploadsBefore.includes(filename))
          .map((filename) =>
            unlink(join(process.cwd(), 'uploads', 'profiles', filename)).catch(
              () => undefined,
            ),
          ),
      );
      restoreEnv('UPLOAD_PUBLIC_PREFIX', previousUploadPublicPrefix);
    }

    expect(await listProfileUploads()).toEqual(profileUploadsBefore);
  });

  function makeRequest(method: TestMethod, path: string) {
    const server = app.getHttpServer();

    if (method === 'DELETE') {
      return request(server).delete(path);
    }

    if (method === 'GET') {
      return request(server).get(path);
    }

    if (method === 'PATCH') {
      return request(server).patch(path);
    }

    return request(server).post(path);
  }

  function expectProtectedServicesNotCalled() {
    expect(agentService.chat).not.toHaveBeenCalled();
    expect(authService.logout).not.toHaveBeenCalled();
    expect(authService.signup).not.toHaveBeenCalled();
    expect(commentsService.create).not.toHaveBeenCalled();
    expect(commentsService.remove).not.toHaveBeenCalled();
    expect(commentsService.update).not.toHaveBeenCalled();
    expect(likesService.likeComment).not.toHaveBeenCalled();
    expect(likesService.likePost).not.toHaveBeenCalled();
    expect(likesService.unlikeComment).not.toHaveBeenCalled();
    expect(likesService.unlikePost).not.toHaveBeenCalled();
    expect(postsService.create).not.toHaveBeenCalled();
    expect(postsService.deleteImage).not.toHaveBeenCalled();
    expect(postsService.remove).not.toHaveBeenCalled();
    expect(postsService.update).not.toHaveBeenCalled();
    expect(postsService.uploadImages).not.toHaveBeenCalled();
  }
});

function getBody(response: SupertestResponse) {
  return response.body as Record<string, unknown>;
}

async function listProfileUploads() {
  const profileDirectory = join(process.cwd(), 'uploads', 'profiles');
  const filenames = await readdir(profileDirectory).catch(() => []);

  return filenames.sort();
}

function toLocalPublicPath(publicPath: string | undefined) {
  if (!publicPath) {
    throw new Error('Expected public upload path.');
  }

  return toUploadLocalPath(publicPath);
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
