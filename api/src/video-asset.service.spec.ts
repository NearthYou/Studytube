import { AiProxyService } from './ai-proxy.service';
import { MemoryBoardRepository } from './memory-board.repository';
import type { StudyPost } from './study-board.types';
import {
  CaptionTranslationPendingError,
  VideoAssetPreparationRetryableError,
  VideoAssetService,
} from './video-asset.service';
import type {
  CaptionArtifactRepository,
  CaptionGeneration,
  CaptionPipelineRequest,
  CaptionSegmentBatch,
  UpdateVideoAssetInput,
} from './video-asset.types';

class RecordingRepository extends MemoryBoardRepository {
  readonly updatedPostIds: number[] = [];
  readonly requestedPostIds: number[] = [];

  override async requestVideoAssetPreparation(
    input: Parameters<MemoryBoardRepository['requestVideoAssetPreparation']>[0],
  ) {
    this.requestedPostIds.push(input.postId);
    return super.requestVideoAssetPreparation(input);
  }

  override async updateVideoAsset(
    postId: number,
    input: UpdateVideoAssetInput,
  ) {
    this.updatedPostIds.push(postId);

    return super.updateVideoAsset(postId, input);
  }
}

describe('VideoAssetService', () => {
  it('prepares a translated video asset and persists updates by post id', async () => {
    const repository = new RecordingRepository();
    const captions = jest.fn().mockResolvedValue({
      translated: true,
      sourceLanguage: 'en',
      message: '',
      segments: [
        { start: 0, end: 4, text: '안녕하세요' },
        { start: 65, end: 70, text: '리액트 훅을 배웁니다' },
      ],
      sourceSegments: [
        { start: 0, end: 4, text: 'Hello' },
        { start: 65, end: 70, text: 'We learn React hooks' },
      ],
      translatedSegments: [
        { start: 0, end: 4, text: '안녕하세요' },
        { start: 65, end: 70, text: '리액트 훅을 배웁니다' },
      ],
    });
    const summary = jest.fn().mockResolvedValue({
      sections: [
        { label: '핵심 요약', body: '리액트 훅의 흐름을 설명합니다.' },
        { label: '스크립트', body: '전체 한국어 전사문입니다.' },
      ],
    });
    const service = new VideoAssetService(repository, {
      captions,
      summary,
    } as AiProxyService);
    const post = await repository.createPost({
      authorId: 1,
      title: 'React hooks lesson',
      videoUrl: 'https://www.youtube.com/watch?v=assetSuccess',
      thumbnailUrl: 'https://i.ytimg.com/vi/assetSuccess/hqdefault.jpg',
      channelName: 'StudyTube',
      summary: 'Hooks overview.',
      translatedNotes: 'Hooks Korean notes.',
      tags: ['react', 'hooks'],
    });

    await expect(service.preparePostAsset(post)).resolves.toMatchObject({
      postId: post.id,
      videoId: 'assetSuccess',
      videoUrl: post.videoUrl,
      language: 'ko',
      sourceLanguage: 'en',
      status: 'ready',
      sourceCaptionStatus: 'ready',
      translationStatus: 'ready',
      summaryStatus: 'ready',
      sourceSegments: [
        { start: 0, end: 4, text: 'Hello' },
        { start: 65, end: 70, text: 'We learn React hooks' },
      ],
      translatedSegments: [
        { start: 0, end: 4, text: '안녕하세요' },
        { start: 65, end: 70, text: '리액트 훅을 배웁니다' },
      ],
      summarySections: [
        { label: '핵심 요약', body: '리액트 훅의 흐름을 설명합니다.' },
        { label: '스크립트', body: '전체 한국어 전사문입니다.' },
      ],
      transcriptBody: '전체 한국어 전사문입니다.',
      errorMessage: '',
    });

    expect(repository.updatedPostIds).toEqual(
      repository.updatedPostIds.map(() => post.id),
    );
    expect(captions).toHaveBeenCalledWith(
      {
        videoId: 'assetSuccess',
        videoUrl: post.videoUrl,
        targetLanguage: 'ko',
        allowFallback: false,
        translateFallback: false,
        durationSeconds: 14400,
      },
      undefined,
    );
    expect(summary).toHaveBeenCalledWith(
      expect.objectContaining({
        videoId: 'assetSuccess',
        title: post.title,
        channelName: post.channelName,
        language: 'ko',
        summary: post.summary,
        translatedNotes: post.translatedNotes,
        segments: [
          { start: 0, end: 4, text: '안녕하세요' },
          { start: 65, end: 70, text: '리액트 훅을 배웁니다' },
        ],
      }),
      undefined,
    );
  });

  it('returns a matching ready asset without repeating provider calls', async () => {
    const repository = new RecordingRepository();
    const captions = jest.fn();
    const summary = jest.fn();
    const service = new VideoAssetService(repository, {
      captions,
      summary,
    } as unknown as AiProxyService);
    const post = await repository.createPost({
      authorId: 1,
      title: 'Already prepared lesson',
      videoUrl: 'https://www.youtube.com/watch?v=readyAsset',
      thumbnailUrl: 'https://i.ytimg.com/vi/readyAsset/hqdefault.jpg',
      channelName: 'StudyTube',
      summary: 'Ready asset.',
      translatedNotes: 'Ready asset notes.',
      tags: ['asset'],
    });
    await repository.upsertVideoAsset({
      postId: post.id,
      videoId: 'readyAsset',
      videoUrl: post.videoUrl,
      language: 'ko',
    });
    const ready = await repository.updateVideoAsset(post.id, {
      status: 'ready',
      sourceLanguage: 'en',
      sourceCaptionStatus: 'ready',
      translationStatus: 'ready',
      summaryStatus: 'ready',
      sourceSegments: [{ start: 0, end: 2, text: 'Ready source' }],
      translatedSegments: [{ start: 0, end: 2, text: '준비된 번역' }],
      summarySections: [{ label: '핵심 요약', body: '준비된 요약' }],
      transcriptBody: '준비된 번역',
      errorMessage: '',
    });

    await expect(service.preparePostAsset(post)).resolves.toEqual(ready);
    expect(captions).not.toHaveBeenCalled();
    expect(summary).not.toHaveBeenCalled();
  });

  it('resumes summary generation from persisted captions after a worker restart', async () => {
    const repository = new RecordingRepository();
    const captions = jest.fn();
    const summary = jest.fn().mockResolvedValue({
      sections: [{ label: '핵심 요약', body: '재개된 요약입니다.' }],
    });
    const service = new VideoAssetService(repository, {
      captions,
      summary,
    } as unknown as AiProxyService);
    const post = await repository.createPost({
      authorId: 1,
      title: 'Resume persisted captions',
      videoUrl: 'https://www.youtube.com/watch?v=resumeSummary',
      thumbnailUrl: 'https://i.ytimg.com/vi/resumeSummary/hqdefault.jpg',
      channelName: 'StudyTube',
      summary: 'Resume summary.',
      translatedNotes: 'Resume summary notes.',
      tags: ['asset'],
    });
    const sourceSegments = [
      { start: 0, end: 3, text: 'Persisted source caption' },
    ];
    const translatedSegments = [{ start: 0, end: 3, text: '저장된 번역 자막' }];
    await repository.upsertVideoAsset({
      postId: post.id,
      videoId: 'resumeSummary',
      videoUrl: post.videoUrl,
      language: 'ko',
    });
    await repository.updateVideoAsset(post.id, {
      status: 'processing',
      sourceLanguage: 'en',
      sourceCaptionStatus: 'ready',
      translationStatus: 'ready',
      summaryStatus: 'pending',
      sourceSegments,
      translatedSegments,
      summarySections: [],
      transcriptBody: '',
      errorMessage: 'Worker stopped before summary persistence.',
    });

    await expect(service.preparePostAsset(post)).resolves.toMatchObject({
      status: 'ready',
      sourceCaptionStatus: 'ready',
      translationStatus: 'ready',
      summaryStatus: 'ready',
      sourceSegments,
      translatedSegments,
      summarySections: [{ label: '핵심 요약', body: '재개된 요약입니다.' }],
    });
    expect(captions).not.toHaveBeenCalled();
    expect(summary).toHaveBeenCalledWith(
      expect.objectContaining({
        videoId: 'resumeSummary',
        segments: translatedSegments,
      }),
      undefined,
    );
  });

  it('marks the post-scoped asset failed when caption retrieval returns no segments', async () => {
    const repository = new RecordingRepository();
    const captions = jest.fn().mockResolvedValue({
      translated: false,
      sourceLanguage: 'unavailable',
      segments: [],
      message: 'No captions were found.',
    });
    const summary = jest.fn();
    const service = new VideoAssetService(repository, {
      captions,
      summary,
    } as AiProxyService);
    const post = await repository.createPost({
      authorId: 1,
      title: 'Missing captions lesson',
      videoUrl: 'https://youtu.be/missingCaptions',
      thumbnailUrl: 'https://i.ytimg.com/vi/missingCaptions/hqdefault.jpg',
      channelName: 'StudyTube',
      summary: 'Caption failure case.',
      translatedNotes: 'Caption failure notes.',
      tags: ['captions'],
    });

    await expect(service.preparePostAsset(post)).resolves.toMatchObject({
      postId: post.id,
      videoId: 'missingCaptions',
      status: 'failed',
      sourceLanguage: 'unavailable',
      sourceCaptionStatus: 'failed',
      translationStatus: 'failed',
      summaryStatus: 'failed',
      sourceSegments: [],
      translatedSegments: [],
      summarySections: [],
      transcriptBody: '',
      errorMessage: 'No captions were found.',
    });

    expect(repository.updatedPostIds).toEqual(
      repository.updatedPostIds.map(() => post.id),
    );
    expect(summary).not.toHaveBeenCalled();
  });

  it('rethrows transient provider failures without persisting secret text', async () => {
    const repository = new RecordingRepository();
    const providerFailure = new Error('Bearer caption-provider-secret-canary');
    const service = new VideoAssetService(repository, {
      captions: jest.fn().mockRejectedValue(providerFailure),
      summary: jest.fn(),
    } as unknown as AiProxyService);
    const post = await repository.createPost({
      authorId: 1,
      title: 'Transient caption failure',
      videoUrl: 'https://www.youtube.com/watch?v=transientCaption',
      thumbnailUrl: 'https://i.ytimg.com/vi/transientCaption/hqdefault.jpg',
      channelName: 'StudyTube',
      summary: 'Transient caption provider failure.',
      translatedNotes: 'Transient caption provider failure notes.',
      tags: ['captions'],
    });

    await expect(service.preparePostAsset(post)).rejects.toBe(providerFailure);
    const asset = await repository.findVideoAsset(post.id);
    expect(asset).toMatchObject({
      status: 'processing',
      sourceCaptionStatus: 'pending',
      translationStatus: 'pending',
      summaryStatus: 'pending',
      errorMessage: 'Video asset provider is temporarily unavailable.',
    });
    expect(JSON.stringify(asset)).not.toContain(
      'caption-provider-secret-canary',
    );
  });

  it('stores rate-limited caption responses as partial native-caption fallback assets', async () => {
    const repository = new RecordingRepository();
    const captions = jest.fn().mockResolvedValue({
      provider: 'youtube-caption-rate-limited',
      translated: false,
      sourceLanguage: 'youtube',
      segments: [],
      message: 'YouTube timed-text caption download was blocked with HTTP 429.',
    });
    const summary = jest.fn();
    const service = new VideoAssetService(repository, {
      captions,
      summary,
    } as AiProxyService);
    const post = await repository.createPost({
      authorId: 1,
      title: 'Rate limited captions lesson',
      videoUrl: 'https://youtu.be/rateLimited',
      thumbnailUrl: 'https://i.ytimg.com/vi/rateLimited/hqdefault.jpg',
      channelName: 'StudyTube',
      summary: 'Caption rate limit case.',
      translatedNotes: 'Caption rate limit notes.',
      tags: ['captions'],
    });

    await expect(service.preparePostAsset(post)).resolves.toMatchObject({
      postId: post.id,
      videoId: 'rateLimited',
      status: 'partial',
      sourceLanguage: 'youtube',
      sourceCaptionStatus: 'partial',
      translationStatus: 'partial',
      summaryStatus: 'partial',
      sourceSegments: [],
      translatedSegments: [],
      summarySections: [],
      transcriptBody: '',
      errorMessage:
        'YouTube timed-text caption download was blocked with HTTP 429.',
    });

    expect(summary).not.toHaveBeenCalled();
  });

  it('keeps persisted captions and retries an unavailable summary provider', async () => {
    const repository = new RecordingRepository();
    const captions = jest.fn().mockResolvedValue({
      translated: true,
      sourceLanguage: 'en',
      segments: [{ start: 0, end: 8, text: '번역된 도입부입니다' }],
      sourceSegments: [{ start: 0, end: 8, text: 'Translated intro' }],
      translatedSegments: [{ start: 0, end: 8, text: '번역된 도입부입니다' }],
    });
    const summary = jest.fn().mockResolvedValue({
      provider: 'ai-service-unavailable',
      sections: [
        { label: '전사문', body: '사용하면 안 되는 fallback 섹션입니다.' },
      ],
      message:
        'FastAPI summary service did not respond before the proxy timeout.',
    });
    const service = new VideoAssetService(repository, {
      captions,
      summary,
    } as AiProxyService);
    const post = await repository.createPost({
      authorId: 1,
      title: 'Summary fallback lesson',
      videoUrl: 'https://www.youtube.com/watch?v=summaryFallback',
      thumbnailUrl: 'https://i.ytimg.com/vi/summaryFallback/hqdefault.jpg',
      channelName: 'StudyTube',
      summary: 'Summary fallback case.',
      translatedNotes: 'Summary fallback notes.',
      tags: ['summary'],
    });

    await expect(service.preparePostAsset(post)).rejects.toBeInstanceOf(
      VideoAssetPreparationRetryableError,
    );
    await expect(repository.findVideoAsset(post.id)).resolves.toMatchObject({
      postId: post.id,
      status: 'processing',
      sourceCaptionStatus: 'ready',
      translationStatus: 'ready',
      summaryStatus: 'pending',
      summarySections: [],
      transcriptBody: '',
      errorMessage: 'Video asset summary provider is temporarily unavailable.',
    });
  });

  it('does not mark translation ready when translated segments are missing', async () => {
    const repository = new RecordingRepository();
    const sourceSegments = [
      { start: 0, end: 5, text: 'Hello from the source captions' },
      { start: 75, end: 80, text: 'Second source caption' },
    ];
    const captions = jest.fn().mockResolvedValue({
      translated: true,
      sourceLanguage: 'en',
      segments: sourceSegments,
      sourceSegments,
      translatedSegments: [],
    });
    const summary = jest.fn().mockResolvedValue({
      sections: [
        { label: '핵심 요약', body: 'Source captions were summarized.' },
      ],
    });
    const service = new VideoAssetService(repository, {
      captions,
      summary,
    } as AiProxyService);
    const post = await repository.createPost({
      authorId: 1,
      title: 'Missing translated segments lesson',
      videoUrl: 'https://www.youtube.com/watch?v=missingTranslation',
      thumbnailUrl: 'https://i.ytimg.com/vi/missingTranslation/hqdefault.jpg',
      channelName: 'StudyTube',
      summary: 'Missing translation case.',
      translatedNotes: 'Missing translation notes.',
      tags: ['translation'],
    });

    await expect(service.preparePostAsset(post)).resolves.toMatchObject({
      postId: post.id,
      status: 'partial',
      sourceCaptionStatus: 'ready',
      translationStatus: 'partial',
      summaryStatus: 'ready',
      sourceSegments,
      translatedSegments: [],
      errorMessage: 'Translated caption segments were not returned.',
    });
    expect(summary).toHaveBeenCalledWith(
      expect.objectContaining({
        segments: sourceSegments,
      }),
      undefined,
    );
  });

  it('persists a processing request without starting work in the API process', async () => {
    const repository = new RecordingRepository();
    class ManualPrepareProbeService extends VideoAssetService {
      readonly started: StudyPost[] = [];

      override preparePostAsset(post: StudyPost): Promise<null> {
        this.started.push(post);

        return new Promise(() => undefined);
      }
    }
    const service = new ManualPrepareProbeService(repository, {
      captions: jest.fn(),
      summary: jest.fn(),
    } as unknown as AiProxyService);
    const post = await repository.createPost({
      authorId: 1,
      title: 'Manual prepare lesson',
      videoUrl: 'https://www.youtube.com/watch?v=manualPrepare',
      thumbnailUrl: 'https://i.ytimg.com/vi/manualPrepare/hqdefault.jpg',
      channelName: 'StudyTube',
      summary: 'Manual prepare should return quickly.',
      translatedNotes: 'Manual prepare notes.',
      tags: ['asset'],
    });

    await expect(service.preparePostAssetRequest(post)).resolves.toMatchObject({
      postId: post.id,
      videoId: 'manualPrepare',
      videoUrl: post.videoUrl,
      status: 'processing',
      sourceCaptionStatus: 'pending',
      translationStatus: 'pending',
      summaryStatus: 'pending',
      errorMessage: '',
    });

    await expect(repository.findVideoAsset(post.id)).resolves.toMatchObject({
      postId: post.id,
      status: 'processing',
    });
    expect(service.started).toEqual([]);
    expect(repository.requestedPostIds).toEqual([post.id]);
  });

  it('keeps duplicate manual requests in the durable queue boundary', async () => {
    const repository = new RecordingRepository();
    const captions = jest.fn();
    const summary = jest.fn();
    const service = new VideoAssetService(repository, {
      captions,
      summary,
    } as unknown as AiProxyService);
    const post = await repository.createPost({
      authorId: 1,
      title: 'Duplicate durable request lesson',
      videoUrl: 'https://www.youtube.com/watch?v=duplicateActive',
      thumbnailUrl: 'https://i.ytimg.com/vi/duplicateActive/hqdefault.jpg',
      channelName: 'StudyTube',
      summary: 'Duplicate requests remain outside the API worker.',
      translatedNotes: 'Duplicate durable request notes.',
      tags: ['asset'],
    });

    await expect(service.preparePostAssetRequest(post)).resolves.toMatchObject({
      status: 'processing',
    });
    await expect(service.preparePostAssetRequest(post)).resolves.toMatchObject({
      status: 'processing',
      sourceCaptionStatus: 'pending',
      translationStatus: 'pending',
      summaryStatus: 'pending',
    });
    expect(repository.requestedPostIds).toEqual([post.id, post.id]);
    expect(captions).not.toHaveBeenCalled();
    expect(summary).not.toHaveBeenCalled();
  });

  it('replaces a ready asset when the post video url changes', async () => {
    const repository = new RecordingRepository();
    const service = new VideoAssetService(repository, {
      captions: jest.fn(),
      summary: jest.fn(),
    } as unknown as AiProxyService);
    const post = await repository.createPost({
      authorId: 1,
      title: 'Changed video lesson',
      videoUrl: 'https://www.youtube.com/watch?v=oldVideo',
      thumbnailUrl: 'https://i.ytimg.com/vi/oldVideo/hqdefault.jpg',
      channelName: 'StudyTube',
      summary: 'Changing the video should replace the asset.',
      translatedNotes: 'Changed video notes.',
      tags: ['asset'],
    });
    await repository.upsertVideoAsset({
      postId: post.id,
      videoId: 'oldVideo',
      videoUrl: post.videoUrl,
      language: 'ko',
    });
    await repository.updateVideoAsset(post.id, {
      status: 'ready',
      sourceCaptionStatus: 'ready',
      translationStatus: 'ready',
      summaryStatus: 'ready',
      translatedSegments: [{ start: 0, end: 2, text: 'old transcript' }],
      transcriptBody: 'old transcript',
    });
    const updatedPost = await repository.updatePost(post.id, {
      videoUrl: 'https://www.youtube.com/watch?v=newVideo',
    });

    await expect(
      service.preparePostAssetRequest(updatedPost!),
    ).resolves.toMatchObject({
      postId: post.id,
      videoId: 'newVideo',
      videoUrl: 'https://www.youtube.com/watch?v=newVideo',
      status: 'processing',
      sourceCaptionStatus: 'pending',
      translationStatus: 'pending',
      summaryStatus: 'pending',
    });

    await expect(repository.findVideoAsset(post.id)).resolves.toMatchObject({
      postId: post.id,
      videoId: 'newVideo',
      videoUrl: 'https://www.youtube.com/watch?v=newVideo',
      status: 'processing',
      translatedSegments: [],
      transcriptBody: '',
    });
    expect(repository.requestedPostIds).toEqual([post.id]);
  });

  it('retries a persisted processing asset when no job is active', async () => {
    const repository = new RecordingRepository();
    const service = new VideoAssetService(repository, {
      captions: jest.fn(),
      summary: jest.fn(),
    } as unknown as AiProxyService);
    const post = await repository.createPost({
      authorId: 1,
      title: 'Restarted processing lesson',
      videoUrl: 'https://www.youtube.com/watch?v=stuckProcessing',
      thumbnailUrl: 'https://i.ytimg.com/vi/stuckProcessing/hqdefault.jpg',
      channelName: 'StudyTube',
      summary: 'A processing asset can outlive its worker.',
      translatedNotes: 'Restarted processing notes.',
      tags: ['asset'],
    });
    await repository.upsertVideoAsset({
      postId: post.id,
      videoId: 'stuckProcessing',
      videoUrl: post.videoUrl,
      language: 'ko',
    });
    await repository.updateVideoAsset(post.id, {
      status: 'processing',
      sourceCaptionStatus: 'ready',
      translationStatus: 'ready',
      summaryStatus: 'pending',
      translatedSegments: [{ start: 0, end: 2, text: 'stuck transcript' }],
      errorMessage: 'Worker disappeared before summary finished.',
    });

    await expect(service.preparePostAssetRequest(post)).resolves.toMatchObject({
      postId: post.id,
      videoId: 'stuckProcessing',
      videoUrl: post.videoUrl,
      status: 'processing',
      sourceCaptionStatus: 'pending',
      translationStatus: 'pending',
      summaryStatus: 'pending',
      errorMessage: '',
    });

    expect(repository.requestedPostIds).toEqual([post.id]);
  });
});

