import { AiProxyService } from './ai-proxy.service';
import { MemoryBoardRepository } from './memory-board.repository';
import type { StudyPost } from './study-board.types';
import { VideoAssetService } from './video-asset.service';
import type { UpdateVideoAssetInput } from './video-asset.types';

class RecordingRepository extends MemoryBoardRepository {
  readonly updatedPostIds: number[] = [];

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
    expect(captions).toHaveBeenCalledWith({
      videoId: 'assetSuccess',
      videoUrl: post.videoUrl,
      targetLanguage: 'ko',
      allowFallback: false,
      translateFallback: false,
      durationSeconds: 14400,
    });
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

  it('treats AI summary fallback sections as failed and keeps a partial asset', async () => {
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

    await expect(service.preparePostAsset(post)).resolves.toMatchObject({
      postId: post.id,
      status: 'partial',
      sourceCaptionStatus: 'ready',
      translationStatus: 'ready',
      summaryStatus: 'failed',
      summarySections: [
        { label: '전사문', body: '사용하면 안 되는 fallback 섹션입니다.' },
      ],
      transcriptBody: '사용하면 안 되는 fallback 섹션입니다.',
      errorMessage:
        'FastAPI summary service did not respond before the proxy timeout.',
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
    );
  });

  it('continues queued jobs after an escaped job failure', async () => {
    const repository = new MemoryBoardRepository();
    const preparePostAsset = jest
      .fn<Promise<null>, [StudyPost]>()
      .mockRejectedValueOnce(new Error('escaped job failure'))
      .mockResolvedValue(null);
    class QueueProbeService extends VideoAssetService {
      override preparePostAsset(post: StudyPost): Promise<null> {
        return preparePostAsset(post);
      }
    }
    const service = new QueueProbeService(repository, {
      captions: jest.fn(),
      summary: jest.fn(),
    } as unknown as AiProxyService);
    const firstPost = await repository.createPost({
      authorId: 1,
      title: 'Failing queued lesson',
      videoUrl: 'https://www.youtube.com/watch?v=queueFail',
      thumbnailUrl: 'https://i.ytimg.com/vi/queueFail/hqdefault.jpg',
      channelName: 'StudyTube',
      summary: 'Queue failure case.',
      translatedNotes: 'Queue failure notes.',
      tags: ['queue'],
    });
    const secondPost = await repository.createPost({
      authorId: 1,
      title: 'Later queued lesson',
      videoUrl: 'https://www.youtube.com/watch?v=queueLater',
      thumbnailUrl: 'https://i.ytimg.com/vi/queueLater/hqdefault.jpg',
      channelName: 'StudyTube',
      summary: 'Queue recovery case.',
      translatedNotes: 'Queue recovery notes.',
      tags: ['queue'],
    });

    service.enqueuePost(firstPost);
    await waitFor(() => {
      expect(preparePostAsset).toHaveBeenCalledWith(firstPost);
    });

    service.enqueuePost(secondPost);
    await waitFor(() => {
      expect(preparePostAsset).toHaveBeenCalledWith(secondPost);
    });
  });

  it('creates a processing post-scoped asset before starting preparation', async () => {
    const repository = new MemoryBoardRepository();
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
    await waitFor(() => {
      expect(service.started).toEqual([post]);
    });
  });

  it('does not reset persisted caption statuses during duplicate active prepares', async () => {
    const repository = new MemoryBoardRepository();
    let resolveSummary!: (value: {
      sections: { label: string; body: string }[];
    }) => void;
    const summaryResponse = new Promise<{
      sections: { label: string; body: string }[];
    }>((resolve) => {
      resolveSummary = resolve;
    });
    const captions = jest.fn().mockResolvedValue({
      translated: true,
      sourceLanguage: 'en',
      segments: [{ start: 0, end: 4, text: 'Translated intro' }],
      sourceSegments: [{ start: 0, end: 4, text: 'Source intro' }],
      translatedSegments: [{ start: 0, end: 4, text: 'Translated intro' }],
    });
    const summary = jest.fn().mockReturnValue(summaryResponse);
    const service = new VideoAssetService(repository, {
      captions,
      summary,
    } as unknown as AiProxyService);
    const post = await repository.createPost({
      authorId: 1,
      title: 'Duplicate active prepare lesson',
      videoUrl: 'https://www.youtube.com/watch?v=duplicateActive',
      thumbnailUrl: 'https://i.ytimg.com/vi/duplicateActive/hqdefault.jpg',
      channelName: 'StudyTube',
      summary: 'Duplicate active prepare should be idempotent.',
      translatedNotes: 'Duplicate active prepare notes.',
      tags: ['asset'],
    });

    await service.preparePostAssetRequest(post);
    await waitFor(async () => {
      await expect(repository.findVideoAsset(post.id)).resolves.toMatchObject({
        status: 'processing',
        sourceCaptionStatus: 'ready',
        translationStatus: 'ready',
        summaryStatus: 'pending',
      });
    });

    await expect(service.preparePostAssetRequest(post)).resolves.toMatchObject({
      status: 'processing',
      sourceCaptionStatus: 'ready',
      translationStatus: 'ready',
      summaryStatus: 'pending',
    });
    await expect(repository.findVideoAsset(post.id)).resolves.toMatchObject({
      status: 'processing',
      sourceCaptionStatus: 'ready',
      translationStatus: 'ready',
      summaryStatus: 'pending',
    });
    expect(captions).toHaveBeenCalledTimes(1);
    expect(summary).toHaveBeenCalledTimes(1);

    resolveSummary({
      sections: [{ label: 'Summary', body: 'Prepared once.' }],
    });
    await waitFor(async () => {
      await expect(repository.findVideoAsset(post.id)).resolves.toMatchObject({
        status: 'ready',
      });
    });
  });

  it('replaces a ready asset when the post video url changes', async () => {
    const repository = new MemoryBoardRepository();
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
    });
    await waitFor(() => {
      expect(service.started).toEqual([
        expect.objectContaining({
          id: post.id,
          videoUrl: 'https://www.youtube.com/watch?v=newVideo',
        }),
      ]);
    });
  });

  it('retries a persisted processing asset when no job is active', async () => {
    const repository = new MemoryBoardRepository();
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

    await waitFor(() => {
      expect(service.started).toEqual([post]);
    });
  });
});

async function waitFor(assertion: () => void | Promise<void>): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
    }
  }

  throw lastError;
}
