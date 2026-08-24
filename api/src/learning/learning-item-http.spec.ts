import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { AuthCookiePolicy } from '../auth/auth-cookie';
import type { AuthService } from '../auth/auth.service';
import { SessionGuard } from '../auth/session.guard';
import type { LearningItemRepository } from './learning-item.repository';
import { LEARNING_ITEM_REPOSITORY } from './learning-item.repository';
import { LearningItemService } from './learning-item.service';
import { LearningItemController } from './learning-item.controller';
import { LearningOverviewService } from './learning-overview.service';
import { LEARNING_NOTE_REPOSITORY } from './learning-note.repository';
import { createOpenApiDocument } from '../openapi';
import { validate } from 'class-validator';
import { StartLearningItemDto } from './learning-item.dto';
import {
  PROVIDER_BUDGET_REPOSITORY,
  ProviderBudgetUnavailableError,
  type ProviderBudgetRepository,
} from './provider-budget.repository';

describe('LearningItemService intake boundary', () => {
  it('reads an owner caption snapshot without cost admission or provider work', async () => {
    const reserve = jest.fn();
    const snapshot = {
      contextId: '13',
      generation: 4,
      phase: 'index_pending',
      sourceLanguage: 'zh',
      sourceSegments: [{ start: 0, end: 4, text: '你好' }],
      koreanSegments: [{ start: 0, end: 4, text: '안녕하세요' }],
      stale: false,
    } as const;
    const findOwnerCaptionSnapshot = jest.fn().mockResolvedValue(snapshot);
    const service = await createService(
      { reserve },
      { ensureContext: jest.fn(), findOwnerCaptionSnapshot },
    );

    await expect(service.getCaptions(7, '13')).resolves.toEqual(snapshot);
    expect(findOwnerCaptionSnapshot).toHaveBeenCalledWith(7, '13');
    expect(reserve).not.toHaveBeenCalled();
  });

  it('persists a context only after cost admission succeeds', async () => {
    const attachContext = jest.fn().mockResolvedValue(true);
    const reserve = jest.fn().mockResolvedValue({
      reservationId: '41',
      workId: '8f8de73b-6f6a-42a4-a550-a515b4206cb1',
      admission: 'created',
      reservedAudioSeconds: 600,
      subscriptionCreated: true,
    });
    const ensureContext = jest.fn().mockResolvedValue({
      videoSource: {
        id: '11',
        provider: 'youtube',
        canonicalVideoId: 'dQw4w9WgXcQ',
        canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      },
      learningItem: { id: '12' },
      studyContext: { id: '13' },
    });
    const service = await createService(
      { reserve, attachContext },
      { ensureContext },
    );

    const result = await service.start(7, {
      videoUrl: 'https://youtu.be/dQw4w9WgXcQ',
      requestedAudioSeconds: 600,
    });
    expect(result).toMatchObject({
      admission: 'created',
      workId: '8f8de73b-6f6a-42a4-a550-a515b4206cb1',
      context: { studyContext: { id: '13' } },
    });
    expect(result).not.toHaveProperty('subscriptionCreated');
    expect(reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        canonicalVideoId: 'dQw4w9WgXcQ',
        requestedAudioSeconds: 600,
      }),
    );
    expect(ensureContext).toHaveBeenCalledTimes(1);
    expect(attachContext).toHaveBeenCalledWith(7, '41', '13');
  });

  it('does not create learning data when cost admission is unavailable', async () => {
    const reserve = jest
      .fn()
      .mockRejectedValue(new ProviderBudgetUnavailableError('DAILY_CAP'));
    const ensureContext = jest.fn();
    const service = await createService({ reserve }, { ensureContext });

    await expect(
      service.start(7, {
        videoUrl: 'https://youtu.be/dQw4w9WgXcQ',
        requestedAudioSeconds: 600,
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_BUDGET_UNAVAILABLE' });
    expect(ensureContext).not.toHaveBeenCalled();
  });

  it('rejects an unsafe URL before cost reservation or durable work', async () => {
    const reserve = jest.fn();
    const ensureContext = jest.fn();
    const service = await createService({ reserve }, { ensureContext });

    await expect(
      service.start(7, {
        videoUrl: 'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ',
        requestedAudioSeconds: 600,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_YOUTUBE_URL' });
    expect(reserve).not.toHaveBeenCalled();
    expect(ensureContext).not.toHaveBeenCalled();
  });

  it('releases the subscription when context persistence fails', async () => {
    const releaseSubscription = jest.fn().mockResolvedValue(true);
    const budget = {
      reserve: jest.fn().mockResolvedValue({
        reservationId: '41',
        workId: '8f8de73b-6f6a-42a4-a550-a515b4206cb1',
        admission: 'created',
        reservedAudioSeconds: 600,
        subscriptionCreated: true,
      }),
      releaseSubscription,
    };
    const persistenceError = new Error('context unavailable');
    const service = await createService(budget, {
      ensureContext: jest.fn().mockRejectedValue(persistenceError),
    });

    await expect(
      service.start(7, {
        videoUrl: 'https://youtu.be/dQw4w9WgXcQ',
        requestedAudioSeconds: 600,
      }),
    ).rejects.toBe(persistenceError);
    expect(releaseSubscription).toHaveBeenCalledWith(7, '41');
  });

  it('returns a stable error when reservation compensation also fails', async () => {
    const service = await createService(
      {
        reserve: jest.fn().mockResolvedValue({
          reservationId: '41',
          workId: '8f8de73b-6f6a-42a4-a550-a515b4206cb1',
          admission: 'created',
          reservedAudioSeconds: 600,
          subscriptionCreated: true,
        }),
        releaseSubscription: jest
          .fn()
          .mockRejectedValue(new Error('db-password-canary')),
      },
      {
        ensureContext: jest.fn().mockRejectedValue(new Error('raw-url-canary')),
      },
    );

    await expect(
      service.start(7, {
        videoUrl: 'https://youtu.be/dQw4w9WgXcQ',
        requestedAudioSeconds: 600,
      }),
    ).rejects.toMatchObject({
      code: 'LEARNING_INTAKE_COMPENSATION_FAILED',
      message: 'LEARNING_INTAKE_COMPENSATION_FAILED',
    });
  });

  it('treats an unperformed compensation as a stable failure', async () => {
    const service = await createService(
      {
        reserve: jest.fn().mockResolvedValue({
          reservationId: '41',
          workId: '8f8de73b-6f6a-42a4-a550-a515b4206cb1',
          admission: 'created',
          reservedAudioSeconds: 600,
          subscriptionCreated: true,
        }),
        releaseSubscription: jest.fn().mockResolvedValue(false),
      },
      {
        ensureContext: jest
          .fn()
          .mockRejectedValue(new Error('context unavailable')),
      },
    );

    await expect(
      service.start(7, {
        videoUrl: 'https://youtu.be/dQw4w9WgXcQ',
        requestedAudioSeconds: 600,
      }),
    ).rejects.toMatchObject({ code: 'LEARNING_INTAKE_COMPENSATION_FAILED' });
  });

  it('does not release a same-user reservation reused by a retry', async () => {
    const persistenceError = new Error('context unavailable');
    const releaseSubscription = jest.fn();
    const service = await createService(
      {
        reserve: jest.fn().mockResolvedValue({
          reservationId: '41',
          workId: '8f8de73b-6f6a-42a4-a550-a515b4206cb1',
          admission: 'joined',
          reservedAudioSeconds: 600,
          subscriptionCreated: false,
        }),
        releaseSubscription,
      },
      { ensureContext: jest.fn().mockRejectedValue(persistenceError) },
    );

    await expect(
      service.start(7, {
        videoUrl: 'https://youtu.be/dQw4w9WgXcQ',
        requestedAudioSeconds: 600,
      }),
    ).rejects.toBe(persistenceError);
    expect(releaseSubscription).not.toHaveBeenCalled();
  });

  it('releases a newly created cross-user subscription after a join fails', async () => {
    const persistenceError = new Error('context unavailable');
    const releaseSubscription = jest.fn().mockResolvedValue(true);
    const service = await createService(
      {
        reserve: jest.fn().mockResolvedValue({
          reservationId: '42',
          workId: '8f8de73b-6f6a-42a4-a550-a515b4206cb1',
          admission: 'joined',
          reservedAudioSeconds: 600,
          subscriptionCreated: true,
        }),
        releaseSubscription,
      },
      { ensureContext: jest.fn().mockRejectedValue(persistenceError) },
    );

    await expect(
      service.start(8, {
        videoUrl: 'https://youtu.be/dQw4w9WgXcQ',
        requestedAudioSeconds: 600,
      }),
    ).rejects.toBe(persistenceError);
    expect(releaseSubscription).toHaveBeenCalledWith(8, '42');
  });
});

describe('StartLearningItemDto', () => {
  it('rejects transcription requests longer than ten minutes', async () => {
    const input = Object.assign(new StartLearningItemDto(), {
      videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      requestedAudioSeconds: 601,
    });

    const errors = await validate(input);

    expect(errors).toEqual([
      expect.objectContaining({ property: 'requestedAudioSeconds' }),
    ]);
  });
});

describe('SessionGuard learning boundary', () => {
  it('does not allow a public decorator to expose learning intake', async () => {
    const guard = new SessionGuard(
      {
        getAllAndOverride: jest.fn().mockReturnValue(true),
      } as unknown as Reflector,
      { authenticateSession: jest.fn() } as unknown as AuthService,
      {
        readSessionCookie: jest.fn().mockReturnValue(null),
      } as unknown as AuthCookiePolicy,
    );
    const context = {
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
      switchToHttp: () => ({
        getRequest: () => ({
          path: '/learning/items/intake',
          headers: {},
        }),
      }),
    } as ExecutionContext;

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

describe('Learning workspace OpenAPI boundary', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
  });

  it('documents the owner caption snapshot response', async () => {
    const module = await Test.createTestingModule({
      controllers: [LearningItemController],
      providers: [
        { provide: LearningItemService, useValue: {} },
        { provide: LearningOverviewService, useValue: {} },
        { provide: LEARNING_NOTE_REPOSITORY, useValue: {} },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    const document = createOpenApiDocument(app);

    expect(
      document.paths?.['/learning/contexts/{contextId}/captions']?.get
        ?.responses?.['200'],
    ).toMatchObject({
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              phase: { type: 'string' },
              sourceSegments: { type: 'array' },
              koreanSegments: { type: 'array' },
            },
          },
        },
      },
    });

    expect(
      document.paths?.['/learning/contexts/{contextId}/overview']?.get
        ?.responses?.['200'],
    ).toMatchObject({
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              coverage: { type: 'object' },
              summary: { type: 'object' },
            },
          },
        },
      },
    });
    expect(
      document.paths?.['/learning/contexts/{contextId}/explanations']?.post
        ?.responses?.['200'],
    ).toBeDefined();
  });
});

async function createService(
  budget: Pick<ProviderBudgetRepository, 'reserve'> &
    Partial<
      Pick<ProviderBudgetRepository, 'releaseSubscription' | 'attachContext'>
    >,
  items: Pick<LearningItemRepository, 'ensureContext'> &
    Partial<Pick<LearningItemRepository, 'findOwnerCaptionSnapshot'>>,
): Promise<LearningItemService> {
  const module = await Test.createTestingModule({
    providers: [
      LearningItemService,
      {
        provide: PROVIDER_BUDGET_REPOSITORY,
        useValue: {
          attachContext: jest.fn().mockResolvedValue(true),
          ...budget,
        },
      },
      { provide: LEARNING_ITEM_REPOSITORY, useValue: items },
    ],
  }).compile();
  return module.get(LearningItemService);
}
