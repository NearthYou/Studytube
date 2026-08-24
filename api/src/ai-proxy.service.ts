import { HttpService } from '@nestjs/axios';
import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { DatabaseService } from './database.service';
import type { EmbeddingResponse } from './retrieval/retrieval.types';
import {
  injectTraceContext,
  observabilityRuntime,
  type ObservabilityRuntime,
} from './observability';

@Injectable()
export class AiProxyService {
  private readonly aiServiceUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    @Optional() private readonly databaseService?: DatabaseService,
    @Optional()
    private readonly observability: ObservabilityRuntime = observabilityRuntime,
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

  async recommend(body: unknown, ownerId?: number): Promise<unknown> {
    const input = body && typeof body === 'object' ? body : {};
    const query =
      'query' in input && typeof input.query === 'string'
        ? input.query.trim().slice(0, 500)
        : '';
    const requestedLimit =
      'limit' in input && Number.isFinite(Number(input.limit))
        ? Math.trunc(Number(input.limit))
        : 3;
    const limit = Math.max(1, Math.min(requestedLimit, 10));
    const contextSnapshotId =
      'contextSnapshotId' in input &&
      typeof input.contextSnapshotId === 'string' &&
      /^[0-9a-f-]{36}$/iu.test(input.contextSnapshotId)
        ? input.contextSnapshotId
        : undefined;
    if (!query || !ownerId || !this.databaseService) {
      return {
        mode: 'hybrid-unavailable',
        query,
        answer: 'Hybrid retrieval requires an authenticated user and query.',
        relatedPosts: [],
        sources: [],
      };
    }

    let embedded: EmbeddingResponse;
    try {
      embedded = await this.embedding({ input: query });
    } catch (error) {
      if (!(error instanceof AiEmbeddingUnavailableError)) {
        throw error;
      }
      return {
        mode: 'embedding-unavailable',
        query,
        answer: 'Semantic retrieval is temporarily unavailable.',
        relatedPosts: [],
        sources: [],
        embedding: {
          provider: 'unavailable',
          dimensions: 1536,
        },
      };
    }
    const sources = await this.databaseService
      .getRetrievalRepository()
      .hybridSearch({
        ownerId,
        query,
        model: embedded.model,
        embedding: embedded.embedding,
        limit,
        ...(contextSnapshotId ? { contextSnapshotId } : {}),
      });
    const relatedPosts = sources
      .filter((source) => source.sourceKind === 'post')
      .map((source) => ({
        id: Number(source.sourceId),
        title: source.title,
        summary:
          typeof source.content === 'string'
            ? source.content.slice(0, 500)
            : '',
        videoUrl: source.citation.sourceUrl,
        score: source.score,
        citation: source.citation,
      }));
    return {
      mode: 'hybrid',
      query,
      answer:
        sources.length > 0
          ? `Found ${sources.length} cited learning sources.`
          : 'No sufficiently grounded sources were found.',
      relatedPosts,
      sources,
      embedding: {
        provider: embedded.model,
        dimensions: embedded.dimensions,
      },
      retrieval: {
        lexical: 'pg_trgm',
        semantic: 'pgvector-cosine',
        fusion: 'rrf-k60',
      },
      usage: {
        model: embedded.model,
        totalTokens: embedded.inputTokens ?? 0,
        estimatedCostUsd: embedded.estimatedCostUsd ?? 0,
      },
    };
  }

  async embedding(
    input: { input: string },
    signal?: AbortSignal,
  ): Promise<EmbeddingResponse> {
    const startedAt = performance.now();
    let data: unknown;
    try {
      data = await this.postStrict(
        '/embeddings',
        input,
        Number(this.configService.get<string>('AI_EMBEDDING_TIMEOUT_MS')) ||
          15_000,
        signal,
      );
    } catch (error) {
      if (signal?.aborted) {
        throw signal.reason ?? error;
      }
      this.recordAiRequest(
        'embedding',
        'text-embedding-3-small',
        'failed',
        startedAt,
      );
      throw new AiEmbeddingUnavailableError();
    }
    if (!isEmbeddingResponse(data)) {
      this.recordAiRequest(
        'embedding',
        'text-embedding-3-small',
        'failed',
        startedAt,
      );
      throw new AiEmbeddingUnavailableError();
    }
    this.recordAiRequest(
      'embedding',
      data.model,
      'succeeded',
      startedAt,
      data.inputTokens,
      data.estimatedCostUsd,
    );
    return data;
  }

