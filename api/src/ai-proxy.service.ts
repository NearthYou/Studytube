import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class AiProxyService {
  private readonly aiServiceUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    this.aiServiceUrl =
      this.configService.get<string>('AI_SERVICE_URL') ??
      'http://localhost:8000';
  }

  health(): Promise<unknown> {
    return this.get('/health', {
      service: 'ai',
      status: 'unreachable',
      message: 'FastAPI service is not running.',
    });
  }

  recommend(body: unknown): Promise<unknown> {
    return this.post('/rag/recommend', body, {
      mode: 'ai-service-unavailable',
      answer: 'AI service is offline, so RAG recommendations are unavailable.',
      relatedPosts: [],
    });
  }

  lookupYoutube(body: unknown): Promise<unknown> {
    return this.post(
      '/mcp',
      {
        jsonrpc: '2.0',
        id: 'nest-proxy',
        method: 'youtube.lookup',
        params: body,
      },
      {
        jsonrpc: '2.0',
        id: 'nest-proxy',
        result: {
          provider: 'ai-service-unavailable',
          title: 'YouTube metadata unavailable',
          channel: 'YouTube',
          thumbnailUrl: '',
          sourceUrl: '',
          durationLabel: 'metadata unavailable',
          summary:
            'FastAPI MCP service is offline, so external YouTube metadata could not be fetched.',
          videos: [],
        },
      },
    );
  }

  captions(body: unknown): Promise<unknown> {
    return this.post(
      '/youtube/captions',
      body,
      this.captionFallback(body),
      Number(this.configService.get<string>('AI_CAPTION_TIMEOUT_MS')) || 300000,
    );
  }

  summary(body: unknown): Promise<unknown> {
    return this.post(
      '/youtube/summary',
      body,
      this.summaryFallback(body),
      90000,
    );
  }

  plan(body: unknown): Promise<unknown> {
    return this.post(
      '/agent/study-plan',
      body,
      {
        mode: 'ai-service-unavailable',
        goal: '',
        recommendations: [],
        rationale:
          'FastAPI agent service is offline. Start the AI service to run the full bounded tool loop.',
        trace: [],
      },
      Number(this.configService.get<string>('AI_AGENT_TIMEOUT_MS')) || 60000,
    );
  }

  private async get(path: string, fallback: unknown): Promise<unknown> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<unknown>(`${this.aiServiceUrl}${path}`, {
          headers: this.internalHeaders(),
          timeout: 3000,
        }),
      );
      const data: unknown = response.data;

      return data;
    } catch {
      return fallback;
    }
  }

  private async post(
    path: string,
    body: unknown,
    fallback: unknown,
    timeout = 7000,
  ): Promise<unknown> {
    try {
      const response = await firstValueFrom(
        this.httpService.post<unknown>(`${this.aiServiceUrl}${path}`, body, {
          headers: this.internalHeaders(),
          timeout,
        }),
      );
      const data: unknown = response.data;

      return data;
    } catch {
      return fallback;
    }
  }

  private internalHeaders() {
    const apiKey = this.configService.get<string>('INTERNAL_AI_API_KEY');

    return apiKey ? { 'X-INTERNAL-API-KEY': apiKey } : undefined;
  }

  private captionFallback(body: unknown) {
    const input = body && typeof body === 'object' ? body : {};
    const targetLanguage =
      'targetLanguage' in input && typeof input.targetLanguage === 'string'
        ? input.targetLanguage
        : 'ko';
    const videoId =
      'videoId' in input && typeof input.videoId === 'string'
        ? input.videoId
        : '';

    return {
      mode: 'youtube-captions',
      provider: 'ai-service-unavailable',
      videoId,
      language: targetLanguage,
      sourceLanguage: 'unavailable',
      translated: false,
      segments: [],
      message:
        'FastAPI caption service did not respond before the proxy timeout.',
    };
  }

  private summaryFallback(body: unknown) {
    const input = body && typeof body === 'object' ? body : {};
    const videoId =
      'videoId' in input && typeof input.videoId === 'string'
        ? input.videoId
        : '';
    const language =
      'language' in input && typeof input.language === 'string'
        ? input.language
        : 'ko';

    return {
      mode: 'youtube-summary',
      provider: 'ai-service-unavailable',
      videoId,
      language,
      sections: [
        {
          label: '요약 생성 실패',
          body: 'AI 요약 서비스 응답을 받지 못했습니다. 자막을 다시 불러온 뒤 시도해 주세요.',
        },
      ],
      message:
        'FastAPI summary service did not respond before the proxy timeout.',
    };
  }
}
