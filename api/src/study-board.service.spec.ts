import { StudyBoardService } from './study-board.service';
import { MemoryBoardRepository } from './memory-board.repository';
import type { VideoAssetService } from './video-asset.service';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

describe('StudyBoardService', () => {
  let service: StudyBoardService;
  let testUserCounter: number;

  beforeEach(() => {
    testUserCounter = 0;
    service = new StudyBoardService(new MemoryBoardRepository());
  });

  async function createTestSession(
    targetService: StudyBoardService = service,
    label = 'learner',
  ) {
    testUserCounter += 1;

    return targetService.signUp({
      name: `Test ${label} ${testUserCounter}`,
      email: `${label}-${testUserCounter}@example.com`,
      password: 'learn-fast',
    });
  }

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

  it('starts new accounts without preselected learning preferences', async () => {
    const session = await service.signUp({
      name: 'New Learner',
      email: 'new-learner@example.com',
      password: 'learn-fast',
    });

    expect(session.user.preferences).toEqual({
      interests: [],
      pace: '',
      goal: '',
    });

    await expect(
      service.updateMe(session.token, {
        preferences: {
          interests: ['React', '영어 회화'],
          pace: '하루 20분',
          goal: '퇴근 후 복습',
        },
      }),
    ).resolves.toMatchObject({
      preferences: {
        interests: ['React', '영어 회화'],
        pace: '하루 20분',
        goal: '퇴근 후 복습',
      },
    });

    await expect(
      service.updateMe(session.token, {
        preferences: {
          interests: ['Python', '데이터 분석'],
          pace: '주 3회',
          goal: '프로젝트에 쓸 수 있게 복습',
        },
      }),
    ).resolves.toMatchObject({
      preferences: {
        interests: ['Python', '데이터 분석'],
        pace: '주 3회',
        goal: '프로젝트에 쓸 수 있게 복습',
      },
    });
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
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    await expect(
      service.updateMe(session.token, {
        currentPassword: 'wrong-pass',
        name: 'Grace Hopper',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('verifies the current password before opening profile editing', async () => {
    const session = await service.signUp({
      name: 'Grace',
      email: 'grace-verify@example.com',
      password: 'learn-fast',
    });

    await expect(
      service.verifyMe(session.token, 'wrong-pass'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    await expect(
      service.verifyMe(session.token, 'learn-fast'),
    ).resolves.toEqual(session.user);
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
    });

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
    const session = await createTestSession(service, 'pagination');
    await service.createPost(session.token, {
      title: 'React query pagination lesson',
      videoUrl: 'https://www.youtube.com/watch?v=react-pagination-1',
      channelName: 'StudyTube',
      summary: 'React search and pagination example.',
      translatedNotes: 'React 寃?됯낵 ?섏씠吏 ?ㅼ뒿 ?명듃?낅땲??',
      tags: ['react', 'query'],
    });
    await service.createPost(session.token, {
      title: 'React hooks pagination lesson',
      videoUrl: 'https://www.youtube.com/watch?v=react-pagination-2',
      channelName: 'StudyTube',
      summary: 'React hooks search example.',
      translatedNotes: 'React hooks 寃?? ?ㅼ뒿 ?명듃?낅땲??',
      tags: ['react', 'hooks'],
    });

    const result = await service.listPosts({
      token: session.token,
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

  it('rejects duplicate video posts from the same account', async () => {
    const session = await createTestSession(service, 'duplicate-post');

    await service.createPost(session.token, {
      title: 'React duplicate lesson',
      videoUrl: 'https://www.youtube.com/watch?v=duplicateVideo',
      channelName: 'StudyTube',
      summary: 'A React lesson.',
      translatedNotes: 'React duplicate lesson notes.',
      tags: ['react'],
    });

    await expect(
      service.createPost(session.token, {
        title: 'Same React duplicate lesson',
        videoUrl: 'https://youtu.be/duplicateVideo',
        channelName: 'StudyTube',
        summary: 'The same video through a short URL.',
        translatedNotes: 'The same video through a short URL.',
        tags: ['react'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects post updates with more than three tags', async () => {
    const session = await createTestSession(service, 'tag-limit');
    const post = await service.createPost(session.token, {
      title: 'React hooks',
      videoUrl: 'https://www.youtube.com/watch?v=abc123',
      thumbnailUrl: 'https://i.ytimg.com/vi/abc123/hqdefault.jpg',
      channelName: 'StudyTube',
      summary: '리액트 훅을 설명하는 한글 요약입니다.',
      translatedNotes: '리액트 훅 복습 포인트입니다.',
      tags: ['react', 'hooks', 'frontend'],
    });

    await expect(
      service.updatePost(session.token, post.id, {
        tags: ['react', 'hooks', 'frontend', 'javascript'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
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

  it('lets signed-in users open public post details across accounts', async () => {
    const ada = await service.signUp({
      name: 'Ada',
      email: 'ada-public-detail@example.com',
      password: 'learn-fast',
    });
    const linus = await service.signUp({
      name: 'Linus',
      email: 'linus-public-detail@example.com',
      password: 'learn-fast',
    });
    const post = await service.createPost(ada.token, {
      title: 'Public details lesson',
      videoUrl: 'https://www.youtube.com/watch?v=public-detail',
      channelName: 'Ada Channel',
      summary: 'Public details should be readable by signed-in users.',
      translatedNotes: 'Public detail notes.',
      tags: ['public'],
    });

    await expect(service.getPost(linus.token, post.id)).resolves.toMatchObject({
      id: post.id,
      title: 'Public details lesson',
      authorId: ada.user.id,
    });
    await expect(
      service.updatePost(linus.token, post.id, {
        title: 'Cross-account rewrite',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('ships diverse real-video seed playlists for the public board', async () => {
    const posts = await service.listPublicPosts({
      page: 1,
      pageSize: 50,
    });
    const playlists = await service.listPlaylists();
    const urls = posts.items.map((post) => post.videoUrl);
    const tags = new Set(posts.items.flatMap((post) => post.tags));
    const authorIds = new Set(posts.items.map((post) => post.authorId));
    const playlistOwnerIds = new Set(
      playlists.map((playlist) => playlist.ownerId),
    );

    expect(urls).toEqual(
      expect.arrayContaining([
        'https://www.youtube.com/watch?v=v7AYKMP6rOE',
        'https://www.youtube.com/watch?v=f2O6mQkFiiw',
        'https://www.youtube.com/watch?v=rfscVS0vtbw',
        'https://www.youtube.com/watch?v=PkZNo7MFNFg',
        'https://www.youtube.com/watch?v=iCvmsMzlF7o',
        'https://www.youtube.com/watch?v=Ks-_Mh1QhMc',
        'https://www.youtube.com/watch?v=qp0HIF3SfI4',
        'https://www.youtube.com/watch?v=fqMOX6JJhGo',
        'https://www.youtube.com/watch?v=RGOj5yH7evk',
        'https://www.youtube.com/watch?v=arj7oStGLkU',
        'https://www.youtube.com/watch?v=fLJsdqxnZb0',
        'https://www.youtube.com/watch?v=d0yGdNEWdn0',
      ]),
    );
    expect([...tags]).toEqual(
      expect.arrayContaining([
        'yoga',
        'wellness',
        'music',
        'python',
        'javascript',
        'psychology',
        'business',
        'docker',
        'git',
        'productivity',
        'language',
      ]),
    );
    expect(playlists.map((playlist) => playlist.title)).toEqual(
      expect.arrayContaining([
        '랜덤 테크 스타터 팩',
        '몸과 마음 리셋 루틴',
        '커뮤니케이션 TED 믹스',
        '프론트엔드 복습 루트',
        'DevOps 입문 트랙',
        'SQL 데이터 분석 스타터',
        '언어 학습 가속 루트',
        '집중력 회복 TED 루트',
        'CS 기초 넓게 보기',
      ]),
    );
    expect(posts.total).toBeGreaterThanOrEqual(20);
    expect(playlists.length).toBeGreaterThanOrEqual(10);
    expect(authorIds.size).toBeGreaterThanOrEqual(6);
    expect(playlistOwnerIds.size).toBeGreaterThanOrEqual(6);
    expect(playlistOwnerIds.has(1)).toBe(false);
    expect(playlists.every((playlist) => playlist.postIds.length >= 2)).toBe(
      true,
    );
  });

  it('keeps public playlist browsing available for signed-in users', async () => {
    const ada = await service.signUp({
      name: 'Ada',
      email: 'ada-playlist-scope@example.com',
      password: 'learn-fast',
    });
    const linus = await service.signUp({
      name: 'Linus',
      email: 'linus-playlist-scope@example.com',
      password: 'learn-fast',
    });
    await service.createPlaylist(ada.token, {
      title: 'Ada public playlist scope',
      description: 'Visible in public browsing.',
      postIds: [1, 2],
    });
    await service.createPlaylist(linus.token, {
      title: 'Linus public playlist scope',
      description: 'Also visible in public browsing.',
      postIds: [3, 4],
    });

    const publicTitles = (await service.listPlaylists(ada.token)).map(
      (playlist) => playlist.title,
    );
    const mineTitles = (await service.listPlaylists(ada.token, 'mine')).map(
      (playlist) => playlist.title,
    );

    expect(publicTitles).toEqual(
      expect.arrayContaining([
        'Ada public playlist scope',
        'Linus public playlist scope',
      ]),
    );
    expect(mineTitles).toContain('Ada public playlist scope');
    expect(mineTitles).not.toContain('Linus public playlist scope');
  });

  it('creates posts through a repository that supports pending video asset persistence', async () => {
    const session = await createTestSession(service, 'asset');
    const post = await service.createPost(session.token, {
      title: 'Asset ready lesson',
      videoUrl: 'https://www.youtube.com/watch?v=novnyCaa7To',
      thumbnailUrl: 'https://i.ytimg.com/vi/novnyCaa7To/hqdefault.jpg',
      channelName: 'The Net Ninja',
      summary: 'React Query server state lesson.',
      translatedNotes: 'React Query server state learning material.',
      tags: ['react', 'query'],
    });

    expect(post.videoUrl).toContain('novnyCaa7To');
    await expect(
      service.getVideoAsset(session.token, post.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lets signed-in users read video assets for public posts across accounts', async () => {
    const ada = await service.signUp({
      name: 'Ada',
      email: 'ada-public-asset@example.com',
      password: 'learn-fast',
    });
    const linus = await service.signUp({
      name: 'Linus',
      email: 'linus-public-asset@example.com',
      password: 'learn-fast',
    });
    const post = await service.createPost(ada.token, {
      title: 'Public asset lesson',
      videoUrl: 'https://www.youtube.com/watch?v=publicAsset',
      channelName: 'Ada Channel',
      summary: 'Public asset should be readable by signed-in users.',
      translatedNotes: 'Public asset notes.',
      tags: ['asset', 'public'],
    });
    await (service as unknown as { repository: MemoryBoardRepository })
      .repository.upsertVideoAsset({
        postId: post.id,
        videoId: 'publicAsset',
        videoUrl: post.videoUrl,
        language: 'ko',
      });

    await expect(
      service.getVideoAsset(linus.token, post.id),
    ).resolves.toMatchObject({
      postId: post.id,
      videoId: 'publicAsset',
    });
  });

  it('queues a fresh video asset when the post video url changes', async () => {
    const repository = new MemoryBoardRepository();
    const videoAssetService = {
      enqueuePost: jest.fn(),
    } as unknown as VideoAssetService;
    const targetService = new StudyBoardService(repository, videoAssetService);
    const session = await createTestSession(targetService, 'asset-update');
    const post = await targetService.createPost(session.token, {
      title: 'Asset update lesson',
      videoUrl: 'https://www.youtube.com/watch?v=oldAssetVideo',
      channelName: 'StudyTube',
      summary: 'Changing the URL should refresh generated assets.',
      translatedNotes: 'Asset update notes.',
      tags: ['asset'],
    });

    await expect(
      targetService.updatePost(session.token, post.id, {
        videoUrl: 'https://www.youtube.com/watch?v=newAssetVideo',
      }),
    ).resolves.toMatchObject({
      id: post.id,
      videoUrl: 'https://www.youtube.com/watch?v=newAssetVideo',
    });
    expect(videoAssetService.enqueuePost).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: post.id,
        videoUrl: 'https://www.youtube.com/watch?v=newAssetVideo',
      }),
    );
  });

  it('enqueues video asset preparation after creating a post without awaiting it', async () => {
    const enqueuePost = jest.fn(() => new Promise(() => undefined));
    const serviceWithAssets = new StudyBoardService(
      new MemoryBoardRepository(),
      { enqueuePost } as unknown as VideoAssetService,
    );
    const session = await createTestSession(serviceWithAssets, 'queued-asset');
    const result = await Promise.race([
      serviceWithAssets.createPost(session.token, {
        title: 'Queued asset lesson',
        videoUrl: 'https://www.youtube.com/watch?v=queuedAsset',
        thumbnailUrl: 'https://i.ytimg.com/vi/queuedAsset/hqdefault.jpg',
        channelName: 'StudyTube',
        summary: 'A lesson that should enqueue asset preparation.',
        translatedNotes: 'Queued asset preparation notes.',
        tags: ['asset', 'queue'],
      }),
      new Promise<'timeout'>((resolve) => {
        setTimeout(() => resolve('timeout'), 50);
      }),
    ]);

    expect(result).not.toBe('timeout');
    expect(enqueuePost).toHaveBeenCalledWith(
      expect.objectContaining({
        videoUrl: 'https://www.youtube.com/watch?v=queuedAsset',
      }),
    );
  });

  it('persists video asset updates by post id in the repository', async () => {
    const repository = new MemoryBoardRepository();
    const post = await repository.createPost({
      authorId: 1,
      title: 'Repository asset lesson',
      videoUrl: 'https://www.youtube.com/watch?v=asset-test',
      thumbnailUrl: 'https://i.ytimg.com/vi/asset-test/hqdefault.jpg',
      channelName: 'StudyTube',
      summary: 'A post-scoped asset persistence lesson.',
      translatedNotes: 'Repository asset persistence notes.',
      tags: ['asset', 'repository'],
    });

    const pending = await repository.upsertVideoAsset({
      postId: post.id,
      videoId: 'asset-test',
      videoUrl: 'https://www.youtube.com/watch?v=asset-test',
      language: 'ko',
    });

    expect(pending).toMatchObject({
      postId: post.id,
      videoId: 'asset-test',
      videoUrl: 'https://www.youtube.com/watch?v=asset-test',
      language: 'ko',
      status: 'pending',
      sourceCaptionStatus: 'pending',
      translationStatus: 'pending',
      summaryStatus: 'pending',
      sourceSegments: [],
      translatedSegments: [],
      summarySections: [],
      transcriptBody: '',
      errorMessage: '',
    });

    await expect(
      repository.updateVideoAsset(post.id, {
        status: 'ready',
        sourceCaptionStatus: 'ready',
        translationStatus: 'ready',
        summaryStatus: 'ready',
        translatedSegments: [{ start: 0, end: 3, text: '안녕하세요.' }],
        transcriptBody: '00:00 안녕하세요.',
      }),
    ).resolves.toMatchObject({
      postId: post.id,
      status: 'ready',
      sourceCaptionStatus: 'ready',
      translationStatus: 'ready',
      summaryStatus: 'ready',
      translatedSegments: [{ start: 0, end: 3, text: '안녕하세요.' }],
      transcriptBody: '00:00 안녕하세요.',
    });

    await expect(repository.findVideoAsset(post.id)).resolves.toMatchObject({
      postId: post.id,
      videoId: 'asset-test',
      videoUrl: 'https://www.youtube.com/watch?v=asset-test',
      language: 'ko',
      status: 'ready',
      sourceCaptionStatus: 'ready',
      translationStatus: 'ready',
      summaryStatus: 'ready',
      translatedSegments: [{ start: 0, end: 3, text: '안녕하세요.' }],
      transcriptBody: '00:00 안녕하세요.',
    });

    await repository.deletePost(post.id);

    await expect(repository.findVideoAsset(post.id)).resolves.toBeNull();
  });

  it('rejects video asset upserts for missing posts', async () => {
    const repository = new MemoryBoardRepository();

    await expect(
      repository.upsertVideoAsset({
        postId: 999,
        videoId: 'missing-post-video',
        videoUrl: 'https://www.youtube.com/watch?v=missing-post-video',
        language: 'ko',
      }),
    ).rejects.toThrow('Post not found for video asset');
  });

  it('keeps video asset arrays isolated from caller mutations', async () => {
    const repository = new MemoryBoardRepository();
    const post = await repository.createPost({
      authorId: 1,
      title: 'Immutable asset lesson',
      videoUrl: 'https://www.youtube.com/watch?v=immutable-asset',
      thumbnailUrl: 'https://i.ytimg.com/vi/immutable-asset/hqdefault.jpg',
      channelName: 'StudyTube',
      summary: 'A lesson with asset segment snapshots.',
      translatedNotes: 'Immutable asset persistence notes.',
      tags: ['asset', 'immutable'],
    });
    await repository.upsertVideoAsset({
      postId: post.id,
      videoId: 'immutable-asset',
      videoUrl: 'https://www.youtube.com/watch?v=immutable-asset',
      language: 'ko',
    });
    const sourceSegments = [{ start: 1, end: 2, text: 'hello' }];
    const translatedSegments = [{ start: 1, end: 2, text: '안녕하세요.' }];
    const summarySections = [{ label: 'Intro', body: 'Greeting.' }];

    await repository.updateVideoAsset(post.id, {
      sourceSegments,
      translatedSegments,
      summarySections,
    });
    sourceSegments[0].text = 'mutated';
    translatedSegments[0].text = '변경됨';
    summarySections[0].body = 'Changed.';

    await expect(repository.findVideoAsset(post.id)).resolves.toMatchObject({
      sourceSegments: [{ start: 1, end: 2, text: 'hello' }],
      translatedSegments: [{ start: 1, end: 2, text: '안녕하세요.' }],
      summarySections: [{ label: 'Intro', body: 'Greeting.' }],
    });
  });

  it('creates a video post and lets users discuss it in comments', async () => {
    const session = await createTestSession(service, 'discussion');
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

  it('lets signed-in users comment on public posts from another account', async () => {
    const ada = await service.signUp({
      name: 'Ada',
      email: 'ada-comments@example.com',
      password: 'learn-fast',
    });
    const linus = await service.signUp({
      name: 'Linus',
      email: 'linus-comments@example.com',
      password: 'learn-fast',
    });
    const post = await service.createPost(ada.token, {
      title: 'Public board discussion seed',
      videoUrl: 'https://www.youtube.com/watch?v=discussion-seed',
      channelName: 'Ada Channel',
      summary: 'A public lesson that should accept discussion.',
      translatedNotes: 'Discussion-ready public lesson notes.',
      tags: ['discussion', 'public'],
    });

    const comment = await service.addComment(linus.token, post.id, {
      body: 'This belongs in a shared board conversation.',
    });

    const detail = await service.getPost(ada.token, post.id);

    expect(comment).toMatchObject({
      postId: post.id,
      authorId: linus.user.id,
      body: 'This belongs in a shared board conversation.',
    });
    expect(detail.comments).toContainEqual(
      expect.objectContaining({ id: comment.id, authorName: 'Linus' }),
    );
  });

  it('lets comment authors and post authors delete comments but rejects unrelated users', async () => {
    const ada = await service.signUp({
      name: 'Ada',
      email: 'ada-comment-delete@example.com',
      password: 'learn-fast',
    });
    const linus = await service.signUp({
      name: 'Linus',
      email: 'linus-comment-delete@example.com',
      password: 'learn-fast',
    });
    const grace = await service.signUp({
      name: 'Grace',
      email: 'grace-comment-delete@example.com',
      password: 'learn-fast',
    });
    const post = await service.createPost(ada.token, {
      title: 'Comment deletion permissions',
      videoUrl: 'https://www.youtube.com/watch?v=comment-delete',
      channelName: 'Ada Channel',
      summary: 'A public lesson with comment moderation rules.',
      translatedNotes: 'Comment moderation rule notes.',
      tags: ['discussion', 'permissions'],
    });

    const authorOwnedComment = await service.addComment(linus.token, post.id, {
      body: 'I should be able to remove my own comment.',
    });

    await expect(
      service.deleteComment(grace.token, post.id, authorOwnedComment.id),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      service.deleteComment(linus.token, post.id, authorOwnedComment.id),
    ).resolves.toEqual({ deleted: true });

    const postOwnerModeratedComment = await service.addComment(
      linus.token,
      post.id,
      {
        body: 'The post owner can moderate this comment.',
      },
    );

    await expect(
      service.deleteComment(ada.token, post.id, postOwnerModeratedComment.id),
    ).resolves.toEqual({ deleted: true });
  });

  it('collects playlist feedback with a bounded rating', async () => {
    const session = await createTestSession(service, 'feedback');
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

  it('lets playlist owners update and delete board playlist posts', async () => {
    const session = await createTestSession(service, 'playlist-owner');
    const playlist = await service.createPlaylist(session.token, {
      title: 'React recap',
      description: 'A compact review list.',
      postIds: [1, 2],
    });

    const updated = await service.updatePlaylist(session.token, playlist.id, {
      title: 'React board course',
      description: 'A refreshed playlist post for the board.',
      postIds: [2, 1, 2],
    });

    expect(updated).toMatchObject({
      id: playlist.id,
      ownerId: session.user.id,
      title: 'React board course',
      description: 'A refreshed playlist post for the board.',
      postIds: [2, 1],
    });

    await expect(
      service.deletePlaylist(session.token, playlist.id),
    ).resolves.toEqual({ deleted: true });

    await expect(
      service.updatePlaylist(session.token, playlist.id, {
        title: 'Deleted course',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('hides playlist management actions from other accounts', async () => {
    const owner = await service.signUp({
      name: 'Ada',
      email: 'ada-playlist-owner@example.com',
      password: 'learn-fast',
    });
    const other = await service.signUp({
      name: 'Linus',
      email: 'linus-playlist-owner@example.com',
      password: 'learn-fast',
    });
    const playlist = await service.createPlaylist(owner.token, {
      title: 'Owner only playlist',
      description: 'A board playlist post only Ada can manage.',
      postIds: [1, 2],
    });

    await expect(
      service.updatePlaylist(other.token, playlist.id, {
        title: 'Cross account edit',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    await expect(
      service.deletePlaylist(other.token, playlist.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('attaches discussion comments to the playlist itself', async () => {
    const ada = await service.signUp({
      name: 'Ada',
      email: 'ada-playlist-comments@example.com',
      password: 'password123',
    });
    const linus = await service.signUp({
      name: 'Linus',
      email: 'linus-playlist-comments@example.com',
      password: 'password123',
    });
    const playlist = await service.createPlaylist(ada.token, {
      title: 'TypeScript course',
      description: 'A course-level discussion target.',
      postIds: [1, 2, 3, 4],
    });

    const feedback = await service.addPlaylistFeedback(
      linus.token,
      playlist.id,
      {
        rating: 5,
        body: 'This whole playlist order worked well.',
      },
    );
    const [updatedPlaylist] = (await service.listPlaylists()).filter(
      (candidate) => candidate.id === playlist.id,
    );

    expect(feedback).toMatchObject({
      playlistId: playlist.id,
      authorName: 'Linus',
      body: 'This whole playlist order worked well.',
    });
    expect(updatedPlaylist.feedback).toContainEqual(
      expect.objectContaining({
        id: feedback.id,
        authorName: 'Linus',
        body: 'This whole playlist order worked well.',
      }),
    );
  });
});
