import { of } from 'rxjs';
import { AiProxyService } from './ai-proxy.service';

describe('AiProxyService', () => {
  it('uses the internal YouTube lookup route instead of the MCP transport', async () => {
    const post = jest.fn().mockReturnValue(
      of({
        data: {
          jsonrpc: '2.0',
          id: 'nest-proxy',
          result: { provider: 'youtube-search-page', videos: [] },
        },
      }),
    );
    const service = new AiProxyService(
      {
        get: jest.fn((key: string) =>
          key === 'AI_SERVICE_URL' ? 'http://ai.local' : undefined,
        ),
      } as never,
      { post } as never,
    );

    await service.lookupYoutube({ query: 'react hooks' });

    expect(post).toHaveBeenCalledWith(
      'http://ai.local/youtube/lookup',
      {
        jsonrpc: '2.0',
        id: 'nest-proxy',
        method: 'youtube.lookup',
        params: { query: 'react hooks' },
      },
      expect.objectContaining({ timeout: 7000 }),
    );
  });

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

  it('uses the short strict route for browser audio chunks', async () => {
    const post = jest.fn().mockReturnValue(
      of({
        data: {
          status: 'ready',
          sourceLanguage: 'en',
          source: 'hello',
          korean: '안녕하세요',
        },
      }),
    );
    const service = new AiProxyService(
      {
        get: jest.fn((key: string) =>
          key === 'AI_SERVICE_URL' ? 'http://ai.local' : undefined,
        ),
      } as never,
      { post } as never,
    );
    const body = {
      audioBase64: 'dGVzdA==',
      mimeType: 'audio/webm',
      durationSeconds: 5,
      model: 'gpt-4o-mini-transcribe-2025-12-15',
    };

    await expect(
      service.transcribeLiveCaptionChunk(body),
    ).resolves.toMatchObject({
      source: 'hello',
      korean: '안녕하세요',
    });
    expect(post).toHaveBeenCalledWith(
      'http://ai.local/live-captions/transcribe',
      body,
      expect.objectContaining({ timeout: 45_000 }),
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

  it('uses real model embeddings and the authorized hybrid repository', async () => {
    const post = jest.fn().mockReturnValue(
      of({
        data: {
          model: 'text-embedding-3-small',
          dimensions: 1536,
          embedding: Array(1536).fill(0.01),
        },
      }),
    );
    const hybridSearch = jest.fn().mockResolvedValue([
      {
        sourceKind: 'post',
        sourceId: '42',
        title: 'PostgreSQL isolation',
        score: 0.032,
        citation: {
          sourceUrl: 'https://youtu.be/isolation?t=12',
          timestampSeconds: 12,
        },
      },
    ]);
    const service = new AiProxyService(
      {
        get: jest.fn((key: string) =>
          key === 'AI_SERVICE_URL' ? 'http://ai.local' : undefined,
        ),
      } as never,
      { post } as never,
      {
        getRetrievalRepository: () => ({ hybridSearch }),
      } as never,
    );

    const response = (await service.recommend(
      { query: 'transaction isolation', limit: 3 },
      7,
    )) as {
      mode: string;
      embedding: { provider: string; dimensions: number };
      sources: Array<{
        sourceId: string;
        citation: { timestampSeconds: number | null };
      }>;
    };
    expect(response).toMatchObject({
      mode: 'hybrid',
      embedding: {
        provider: 'text-embedding-3-small',
        dimensions: 1536,
      },
    });
    expect(response.sources[0]).toMatchObject({
      sourceId: '42',
      citation: { timestampSeconds: 12 },
    });
    const searchCalls = hybridSearch.mock.calls as unknown as Array<
      [{ ownerId: number; query: string }]
    >;
    expect(searchCalls[0]?.[0]).toMatchObject({
      ownerId: 7,
      query: 'transaction isolation',
    });
    expect(
      JSON.stringify(await service.recommend({ query: 'x' }, 7)),
    ).not.toContain('hash');
  });

  it('fails explicitly when the embedding provider is unavailable', async () => {
    const service = new AiProxyService(
      {
        get: jest.fn((key: string) =>
          key === 'AI_SERVICE_URL' ? 'http://ai.local' : undefined,
        ),
      } as never,
      {
        post: jest.fn(() => {
          throw new Error('provider timeout');
        }),
      } as never,
    );

    await expect(service.embedding({ input: 'no fallback' })).rejects.toThrow(
      'Embedding provider is unavailable',
    );
  });
});
