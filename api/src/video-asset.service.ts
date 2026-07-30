import { Injectable } from '@nestjs/common';
import { AiProxyService } from './ai-proxy.service';
import type { BoardRepository, StudyPost } from './study-board.types';
import type {
  VideoAsset,
  VideoAssetSegment,
  VideoAssetStatus,
  VideoAssetSummarySection,
} from './video-asset.types';

type CaptionResponse = {
  provider: string;
  translated: boolean;
  segments: VideoAssetSegment[];
  sourceSegments: VideoAssetSegment[];
  translatedSegments: VideoAssetSegment[];
  sourceLanguage: string;
  message: string;
};

type SummaryResponse = {
  sections: VideoAssetSummarySection[];
  message: string;
  failed: boolean;
};

@Injectable()
export class VideoAssetService {
  constructor(
    private readonly repository: BoardRepository,
    private readonly aiProxyService: AiProxyService,
  ) {}

  async preparePostAssetRequest(post: StudyPost): Promise<VideoAsset | null> {
    const videoId = this.extractYoutubeVideoId(post.videoUrl);

    if (!videoId) {
      return null;
    }

    const current = await this.repository.findVideoAsset(post.id);
    const currentMatchesPost =
      current?.videoId === videoId && current.videoUrl === post.videoUrl;

    if (currentMatchesPost && current.status === 'ready') {
      return current;
    }

    if (this.repository.requestVideoAssetPreparation) {
      return this.repository.requestVideoAssetPreparation({
        postId: post.id,
        videoId,
        videoUrl: post.videoUrl,
        language: 'ko',
      });
    }

    const asset = await this.repository.upsertVideoAsset({
      postId: post.id,
      videoId,
      videoUrl: post.videoUrl,
      language: 'ko',
    });
    const processing = await this.repository.updateVideoAsset(post.id, {
      status: 'processing',
      sourceCaptionStatus: 'pending',
      translationStatus: 'pending',
      summaryStatus: 'pending',
      sourceSegments: currentMatchesPost ? undefined : [],
      translatedSegments: currentMatchesPost ? undefined : [],
      summarySections: currentMatchesPost ? undefined : [],
      transcriptBody: currentMatchesPost ? undefined : '',
      errorMessage: '',
    });

    return processing ?? asset;
  }

