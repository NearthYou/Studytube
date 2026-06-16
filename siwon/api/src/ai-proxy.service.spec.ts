import { of } from 'rxjs';
import { AiProxyService } from './ai-proxy.service';

describe('AiProxyService', () => {
  it('allows caption generation to run longer than the generic AI timeout', async () => {
    const post = jest.fn().mockReturnValue(of({ data: { provider: 'ok' } }));
    const service = new AiProxyService(
      {
        get: jest.fn((key: string) =>
          key === 'AI_SERVICE_URL' ? 'http://ai.local' : undefined,
        ),
      } as never,
      { post } as never,
    );

    await service.captions({ videoId: 'abc123' });

    expect(post).toHaveBeenCalledWith(
      'http://ai.local/youtube/captions',
      { videoId: 'abc123' },
      expect.objectContaining({ timeout: 300000 }),
    );
  });

  it('allows summary generation timeout to be configured for long videos', async () => {
    const post = jest.fn().mockReturnValue(of({ data: { mode: 'summary' } }));
    const service = new AiProxyService(
      {
        get: jest.fn((key: string) => {
          if (key === 'AI_SERVICE_URL') {
            return 'http://ai.local';
          }

          if (key === 'AI_SUMMARY_TIMEOUT_MS') {
            return '180000';
          }

          return undefined;
        }),
      } as never,
      { post } as never,
    );

    await service.summary({ videoId: 'long123' });

    expect(post).toHaveBeenCalledWith(
      'http://ai.local/youtube/summary',
      { videoId: 'long123' },
      expect.objectContaining({ timeout: 180000 }),
    );
  });

  it('allows agent study plans to run longer than the generic AI timeout', async () => {
    const post = jest.fn().mockReturnValue(of({ data: { mode: 'agent' } }));
    const service = new AiProxyService(
      {
        get: jest.fn((key: string) =>
          key === 'AI_SERVICE_URL' ? 'http://ai.local' : undefined,
        ),
      } as never,
      { post } as never,
    );

    await service.plan({ goal: 'React hooks study course' });

    expect(post).toHaveBeenCalledWith(
      'http://ai.local/agent/study-plan',
      { goal: 'React hooks study course' },
      expect.objectContaining({ timeout: 60000 }),
    );
  });

  it('keeps the requested caption language in the timeout fallback', async () => {
    const post = jest.fn().mockImplementation(() => {
      throw new Error('timeout');
    });
    const service = new AiProxyService(
      {
        get: jest.fn((key: string) =>
          key === 'AI_SERVICE_URL' ? 'http://ai.local' : undefined,
        ),
      } as never,
      { post } as never,
    );

    await expect(
      service.captions({ videoId: 'abc123', targetLanguage: 'en' }),
    ).resolves.toMatchObject({
      provider: 'ai-service-unavailable',
      videoId: 'abc123',
      language: 'en',
      segments: [],
    });
  });
});
