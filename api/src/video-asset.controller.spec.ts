import { BadRequestException } from '@nestjs/common';
import { VideoAssetController } from './video-asset.controller';
import type { StudyBoardService } from './study-board.service';
import type { StudyPost } from './study-board.types';
import type { VideoAssetService } from './video-asset.service';
import type { VideoAsset } from './video-asset.types';
import type { AuthenticatedRequest } from './auth/session.guard';

const asset: VideoAsset = {
  id: 11,
  postId: 42,
  videoId: 'postScopedVideo',
  videoUrl: 'https://www.youtube.com/watch?v=postScopedVideo',
  language: 'ko',
  sourceLanguage: '',
  status: 'processing',
  sourceCaptionStatus: 'pending',
  translationStatus: 'pending',
  summaryStatus: 'pending',
  sourceSegments: [],
  translatedSegments: [],
  summarySections: [],
  transcriptBody: '',
  errorMessage: '',
  createdAt: '2026-06-16T00:00:00.000Z',
  updatedAt: '2026-06-16T00:00:00.000Z',
};

const post: StudyPost = {
  id: 42,
  authorId: 7,
  authorName: 'Ada',
  title: 'Post-scoped asset lesson',
  videoUrl: 'https://www.youtube.com/watch?v=postScopedVideo',
  thumbnailUrl: 'https://i.ytimg.com/vi/postScopedVideo/hqdefault.jpg',
  channelName: 'StudyTube',
  summary: 'A lesson with a post-scoped video asset.',
  translatedNotes: 'Post-scoped asset notes.',
  tags: ['asset'],
  comments: [],
  createdAt: '2026-06-16T00:00:00.000Z',
  updatedAt: '2026-06-16T00:00:00.000Z',
};

describe('VideoAssetController', () => {
  let controller: VideoAssetController;
  let studyBoardService: jest.Mocked<
    Pick<StudyBoardService, 'getOwnedPost' | 'getVideoAsset'>
  >;
  let videoAssetService: jest.Mocked<
    Pick<VideoAssetService, 'preparePostAssetRequest'>
  >;
  const request = {
    principal: { userId: 7 },
  } as AuthenticatedRequest;

  beforeEach(() => {
    studyBoardService = {
      getOwnedPost: jest.fn(),
      getVideoAsset: jest.fn(),
    };
    videoAssetService = {
      preparePostAssetRequest: jest.fn(),
    };
    controller = new VideoAssetController(
      studyBoardService as unknown as StudyBoardService,
      videoAssetService as unknown as VideoAssetService,
    );
  });

  it('gets a post-owned video asset using the authenticated actor and post id', async () => {
    studyBoardService.getVideoAsset.mockResolvedValue(asset);

    await expect(controller.getAsset(request, '42')).resolves.toBe(asset);

    expect(studyBoardService.getVideoAsset).toHaveBeenCalledWith(
      { userId: 7 },
      42,
    );
  });

  it('prepares a post-owned video asset after validating the post owner session', async () => {
    studyBoardService.getOwnedPost.mockResolvedValue(post);
    videoAssetService.preparePostAssetRequest.mockResolvedValue(asset);

    await expect(controller.prepare(request, '42')).resolves.toBe(asset);

    expect(studyBoardService.getOwnedPost).toHaveBeenCalledWith(
      { userId: 7 },
      42,
    );
    expect(videoAssetService.preparePostAssetRequest).toHaveBeenCalledWith(
      post,
    );
  });

  it('rejects invalid post ids before calling services', async () => {
    expect(() => {
      void controller.getAsset(request, '0');
    }).toThrow(BadRequestException);
    await expect(
      controller.prepare(request, 'not-a-number'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(studyBoardService.getVideoAsset).not.toHaveBeenCalled();
    expect(studyBoardService.getOwnedPost).not.toHaveBeenCalled();
    expect(videoAssetService.preparePostAssetRequest).not.toHaveBeenCalled();
  });
});
