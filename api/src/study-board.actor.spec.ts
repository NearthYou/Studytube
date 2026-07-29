import { MemoryBoardRepository } from './memory-board.repository';
import { StudyBoardService } from './study-board.service';

describe('StudyBoardService actor boundary', () => {
  it('uses the authenticated actor for ownership checks', async () => {
    const service = new StudyBoardService(new MemoryBoardRepository());
    const owner = { userId: 1 };
    const intruder = { userId: 2 };

    const post = await service.createPost(owner, {
      title: 'Owned by the actor',
      videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      summary: 'Summary',
      translatedNotes: 'Notes',
      tags: ['auth'],
    });

    expect(post.authorId).toBe(owner.userId);
    await expect(
      service.updatePost(intruder, post.id, { title: 'Stolen' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('lists only the authenticated actor playlists', async () => {
    const service = new StudyBoardService(new MemoryBoardRepository());

    await service.createPlaylist(
      { userId: 1 },
      { title: 'Mine', description: 'Private', postIds: [] },
    );

    const mine = await service.listPlaylists({ userId: 1 });
    const theirs = await service.listPlaylists({ userId: 2 });

    expect(mine).toEqual([
      expect.objectContaining({ title: 'Mine', ownerId: 1 }),
    ]);
    expect(theirs).toEqual(
      expect.arrayContaining([expect.objectContaining({ ownerId: 2 })]),
    );
    expect(theirs).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ title: 'Mine' })]),
    );
  });
});
