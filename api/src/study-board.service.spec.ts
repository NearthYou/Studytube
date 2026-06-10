import { StudyBoardService } from './study-board.service';
import { MemoryBoardRepository } from './memory-board.repository';
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

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

  it('returns a clear validation error when signing up with an existing email', async () => {
    await service.signUp({
      name: 'Ada',
      email: 'ada@example.com',
      password: 'learn-fast',
    });

    await expect(
      service.signUp({
        name: 'Another Ada',
        email: 'ada@example.com',
        password: 'learn-fast',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires the current password before changing private profile data', async () => {
    const session = await service.signUp({
      name: 'Grace',
      email: 'grace@example.com',
      password: 'learn-fast',
    });

    await expect(
      service.updateMe(session.token, {
        name: 'Grace Hopper',
      } as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    await expect(
      service.updateMe(session.token, {
        currentPassword: 'wrong-pass',
        name: 'Grace Hopper',
      } as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('updates profile, password, and learning preferences after identity verification', async () => {
    const session = await service.signUp({
      name: 'Grace',
      email: 'grace-preferences@example.com',
      password: 'learn-fast',
    });

    const updated = await service.updateMe(session.token, {
      currentPassword: 'learn-fast',
      name: 'Grace Hopper',
      password: 'new-pass',
      preferences: {
        interests: ['React', '영어 회화'],
        pace: '하루 20분',
        goal: '출퇴근 시간에 짧게 복습하기',
      },
    } as any);

    const me = await service.getMe(session.token);

    expect(me.preferences).toEqual({
      interests: ['React', '영어 회화'],
      pace: '하루 20분',
      goal: '출퇴근 시간에 짧게 복습하기',
    });

    expect(updated).toMatchObject({
      id: session.user.id,
      name: 'Grace Hopper',
      email: 'grace-preferences@example.com',
    });

    const login = await service.login({
      email: 'grace-preferences@example.com',
      password: 'new-pass',
    });

    expect(login.user.name).toBe('Grace Hopper');
  });

  it('paginates and searches posts by title, summary, channel, and tags', async () => {
    const result = await service.listPosts({
      token: (await service.demoSession()).token,
      search: 'react',
      page: 1,
      pageSize: 2,
    });

    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].tags).toContain('react');
  });

  it('shows each account only its own board posts', async () => {
    const ada = await service.signUp({
      name: 'Ada',
      email: 'ada-private@example.com',
      password: 'learn-fast',
    });
    const linus = await service.signUp({
      name: 'Linus',
      email: 'linus-private@example.com',
      password: 'learn-fast',
    });

    const adaPost = await service.createPost(ada.token, {
      title: 'Account scoped React lesson',
      videoUrl: 'https://www.youtube.com/watch?v=ada-react',
      channelName: 'Ada Channel',
      summary: 'A private React board note for Ada.',
      translatedNotes: 'Ada 계정에서만 보여야 하는 React 학습 노트입니다.',
      tags: ['react', 'private'],
    });
    await service.createPost(linus.token, {
      title: 'Account scoped FastAPI lesson',
      videoUrl: 'https://www.youtube.com/watch?v=linus-fastapi',
      channelName: 'Linus Channel',
      summary: 'A private FastAPI board note for Linus.',
      translatedNotes: 'Linus 계정에서만 보여야 하는 FastAPI 학습 노트입니다.',
      tags: ['fastapi', 'private'],
    });

    const adaPosts = await service.listPosts({
      token: ada.token,
      search: 'Account scoped',
      page: 1,
      pageSize: 10,
    });
    const linusPosts = await service.listPosts({
      token: linus.token,
      search: 'Account scoped',
      page: 1,
      pageSize: 10,
    });

    expect(adaPosts.items.map((post) => post.title)).toEqual([
      'Account scoped React lesson',
    ]);
    expect(linusPosts.items.map((post) => post.title)).toEqual([
      'Account scoped FastAPI lesson',
    ]);
    await expect(
      service.updatePost(linus.token, adaPost.id, {
        title: 'Cross account edit',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lets the explore board show public video cards across accounts', async () => {
    const ada = await service.signUp({
      name: 'Ada',
      email: 'ada-explore@example.com',
      password: 'learn-fast',
    });
    const linus = await service.signUp({
      name: 'Linus',
      email: 'linus-explore@example.com',
      password: 'learn-fast',
    });

    await service.createPost(ada.token, {
      title: 'Public React transcript card',
      videoUrl: 'https://www.youtube.com/watch?v=public-react',
      channelName: 'Ada Channel',
      summary: 'React hooks course summary.',
      translatedNotes: 'React hooks transcript evidence for public search.',
      tags: ['react', 'public'],
    });
    await service.createPost(linus.token, {
      title: 'Public FastAPI transcript card',
      videoUrl: 'https://www.youtube.com/watch?v=public-fastapi',
      channelName: 'Linus Channel',
      summary: 'FastAPI course summary.',
      translatedNotes: 'FastAPI transcript evidence for public search.',
      tags: ['fastapi', 'public'],
    });

    const result = await service.listPublicPosts({
      search: 'public',
      page: 1,
      pageSize: 20,
    });

    expect(result.items.map((post) => post.title)).toEqual(
      expect.arrayContaining([
        'Public React transcript card',
        'Public FastAPI transcript card',
      ]),
    );
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

    const detail = await service.getPost(session.token, post.id);

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
