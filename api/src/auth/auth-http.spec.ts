import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AiProxyService } from '../ai-proxy.service';
import { AiController } from '../ai.controller';
import { AppController } from '../app.controller';
import { AppService } from '../app.service';
import { configureApplication } from '../configure-application';
import { StudyBoardController } from '../study-board.controller';
import { StudyBoardService } from '../study-board.service';
import { AuthController } from './auth.controller';
import { AuthCookiePolicy } from './auth-cookie';
import { AuthRepositoryUnavailableError } from './auth.repository';
import { Argon2QueueOverflowError } from './argon2-work-limiter';
import { ClientAddressResolver } from './client-address.resolver';
import { RequestIdMiddleware } from './request-id.middleware';
import { SessionGuard } from './session.guard';
import { AuthService } from './auth.service';

const WEB_ORIGIN = 'https://web.studytube.test';
const SESSION_TOKEN = Buffer.alloc(32, 1).toString('base64url');
const ENROLLMENT_TOKEN = Buffer.alloc(32, 2).toString('base64url');

const user = {
  id: 7,
  name: 'Ada',
  email: 'ada@example.com',
  createdAt: '2026-07-29T00:00:00.000Z',
};

describe('authentication HTTP boundary', () => {
  let app: INestApplication;
  let sessionIsActive: boolean;

  const authService = {
    signup: jest.fn(),
    resend: jest.fn(),
    consumeVerification: jest.fn(),
    getRegistrationReadiness: jest.fn(),
    completeRegistration: jest.fn(),
    login: jest.fn(),
    authenticateSession: jest.fn(),
    logout: jest.fn(),
  };
  const studyBoardService = {
    listPublicPosts: jest.fn(),
    createPost: jest.fn(),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [
        AuthController,
        AppController,
        StudyBoardController,
        AiController,
      ],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: StudyBoardService, useValue: studyBoardService },
        {
          provide: AppService,
          useValue: {
            getHealth: () => ({ status: 'ok' }),
            getLiveness: () => ({ status: 'ok' }),
            getReadiness: () => ({ status: 'ok' }),
            getAiHealth: () => ({ status: 'ok' }),
            getDbHealth: () => ({ status: 'ok' }),
          },
        },
        {
          provide: AiProxyService,
          useValue: { recommend: jest.fn() },
        },
        {
          provide: AuthCookiePolicy,
          useValue: new AuthCookiePolicy('development'),
        },
        ClientAddressResolver,
        RequestIdMiddleware,
        SessionGuard,
      ],
    }).compile();

    app = module.createNestApplication();
    configureApplication(app, { webOrigin: WEB_ORIGIN });
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    sessionIsActive = true;
    authService.signup.mockResolvedValue({ status: 'accepted' });
    authService.resend.mockResolvedValue({ status: 'accepted' });
    authService.consumeVerification.mockResolvedValue({
      status: 'verified',
      enrollmentToken: ENROLLMENT_TOKEN,
    });
    authService.getRegistrationReadiness.mockResolvedValue({ status: 'ready' });
    authService.completeRegistration.mockResolvedValue({
      status: 'completed',
      sessionToken: SESSION_TOKEN,
      user,
    });
    authService.login.mockResolvedValue({
      status: 'authenticated',
      sessionToken: SESSION_TOKEN,
      user,
    });
    authService.authenticateSession.mockImplementation(async (token: string) =>
      token === SESSION_TOKEN && sessionIsActive
        ? {
            status: 'authenticated',
            principal: { sessionId: 11, userId: user.id },
            user,
          }
        : { status: 'invalid' },
    );
    authService.logout.mockImplementation(async () => {
      sessionIsActive = false;
      return { status: 'revoked' };
    });
    studyBoardService.listPublicPosts.mockResolvedValue({ items: [] });
    studyBoardService.createPost.mockResolvedValue({ id: 91 });
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts signup without leaking credentials and rejects extra fields', async () => {
    await request(app.getHttpServer())
      .post('/auth/signup')
      .set('Origin', WEB_ORIGIN)
      .send({ email: 'ada@example.com' })
      .expect(202, { status: 'accepted' });

    expect(authService.signup).toHaveBeenCalledWith(
      { email: 'ada@example.com' },
      expect.any(String),
    );

    const invalid = await request(app.getHttpServer())
      .post('/auth/signup')
      .set('Origin', WEB_ORIGIN)
      .send({ email: 'ada@example.com', password: 'not-accepted-here' })
      .expect(400);

    expect(Object.keys(invalid.body).sort()).toEqual([
      'code',
      'message',
      'requestId',
    ]);
  });

  it('rejects unsafe requests before the auth service when origin or media type is invalid', async () => {
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email: 'ada@example.com' })
      .expect(403);

    await request(app.getHttpServer())
      .post('/auth/signup')
      .set('Origin', 'https://attacker.example')
      .send({ email: 'ada@example.com' })
      .expect(403);

    await request(app.getHttpServer())
      .post('/auth/signup')
      .set('Origin', WEB_ORIGIN)
      .set('Content-Type', 'text/plain')
      .send('{"email":"ada@example.com"}')
      .expect(415);

    expect(authService.signup).not.toHaveBeenCalled();
  });

  it('exchanges a verification token only for an opaque enrollment cookie', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/email-verifications/consume')
      .set('Origin', WEB_ORIGIN)
      .send({ verificationToken: 'verification-secret' })
      .expect(204);

    expect(response.text).toBe('');
    expect(response.headers['set-cookie'].join('\n')).toMatch(
      /studytube_enrollment=.*HttpOnly/i,
    );
    expect(response.headers['set-cookie'].join('\n')).not.toContain(
      'studytube_session=',
    );
    expect(response.body).toEqual({});
  });

  it('completes registration from the enrollment cookie and rotates to a session cookie', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/registrations/complete')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', `studytube_enrollment=${ENROLLMENT_TOKEN}`)
      .send({ name: 'Ada', password: 'correct horse battery staple' })
      .expect(201, { user });

    expect(authService.completeRegistration).toHaveBeenCalledWith(
      {
        enrollmentToken: ENROLLMENT_TOKEN,
        name: 'Ada',
        password: 'correct horse battery staple',
      },
      expect.any(String),
    );
    const cookies = response.headers['set-cookie'].join('\n');
    expect(cookies).toMatch(/studytube_session=.*HttpOnly/i);
    expect(cookies).toContain('studytube_enrollment=;');
    expect(JSON.stringify(response.body)).not.toContain(SESSION_TOKEN);
  });

  it('logs in, authenticates /me, logs out, and rejects session reuse', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', WEB_ORIGIN)
      .send({ email: 'ada@example.com', password: 'password' })
      .expect(200, { user });

    const sessionCookie = login.headers['set-cookie'].find((value: string) =>
      value.startsWith('studytube_session='),
    );
    expect(sessionCookie).toBeDefined();

    await request(app.getHttpServer())
      .get('/me')
      .set('Cookie', sessionCookie)
      .expect(200, user);

    const logout = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', sessionCookie)
      .expect(204);

    expect(logout.headers['set-cookie'].join('\n')).toContain(
      'studytube_session=;',
    );

    await request(app.getHttpServer())
      .get('/me')
      .set('Cookie', sessionCookie)
      .expect(401);
  });

  it('rejects missing, malformed, duplicate, and bearer-only session credentials', async () => {
    const attempts = [
      () => request(app.getHttpServer()).get('/me'),
      () =>
        request(app.getHttpServer())
          .get('/me')
          .set('Cookie', 'studytube_session=x'),
      () =>
        request(app.getHttpServer())
          .get('/me')
          .set(
            'Cookie',
            `studytube_session=${SESSION_TOKEN}; studytube_session=${SESSION_TOKEN}`,
          ),
      () =>
        request(app.getHttpServer())
          .get('/me')
          .set('Authorization', `Bearer ${SESSION_TOKEN}`),
    ];

    for (const attempt of attempts) {
      const response = await attempt().expect(401);
      expect(Object.keys(response.body).sort()).toEqual([
        'code',
        'message',
        'requestId',
      ]);
    }
  });

  it('keeps only explore and basic health public while defaulting every other route to protected', async () => {
    await request(app.getHttpServer()).get('/explore/posts').expect(200);
    await request(app.getHttpServer()).get('/health').expect(200);
    await request(app.getHttpServer()).get('/health/live').expect(200);
    await request(app.getHttpServer()).get('/health/ready').expect(200);

    await request(app.getHttpServer()).get('/posts').expect(401);
    await request(app.getHttpServer()).get('/playlists').expect(401);
    await request(app.getHttpServer()).get('/health/db').expect(401);
    await request(app.getHttpServer())
      .post('/ai/rag/recommend')
      .set('Origin', WEB_ORIGIN)
      .send({ query: 'auth' })
      .expect(401);
  });

  it('passes only the frozen authenticated actor to board services', async () => {
    await request(app.getHttpServer())
      .post('/posts')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', `studytube_session=${SESSION_TOKEN}`)
      .send({
        title: 'Auth boundaries',
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        summary: 'Summary',
        translatedNotes: 'Notes',
        tags: ['security'],
      })
      .expect(201, { id: 91 });

    expect(studyBoardService.createPost).toHaveBeenCalledWith(
      { userId: user.id },
      expect.objectContaining({ title: 'Auth boundaries' }),
    );
    expect(Object.isFrozen(studyBoardService.createPost.mock.calls[0][0])).toBe(
      true,
    );
  });

  it('exposes registration readiness only through the enrollment cookie', async () => {
    await request(app.getHttpServer())
      .get('/auth/registrations/current')
      .set('Cookie', `studytube_enrollment=${ENROLLMENT_TOKEN}`)
      .expect(200, { status: 'ready' });

    await request(app.getHttpServer())
      .get('/auth/registrations/current')
      .set('Authorization', `Bearer ${ENROLLMENT_TOKEN}`)
      .expect(401);
  });

  it('maps rate limits and persistence outages to stable sanitized errors', async () => {
    authService.signup.mockResolvedValueOnce({
      status: 'rate_limited',
      retryAfterSeconds: 17,
    });
    const limited = await request(app.getHttpServer())
      .post('/auth/signup')
      .set('Origin', WEB_ORIGIN)
      .send({ email: 'ada@example.com' })
      .expect(429);
    expect(limited.headers['retry-after']).toBe('17');
    expect(limited.body).toMatchObject({
      code: 'RATE_LIMITED',
      message: 'Too many requests',
    });

    authService.signup.mockRejectedValueOnce(
      new AuthRepositoryUnavailableError(),
    );
    const unavailable = await request(app.getHttpServer())
      .post('/auth/signup')
      .set('Origin', WEB_ORIGIN)
      .set('X-Request-ID', 'request-503')
      .send({ email: 'ada@example.com' })
      .expect(503);
    expect(unavailable.body).toEqual({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Authentication service is temporarily unavailable',
      requestId: 'request-503',
    });
    expect(JSON.stringify(unavailable.body)).not.toContain(
      'Authentication persistence failed',
    );
  });

  it('maps Argon2 queue overflow to a sanitized retryable 503', async () => {
    authService.login.mockRejectedValueOnce(new Argon2QueueOverflowError(9));

    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', WEB_ORIGIN)
      .set('X-Request-ID', 'request-argon2-capacity')
      .send({ email: 'ada@example.com', password: 'password' })
      .expect(503);

    expect(response.headers['retry-after']).toBe('9');
    expect(response.body).toEqual({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Authentication service is temporarily unavailable',
      requestId: 'request-argon2-capacity',
    });
    expect(JSON.stringify(response.body)).not.toContain(
      'Password hashing capacity is temporarily full',
    );
    expect(JSON.stringify(response.body)).not.toContain(
      'AUTH_ARGON2_QUEUE_FULL',
    );
  });
});
