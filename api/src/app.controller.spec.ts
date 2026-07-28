import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AiProxyService } from './ai-proxy.service';
import { DatabaseService } from './database.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: DatabaseService,
          useValue: {
            health: jest.fn(),
          },
        },
        {
          provide: AiProxyService,
          useValue: {
            health: jest.fn(),
          },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return api health', () => {
      expect(appController.getHealth()).toMatchObject({
        service: 'api',
        status: 'ok',
      });
    });
  });
});
