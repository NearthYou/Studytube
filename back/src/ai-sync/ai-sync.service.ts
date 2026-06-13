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

    try {
      const response = await fetch(`${aiBaseUrl}/rag/sync/post/${postId}`, {
        method: 'POST',
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
    }
  }
}