  async preparePostAsset(
    post: StudyPost,
    signal?: AbortSignal,
  ): Promise<VideoAsset | null> {
    signal?.throwIfAborted();
    const videoId = this.extractYoutubeVideoId(post.videoUrl);

    if (!videoId) {
      return null;
    }

    const current = await this.repository.findVideoAsset(post.id);
    signal?.throwIfAborted();
    const currentMatchesPost =
      current?.videoId === videoId && current.videoUrl === post.videoUrl;
    if (currentMatchesPost && current.status === 'ready') {
      return current;
    }

    const canResumePersistedCaptions =
      currentMatchesPost &&
      current.sourceCaptionStatus === 'ready' &&
      current.sourceSegments.length > 0;
    let sourceCaptionStatus: 'pending' | 'ready' | 'failed' =
      canResumePersistedCaptions ? 'ready' : 'pending';
    let translationStatus: 'pending' | 'ready' | 'partial' | 'failed' =
      canResumePersistedCaptions &&
      current.translationStatus === 'ready' &&
      current.translatedSegments.length > 0
        ? 'ready'
        : canResumePersistedCaptions
          ? 'partial'
          : 'pending';
    let sourceSegments = canResumePersistedCaptions
      ? current.sourceSegments
      : [];
    let translatedSegments = canResumePersistedCaptions
      ? current.translatedSegments
      : [];

    try {
      signal?.throwIfAborted();
      await this.repository.upsertVideoAsset({
        postId: post.id,
        videoId,
        videoUrl: post.videoUrl,
        language: 'ko',
      });
      signal?.throwIfAborted();

      if (!canResumePersistedCaptions) {
        await this.repository.updateVideoAsset(post.id, {
          status: 'processing',
          sourceCaptionStatus: 'pending',
          translationStatus: 'pending',
          summaryStatus: 'pending',
          errorMessage: '',
        });
        signal?.throwIfAborted();

        const captions = this.normalizeCaptionResponse(
          await this.aiProxyService.captions(
            {
              videoId,
              videoUrl: post.videoUrl,
              targetLanguage: 'ko',
              allowFallback: false,
              translateFallback: false,
              durationSeconds: 14400,
            },
            signal,
          ),
        );
        signal?.throwIfAborted();

        if (captions.provider === 'ai-service-unavailable') {
          throw new VideoAssetPreparationRetryableError('captions');
        }

        if (captions.segments.length === 0) {
          if (this.shouldUseNativeCaptionFallback(captions)) {
            return this.repository.updateVideoAsset(post.id, {
              status: 'partial',
              sourceLanguage: captions.sourceLanguage || 'youtube',
              sourceCaptionStatus: 'partial',
              translationStatus: 'partial',
              summaryStatus: 'partial',
              sourceSegments: [],
              translatedSegments: [],
              summarySections: [],
              transcriptBody: '',
              errorMessage:
                captions.message ||
                'YouTube player automatic captions will be used.',
            });
          }

          return this.repository.updateVideoAsset(post.id, {
            status: 'failed',
            sourceLanguage: captions.sourceLanguage,
            sourceCaptionStatus: 'failed',
            translationStatus: 'failed',
            summaryStatus: 'failed',
            sourceSegments: [],
            translatedSegments: [],
            summarySections: [],
            transcriptBody: '',
            errorMessage:
              captions.message || 'No caption segments were returned.',
          });
        }

        sourceSegments = captions.sourceSegments.length
          ? captions.sourceSegments
          : captions.segments;
        translatedSegments = captions.translated
          ? captions.translatedSegments
          : [];
        const translationErrorMessage =
          captions.message || 'Translated caption segments were not returned.';

        sourceCaptionStatus = 'ready';
        translationStatus =
          captions.translated && translatedSegments.length
            ? 'ready'
            : 'partial';

        await this.repository.updateVideoAsset(post.id, {
          status: translationStatus === 'ready' ? 'processing' : 'partial',
          sourceLanguage: captions.sourceLanguage,
          sourceCaptionStatus,
          translationStatus,
          sourceSegments,
          translatedSegments,
          errorMessage:
            translationStatus === 'ready' ? '' : translationErrorMessage,
        });
        signal?.throwIfAborted();
      } else {
        await this.repository.updateVideoAsset(post.id, {
          status: translationStatus === 'ready' ? 'processing' : 'partial',
          summaryStatus: 'pending',
          errorMessage: '',
        });
        signal?.throwIfAborted();
      }

      const segmentsForSummary = translatedSegments.length
        ? translatedSegments
        : sourceSegments;
      const translationErrorMessage =
        translationStatus === 'ready'
          ? ''
          : 'Translated caption segments were not returned.';
      const summary = this.normalizeSummaryResponse(
        await this.aiProxyService.summary(
          {
            videoId,
            title: post.title,
            channelName: post.channelName,
            language: 'ko',
            summary: post.summary,
            translatedNotes: post.translatedNotes,
            segments: segmentsForSummary,
          },
          signal,
        ),
      );
      signal?.throwIfAborted();
      if (summary.failed) {
        throw new VideoAssetPreparationRetryableError('summary');
      }
      const summaryStatus = summary.sections.length ? 'ready' : 'failed';
      const status: VideoAssetStatus =
        translationStatus === 'ready' && summaryStatus === 'ready'
          ? 'ready'
          : 'partial';

      signal?.throwIfAborted();
      return this.repository.updateVideoAsset(post.id, {
        status,
        summaryStatus,
        summarySections: summary.sections,
        transcriptBody: this.transcriptBody(
          summary.sections,
          segmentsForSummary,
        ),
        errorMessage:
          summaryStatus === 'ready'
            ? translationStatus === 'ready'
              ? ''
              : translationErrorMessage
            : summary.message || 'No summary sections were returned.',
      });
    } catch (error) {
      if (signal?.aborted) {
        throw signal.reason ?? error;
      }
      const sourceReady = sourceCaptionStatus === 'ready';
      try {
        await this.repository.updateVideoAsset(post.id, {
          status: 'processing',
          sourceCaptionStatus: sourceReady ? 'ready' : 'pending',
          translationStatus: sourceReady ? translationStatus : 'pending',
          summaryStatus: 'pending',
          errorMessage:
            error instanceof VideoAssetPreparationRetryableError
              ? error.safeMessage
              : 'Video asset provider is temporarily unavailable.',
        });
      } catch {
        // Preserve the provider failure so BullMQ can retry or dead-letter it.
      }
      throw error;
    }
  }