describe('VideoAssetService learning caption generations', () => {
  const request: CaptionPipelineRequest = {
    eventId: '11111111-1111-4111-8111-111111111111',
    handlerVersion: 'learning-caption-v1',
    leaseToken: '22222222-2222-4222-8222-222222222222',
    canonicalVideoId: 'caption0001',
    targetLanguage: 'ko',
    durationSeconds: 120,
  };

  it('publishes YouTube source and translated segments without transcription', async () => {
    const artifacts = new RecordingCaptionArtifacts();
    const transcribe = jest.fn();
    const service = new VideoAssetService(
      new RecordingRepository(),
      {
        captions: jest.fn().mockResolvedValue({
          provider: 'youtube-timedtext',
          sourceLanguage: 'en',
          translated: true,
          sourceSegments: [
            { start: 0, end: 2, text: 'hello' },
            { start: 2, end: 4, text: 'world' },
          ],
          translatedSegments: [
            { start: 0, end: 2, text: '안녕하세요' },
            { start: 2, end: 4, text: '세계' },
          ],
          segments: [],
          message: '',
        }),
        transcribe,
        summary: jest.fn(),
      } as unknown as AiProxyService,
      artifacts,
    );

    await expect(service.prepareLearningCaptions(request)).resolves.toEqual({
      sourceArtifactId: '1',
      translationArtifactId: '2',
      source: 'youtube_caption',
      status: 'ready',
    });
    expect(transcribe).not.toHaveBeenCalled();
    expect(artifacts.batches).toEqual([
      {
        artifactId: '1',
        segments: [
          { ordinal: 0, start: 0, end: 2, text: 'hello' },
          { ordinal: 1, start: 2, end: 4, text: 'world' },
        ],
      },
      {
        artifactId: '2',
        segments: [
          { ordinal: 0, start: 0, end: 2, text: '안녕하세요' },
          { ordinal: 1, start: 2, end: 4, text: '세계' },
        ],
      },
    ]);
    expect(artifacts.published).toEqual(['1', '2']);
    expect(artifacts.committedCosts).toEqual([0]);
  });

  it('does not request audio transcription without active cost approval', async () => {
    const artifacts = new RecordingCaptionArtifacts();
    const transcribe = jest.fn();
    const service = new VideoAssetService(
      new RecordingRepository(),
      {
        captions: jest.fn().mockResolvedValue({
          provider: 'youtube-caption-rate-limited',
          sourceLanguage: '',
          translated: false,
          sourceSegments: [],
          translatedSegments: [],
          segments: [],
          message:
            'Bearer credential-canary https://u:p@example.invalid/?token=query-canary',
        }),
        transcribe,
        summary: jest.fn(),
      } as unknown as AiProxyService,
      artifacts,
    );

    await expect(service.prepareLearningCaptions(request)).resolves.toEqual({
      sourceArtifactId: null,
      translationArtifactId: null,
      source: 'none',
      status: 'failed',
      errorCode: 'STT_NOT_APPROVED',
    });
    expect(transcribe).not.toHaveBeenCalled();
    expect(artifacts.failures).toEqual(['STT_NOT_APPROVED']);
    expect(JSON.stringify(artifacts.failures)).not.toContain(
      'credential-canary',
    );
    expect(JSON.stringify(artifacts.failures)).not.toContain('query-canary');
  });

  it('uses an approved fake transcription response and publishes appended segments', async () => {
    const artifacts = new RecordingCaptionArtifacts();
    artifacts.sttApproved = true;
    const transcribe = jest.fn().mockResolvedValue({
      provider: 'fake-transcription',
      status: 'ready',
      sourceLanguage: 'zh',
      segments: [
        { start: 0, end: 3, text: '你好' },
        { start: 3, end: 6, text: '世界' },
      ],
      errorCode: '',
    });
    const service = new VideoAssetService(
      new RecordingRepository(),
      {
        captions: jest.fn().mockResolvedValue({
          provider: 'youtube-native-captions',
          sourceLanguage: '',
          translated: false,
          sourceSegments: [],
          translatedSegments: [],
          segments: [],
          message: '',
        }),
        transcribe,
        summary: jest.fn(),
      } as unknown as AiProxyService,
      artifacts,
    );

    await expect(
      service.prepareLearningCaptions(request),
    ).rejects.toBeInstanceOf(CaptionTranslationPendingError);
    expect(transcribe).toHaveBeenCalledWith(
      {
        videoId: request.canonicalVideoId,
        durationSeconds: request.durationSeconds,
        model: 'gpt-4o-mini-transcribe-2025-12-15',
      },
      expect.any(AbortSignal),
    );
    expect(artifacts.events).toEqual([
      'create:transcription:1',
      'append:1:2',
      'publish:1',
    ]);
    expect(artifacts.committedCosts).toEqual([]);
  });

  it('completes without translation when the source is already Korean', async () => {
    const artifacts = new RecordingCaptionArtifacts();
    const service = new VideoAssetService(
      new RecordingRepository(),
      {
        captions: jest.fn().mockResolvedValue({
          provider: 'youtube-timedtext',
          sourceLanguage: 'ko',
          translated: false,
          sourceSegments: [{ start: 0, end: 2, text: '안녕하세요' }],
          translatedSegments: [],
          segments: [],
          message: '',
        }),
        transcribe: jest.fn(),
        summary: jest.fn(),
      } as unknown as AiProxyService,
      artifacts,
    );

    await expect(service.prepareLearningCaptions(request)).resolves.toEqual({
      sourceArtifactId: '1',
      translationArtifactId: null,
      source: 'youtube_caption',
      status: 'ready',
    });
    expect(artifacts.committedCosts).toEqual([0]);
  });

  it('stops before a pointer update after losing the durable lease', async () => {
    const artifacts = new RecordingCaptionArtifacts();
    artifacts.acceptAppend = false;
    const service = new VideoAssetService(
      new RecordingRepository(),
      {
        captions: jest.fn().mockResolvedValue({
          provider: 'youtube-timedtext',
          sourceLanguage: 'en',
          translated: false,
          sourceSegments: [{ start: 0, end: 1, text: 'late' }],
          translatedSegments: [],
          segments: [],
          message: '',
        }),
        transcribe: jest.fn(),
        summary: jest.fn(),
      } as unknown as AiProxyService,
      artifacts,
    );

    await expect(
      service.prepareLearningCaptions(request),
    ).rejects.toMatchObject({
      code: 'CAPTION_LEASE_LOST',
    });
    expect(artifacts.published).toEqual([]);
  });
});

