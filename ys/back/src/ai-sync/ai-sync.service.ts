import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AiSyncService {
  private readonly logger = new Logger(AiSyncService.name);

  constructor(private readonly configService: ConfigService) {}

  async syncPost(postId: number) {
    if (!Number.isInteger(postId) || postId <= 0) {
      return;
    }

    const enabled =
      (this.configService.get<string>('RAG_SYNC_ENABLED') ?? 'true').toLowerCase() !==
      'false';

    if (!enabled) {
      return;
    }

    const aiBaseUrl =
      this.configService.get<string>('AI_BACK_BASE_URL') ?? 'http://127.0.0.1:8000';
    const internalApiToken =
      this.configService.get<string>('INTERNAL_API_TOKEN')?.trim();
    const headers: Record<string, string> = {};

    if (internalApiToken) {
      headers['X-Internal-Token'] = internalApiToken;
    }

    const timeoutMs = this.getPositiveInteger('AI_SYNC_TIMEOUT_MS', 5_000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${aiBaseUrl}/rag/sync/post/${postId}`, {
        method: 'POST',
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        this.logger.warn(
          `RAG sync failed for post ${postId}: ${response.status} ${body}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`RAG sync request failed for post ${postId}: ${message}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  private getPositiveInteger(key: string, fallback: number) {
    const value = this.configService.get<string>(key);
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }
}