  private normalizeCaptionResponse(response: unknown): CaptionResponse {
    const value = this.objectValue(response);
    const segments = this.normalizeSegments(value.segments);
    const sourceSegments = this.normalizeSegments(value.sourceSegments);
    const translatedSegments = this.normalizeSegments(value.translatedSegments);

    return {
      provider: this.stringValue(value.provider),
      translated: value.translated === true,
      segments,
      sourceSegments,
      translatedSegments,
      sourceLanguage: this.stringValue(value.sourceLanguage),
      message: this.stringValue(value.message),
    };
  }

  private shouldUseNativeCaptionFallback(captions: CaptionResponse): boolean {
    return [
      'youtube-native-captions',
      'youtube-caption-rate-limited',
      'caption-source-unavailable',
    ].includes(captions.provider);
  }

  private normalizeSummaryResponse(response: unknown): SummaryResponse {
    const value = this.objectValue(response);

    return {
      sections: this.normalizeSummarySections(
        value.sections ?? value.summarySections,
      ),
      message: this.stringValue(value.message),
      failed:
        this.stringValue(value.provider) === 'ai-service-unavailable' ||
        this.stringValue(value.status) === 'failed' ||
        this.stringValue(value.mode) === 'ai-service-unavailable',
    };
  }

  private normalizeSegments(value: unknown): VideoAssetSegment[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.flatMap((item) => {
      const segment = this.objectValue(item);
      const start = Number(segment.start);
      const end = Number(segment.end);
      const text = this.stringValue(segment.text).trim();

      if (!Number.isFinite(start) || !Number.isFinite(end) || !text) {
        return [];
      }

      return [{ start, end, text }];
    });
  }

  private normalizeSummarySections(value: unknown): VideoAssetSummarySection[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.flatMap((item) => {
      const section = this.objectValue(item);
      const label = this.stringValue(section.label).trim();
      const body = this.stringValue(section.body).trim();

      if (!label || !body) {
        return [];
      }

      return [{ label, body }];
    });
  }

  private transcriptBody(
    sections: VideoAssetSummarySection[],
    segments: VideoAssetSegment[],
  ): string {
    const scripted = sections.find((section) => {
      return (
        section.label.includes('스크립트') || section.label.includes('전사문')
      );
    });

    if (scripted) {
      return scripted.body;
    }

    return segments
      .map((segment) => {
        return `[${this.timestamp(segment.start)}] ${segment.text}`;
      })
      .join('\n');
  }

  private timestamp(seconds: number): string {
    const normalized = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(normalized / 60);
    const remainder = normalized % 60;

    return `${minutes.toString().padStart(2, '0')}:${remainder
      .toString()
      .padStart(2, '0')}`;
  }

  private extractYoutubeVideoId(videoUrl: string): string | null {
    try {
      const url = new URL(videoUrl);
      const host = url.hostname.replace(/^www\./, '').toLowerCase();

      if (host === 'youtu.be') {
        return this.validVideoId(url.pathname.slice(1).split('/')[0]);
      }

      if (
        !host.endsWith('youtube.com') &&
        !host.endsWith('youtube-nocookie.com')
      ) {
        return null;
      }

      if (url.pathname === '/watch') {
        return this.validVideoId(url.searchParams.get('v'));
      }

      const match = url.pathname.match(
        /^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]+)/,
      );

      return this.validVideoId(match?.[1]);
    } catch {
      return null;
    }
  }

  private validVideoId(value: string | null | undefined): string | null {
    const trimmed = value?.trim() ?? '';

    return /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : null;
  }

  private objectValue(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  }

  private stringValue(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }
}

export class VideoAssetPreparationRetryableError extends Error {
  readonly code = 'VIDEO_ASSET_PROVIDER_UNAVAILABLE';
  readonly safeMessage: string;

  constructor(step: 'captions' | 'summary') {
    super(`Video asset ${step} provider is unavailable`);
    this.safeMessage = `Video asset ${step} provider is temporarily unavailable.`;
  }
}
