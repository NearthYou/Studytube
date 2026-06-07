import { StudyBoardService } from './study-board.service';
import { MemoryBoardRepository } from './memory-board.repository';

describe('StudyBoardService', () => {
  let service: StudyBoardService;

  beforeEach(() => {
    service = new StudyBoardService(new MemoryBoardRepository());
  });

  it('signs up and logs in a user with a reusable bearer session', async () => {
    const session = await service.signUp({
      name: 'Ada',
      email: 'ada@example.com',
      password: 'learn-fast',
    });

    expect(session.token).toHaveLength(48);
    expect(session.user).toMatchObject({
      name: 'Ada',
      email: 'ada@example.com',
    });

    const login = await service.login({
      email: 'ada@example.com',
      password: 'learn-fast',
    });

    expect(login.user.id).toBe(session.user.id);
    expect(login.token).toHaveLength(48);
  });

  it('paginates and searches posts by title, summary, channel, and tags', async () => {
    const result = await service.listPosts({
      search: 'react',
      page: 1,
      pageSize: 2,
    });

    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].tags).toContain('react');
  });

  it('creates a video post and lets users discuss it in comments', async () => {
    const session = await service.demoSession();
    const post = await service.createPost(session.token, {
      title: 'TypeScript Generics in 20 Minutes',
      videoUrl: 'https://www.youtube.com/watch?v=typedemo',
      channelName: 'Type Lab',
      summary: 'Generic constraints and reusable collection helpers.',
      translatedNotes: '제네릭 제약과 재사용 가능한 컬렉션 헬퍼를 다룹니다.',
      tags: ['typescript', 'frontend'],
    });

    const comment = await service.addComment(session.token, post.id, {
      body: 'Mapped type examples helped a lot.',
    });

    const detail = await service.getPost(post.id);

    expect(comment.body).toContain('Mapped type');
    expect(detail.comments).toContainEqual(
      expect.objectContaining({ id: comment.id }),
    );
  });

  it('collects playlist feedback with a bounded rating', async () => {
    const session = await service.demoSession();
    const playlist = await service.createPlaylist(session.token, {
      title: 'React recap',
      description: 'A compact review list.',
      postIds: [1, 2],
    });

    const feedback = await service.addPlaylistFeedback(
      session.token,
      playlist.id,
      {
        rating: 5,
        body: 'The order made the learning path easier.',
      },
    );

    expect(feedback).toMatchObject({
      playlistId: playlist.id,
      rating: 5,
    });
  });
});
