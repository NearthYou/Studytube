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

  plan(body: unknown): Promise<unknown> {
    return this.post('/agent/study-plan', body, {
      mode: 'ai-service-unavailable',
      goal: '',
      recommendations: [],
      rationale:
        'FastAPI agent service is offline. Start the AI service to run the full bounded tool loop.',
      trace: [],
    });
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
  ): Promise<unknown> {
    try {
      const response = await firstValueFrom(
        this.httpService.post<unknown>(`${this.aiServiceUrl}${path}`, body, {
          headers: this.internalHeaders(),
          timeout: 7000,
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
}
