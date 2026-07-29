import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CourseCutoverPolicy } from './course/course-cutover.policy';
import { MemoryBoardRepository } from './memory-board.repository';
import { StudyBoardService, type BoardActor } from './study-board.service';
import type { VideoAssetService } from './video-asset.service';

const learner: BoardActor = Object.freeze({ userId: 1 });
const curator: BoardActor = Object.freeze({ userId: 2 });
const outsider: BoardActor = Object.freeze({ userId: 3 });

describe('StudyBoardService', () => {
  let service: StudyBoardService;

  beforeEach(() => {
    service = new StudyBoardService(new MemoryBoardRepository());
  });

  it('scopes the private board to the authenticated actor', async () => {
    const created = await service.createPost(learner, postInput('private-one'));

    const ownerBoard = await service.listPosts(learner, { pageSize: 48 });
    const otherBoard = await service.listPosts(curator, { pageSize: 48 });

    expect(ownerBoard.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: created.id })]),
    );
    expect(otherBoard.items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: created.id })]),
    );
  });

  it('keeps explore public across actors with search and pagination', async () => {
    await service.createPost(learner, postInput('boundary-search'));
    await service.createPost(curator, postInput('boundary-search-two'));

    const result = await service.listPublicPosts({
      search: 'boundary-search',
      page: 1,
      pageSize: 1,
    });

    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(1);
  });

  it('rejects cross-user post updates and deletes without revealing ownership', async () => {
    const created = await service.createPost(learner, postInput('owned-post'));

    await expect(
      service.updatePost(curator, created.id, { title: 'Not mine' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.deletePost(curator, created.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects duplicate video identities for one actor but permits another actor', async () => {
    const first = postInput('duplicate-video');
    await service.createPost(learner, first);

    await expect(
      service.createPost(learner, {
        ...first,
        videoUrl: `${first.videoUrl}&feature=share`,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.createPost(curator, { ...first, title: 'Other owner' }),
    ).resolves.toMatchObject({ authorId: curator.userId });
  });

  it('lets signed-in actors open public details and video assets', async () => {
    const repository = new MemoryBoardRepository();
    service = new StudyBoardService(repository);
    const created = await service.createPost(
      learner,
      postInput('public-detail'),
    );
    await repository.upsertVideoAsset({
      postId: created.id,
      videoId: 'public-detail',
      videoUrl: created.videoUrl,
      language: 'ko',
    });

    await expect(service.getPost(curator, created.id)).resolves.toMatchObject({
      id: created.id,
    });
    await expect(
      service.getVideoAsset(curator, created.id),
    ).resolves.toMatchObject({ postId: created.id });
  });

  it('does not publish queue work outside the post transaction', async () => {
    const enqueuePost = jest.fn();
    service = new StudyBoardService(new MemoryBoardRepository(), {
      enqueuePost,
    } as unknown as VideoAssetService);

    const created = await service.createPost(learner, postInput('enqueue-one'));
    await service.updatePost(learner, created.id, {
      videoUrl: 'https://www.youtube.com/watch?v=enqueue-two',
    });

    expect(enqueuePost).not.toHaveBeenCalled();
  });

  it('allows the comment author or post owner to delete and rejects outsiders', async () => {
    const post = await service.createPost(learner, postInput('comments'));
    const first = await service.addComment(curator, post.id, {
      body: 'Useful',
    });

    await expect(
      service.deleteComment(outsider, post.id, first.id),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.deleteComment(curator, post.id, first.id),
    ).resolves.toEqual({ deleted: true });

    const second = await service.addComment(curator, post.id, {
      body: 'Owner may moderate',
    });
    await expect(
      service.deleteComment(learner, post.id, second.id),
    ).resolves.toEqual({ deleted: true });
  });

  it('lists authenticated playlists as mine-only', async () => {
    const created = await service.createPlaylist(learner, {
      title: 'My private list',
      description: 'Mine',
      postIds: [],
    });

    expect(await service.listPlaylists(learner)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: created.id })]),
    );
    expect(await service.listPlaylists(curator)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: created.id })]),
    );
  });

  it('freezes source and legacy aggregate mutations during final parity', async () => {
    service = new StudyBoardService(
      new MemoryBoardRepository(),
      undefined,
      new CourseCutoverPolicy('freeze'),
    );

    await expect(
      service.createPost(learner, postInput('frozen-source')),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      service.createPlaylist(learner, {
        title: 'Frozen playlist',
        description: '',
        postIds: [],
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('retires playlist writes but keeps source posts mutable after Course activation', async () => {
    service = new StudyBoardService(
      new MemoryBoardRepository(),
      undefined,
      new CourseCutoverPolicy('course'),
    );

    await expect(
      service.createPost(learner, postInput('course-mode-source')),
    ).resolves.toMatchObject({ authorId: learner.userId });
    await expect(
      service.createPlaylist(learner, {
        title: 'Retired playlist',
        description: '',
        postIds: [],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('protects an audited legacy source post until Course activation', async () => {
    const repository = new MemoryBoardRepository();
    repository.hasCompletedCourseBackfillAuditForPost = jest
      .fn()
      .mockResolvedValue(true);
    service = new StudyBoardService(repository);
    const post = await service.createPost(learner, postInput('audited-source'));

    await expect(service.deletePost(learner, post.id)).rejects.toBeInstanceOf(
      ConflictException,
    );

    service = new StudyBoardService(
      repository,
      undefined,
      new CourseCutoverPolicy('course'),
    );
    await expect(service.deletePost(learner, post.id)).resolves.toEqual({
      deleted: true,
    });
  });

  it('enforces playlist ownership while preserving authenticated item additions', async () => {
    const playlist = await service.createPlaylist(learner, {
      title: 'Owner list',
      description: '',
      postIds: [],
    });

    await expect(
      service.updatePlaylist(curator, playlist.id, { title: 'Stolen' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    const updatedPlaylist = await service.addPlaylistItem(
      curator,
      playlist.id,
      1,
    );
    expect(updatedPlaylist.postIds).toContain(1);
  });

  it('collects playlist feedback under the actor with a bounded rating', async () => {
    const playlist = await service.createPlaylist(learner, {
      title: 'Feedback list',
      description: '',
      postIds: [],
    });

    await expect(
      service.addPlaylistFeedback(curator, playlist.id, {
        rating: 5,
        body: 'Great route',
      }),
    ).resolves.toMatchObject({ authorId: curator.userId, rating: 5 });
    await expect(
      service.addPlaylistFeedback(curator, playlist.id, {
        rating: 6,
        body: 'Invalid',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

function postInput(videoId: string) {
  return {
    title: `Post ${videoId}`,
    videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
    summary: 'Summary',
    translatedNotes: 'Notes',
    tags: ['auth'],
  };
}