  lookupYoutube(body: unknown): Promise<unknown> {
    return this.post(
      '/youtube/lookup',
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

  captions(body: unknown, signal?: AbortSignal): Promise<unknown> {
    return this.post(
      '/youtube/captions',
      body,
      this.captionFallback(body),
      Number(this.configService.get<string>('AI_CAPTION_TIMEOUT_MS')) || 300000,
      signal,
    );
  }

  transcribe(body: unknown, signal?: AbortSignal): Promise<unknown> {
    return this.post(
      '/youtube/transcribe',
      body,
      {
        provider: 'stt-disabled',
        status: 'disabled',
        sourceLanguage: '',
        segments: [],
        translatedSegments: [],
        errorCode: 'STT_DISABLED',
      },
      Number(this.configService.get<string>('AI_TRANSCRIPTION_TIMEOUT_MS')) ||
        300_000,
      signal,
    );
  }

  async transcribeLiveCaptionChunk(body: {
    audioBase64: string;
    mimeType: string;
    durationSeconds: number;
    model: string;
  }): Promise<{
    sourceLanguage: string;
    source: string;
    korean: string;
  }> {
    const value = await this.postStrict(
      '/live-captions/transcribe',
      body,
      45_000,
    );
    if (!isLiveCaptionTranscription(value)) {
      throw new Error('자막을 만들지 못했습니다. 잠시 후 다시 시도해주세요.');
    }
    return value;
  }

  summary(body: unknown, signal?: AbortSignal): Promise<unknown> {
    return this.post(
      '/youtube/summary',
      body,
      this.summaryFallback(body),
      Number(this.configService.get<string>('AI_SUMMARY_TIMEOUT_MS')) || 180000,
      signal,
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

  async generateQuiz(body: unknown, signal?: AbortSignal): Promise<unknown> {
    const startedAt = performance.now();
    try {
      const data = await this.postStrict(
        '/quiz/generate',
        body,
        Number(this.configService.get<string>('AI_QUIZ_TIMEOUT_MS')) || 120_000,
        signal,
      );
      const usage = aiUsage(data);
      this.recordAiRequest(
        'quiz_generation',
        usage.model,
        'succeeded',
        startedAt,
        usage.tokens,
        usage.costUsd,
      );
      return data;
    } catch (error) {
      this.recordAiRequest('quiz_generation', 'unknown', 'failed', startedAt);
      throw signal?.aborted ? (signal.reason ?? error) : error;
    }
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
    signal?: AbortSignal,
  ): Promise<unknown> {
    const startedAt = performance.now();
    try {
      const response = await firstValueFrom(
        this.httpService.post<unknown>(`${this.aiServiceUrl}${path}`, body, {
          headers: this.internalHeaders(),
          timeout,
          signal,
        }),
      );
      const data: unknown = response.data;
      const usage = aiUsage(data);
      this.recordAiRequest(
        path,
        usage.model,
        'succeeded',
        startedAt,
        usage.tokens,
        usage.costUsd,
      );

      return data;
    } catch (error) {
      if (signal?.aborted) {
        throw signal.reason ?? error;
      }
      this.recordAiRequest(path, 'unknown', 'failed', startedAt);
      return fallback;
    }
  }

  private async postStrict(
    path: string,
    body: unknown,
    timeout: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const response = await firstValueFrom(
      this.httpService.post<unknown>(`${this.aiServiceUrl}${path}`, body, {
        headers: this.internalHeaders(),
        timeout,
        signal,
      }),
    );
    return response.data;
  }

  private internalHeaders() {
    const apiKey = this.configService.get<string>('INTERNAL_AI_API_KEY');
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers['X-INTERNAL-API-KEY'] = apiKey;
    }
    const trace = this.observability.traces.current();
    if (trace) {
      injectTraceContext(trace, headers);
    }
    return Object.keys(headers).length > 0 ? headers : undefined;
  }

  private recordAiRequest(
    operation: string,
    model: string,
    outcome: 'succeeded' | 'failed',
    startedAt: number,
    tokens = 0,
    costUsd = 0,
  ): void {
    this.observability.metrics.aiRequest(
      operation,
      model,
      outcome,
      performance.now() - startedAt,
      nonNegativeFinite(tokens),
      nonNegativeFinite(costUsd),
    );
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

export class AiEmbeddingUnavailableError extends Error {
  constructor() {
    super('Embedding provider is unavailable');
  }
}

function isEmbeddingResponse(value: unknown): value is EmbeddingResponse {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<EmbeddingResponse>;
  return (
    candidate.model === 'text-embedding-3-small' &&
    candidate.dimensions === 1536 &&
    Array.isArray(candidate.embedding) &&
    candidate.embedding.length === 1536 &&
    candidate.embedding.every(
      (dimension) =>
        typeof dimension === 'number' && Number.isFinite(dimension),
    )
  );
}

function isLiveCaptionTranscription(value: unknown): value is {
  sourceLanguage: string;
  source: string;
  korean: string;
} {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.status === 'ready' &&
    typeof candidate.sourceLanguage === 'string' &&
    typeof candidate.source === 'string' &&
    candidate.source.trim().length > 0 &&
    typeof candidate.korean === 'string'
  );
}

function aiUsage(value: unknown): {
  model: string;
  tokens: number;
  costUsd: number;
} {
  if (!value || typeof value !== 'object') {
    return { model: 'unknown', tokens: 0, costUsd: 0 };
  }
  const row = value as Record<string, unknown>;
  const usage =
    row.usage && typeof row.usage === 'object'
      ? (row.usage as Record<string, unknown>)
      : row;
  return {
    model: typeof row.model === 'string' ? row.model.slice(0, 128) : 'unknown',
    tokens: nonNegativeFinite(usage.totalTokens ?? usage.inputTokens),
    costUsd: nonNegativeFinite(usage.estimatedCostUsd ?? row.estimatedCostUsd),
  };
}

function nonNegativeFinite(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