class RecordingCaptionArtifacts implements CaptionArtifactRepository {
  sttApproved = false;
  acceptAppend = true;
  batches: Array<Pick<CaptionSegmentBatch, 'artifactId' | 'segments'>> = [];
  published: string[] = [];
  failures: string[] = [];
  events: string[] = [];
  committedCosts: number[] = [];
  private nextId = 1;

  hasActiveSttApproval(): Promise<boolean> {
    return Promise.resolve(this.sttApproved);
  }

  createGeneration(input: {
    kind: 'youtube_caption' | 'transcription' | 'translation';
    parentArtifactId?: string;
    sourceLanguage: string;
    targetLanguage?: string;
    request: CaptionPipelineRequest;
  }): Promise<CaptionGeneration> {
    const id = String(this.nextId++);
    this.events.push(`create:${input.kind}:${id}`);
    return Promise.resolve({ id, generation: this.nextId - 1 });
  }

  appendSegments(input: CaptionSegmentBatch): Promise<boolean> {
    this.events.push(`append:${input.artifactId}:${input.segments.length}`);
    this.batches.push({
      artifactId: input.artifactId,
      segments: input.segments,
    });
    return Promise.resolve(this.acceptAppend);
  }

  publishGeneration(input: {
    artifactId: string;
    request: CaptionPipelineRequest;
  }): Promise<boolean> {
    this.events.push(`publish:${input.artifactId}`);
    if (this.acceptAppend) this.published.push(input.artifactId);
    return Promise.resolve(this.acceptAppend);
  }

  failGeneration(input: { errorCode: string }): Promise<void> {
    this.failures.push(input.errorCode);
    return Promise.resolve();
  }

  commitWork(input: { actualCostMicrounits: number }): Promise<void> {
    this.committedCosts.push(input.actualCostMicrounits);
    return Promise.resolve();
  }
}
