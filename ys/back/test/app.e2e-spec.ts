import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';

describe('AuthController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/api/auth/check-login-id (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/auth/check-login-id')
      .query({ loginId: 'testuser1234' })
      .expect(200)
      .expect(({ body }) => {
        expect(typeof body.available).toBe('boolean');
      });
  });
});
