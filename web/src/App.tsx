import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, FormEvent, ReactNode, SetStateAction } from 'react';
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router';
import './App.css';
import {
  addComment,
  addPlaylistFeedback,
  askAgent,
  askMcp,
  askRag,
  createPlaylist,
  createPost,
  deletePost,
  demoSession,
  fetchPlaylists,
  fetchPosts,
  fetchPublicPlaylists,
  fetchPublicPosts,
  fetchTranslatedCaptions,
  fetchVideoSummary,
  fetchMe,
  login,
  signUp,
  updateMe,
  updatePost,
} from './api';
import type {
  AgentResponse,
  CaptionResponse,
  LearningPreferences,
  McpResponse,
  Playlist,
  RagResponse,
  Session,
  StudyPost,
  User,
  VideoSummaryResponse,
} from './types';

type PostEditor = {
  title: string;
  videoUrl: string;
  thumbnailUrl: string;
  channelName: string;
  summary: string;
  translatedNotes: string;
  tags: string;
};

type QueueVideo = {
  id: string;
  title: string;
  videoId: string;
  videoUrl: string;
  thumbnailUrl: string;
  channelName: string;
  summary: string;
  translatedNotes: string;
  source: string;
  evidenceSnippet?: string;
  learning?: VideoLearningState;
};

type CaptionLanguage = 'ko' | 'en';

type LoopRange = {
  enabled: boolean;
  manual?: boolean;
  start: number;
  end: number;
};

type LearningMark = {
  id: string;
  start: number;
  end: number;
  note: string;
  caption: string;
  createdAt: string;
};

type VideoLearningState = {
  captionLanguage: CaptionLanguage;
  captionsEnabled: boolean;
  playbackRate: number;
  loop: LoopRange;
  marks: LearningMark[];
};

type PreferenceProfile = LearningPreferences;

type YouTubePlayer = {
  loadVideoById: (videoId: string) => void;
  getCurrentTime: () => number;
  getDuration?: () => number;
  seekTo?: (seconds: number, allowSeekAhead: boolean) => void;
  setPlaybackRate?: (rate: number) => void;
  loadModule?: (module: string) => void;
  unloadModule?: (module: string) => void;
  setOption?: (module: string, option: string, value: unknown) => void;
  destroy: () => void;
};

type VideoDurationState = {
  videoId: string;
  duration: number;
  waitExpired: boolean;
};

type YouTubeApi = {
  Player: new (
    elementId: string,
    options: {
      videoId: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (event: { target: YouTubePlayer }) => void;
        onStateChange?: (event: { data: number; target: YouTubePlayer }) => void;
      };
    },
  ) => YouTubePlayer;
};

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const emptyEditor: PostEditor = {
  title: '',
  videoUrl: '',
  thumbnailUrl: '',
  channelName: '',
  summary: '',
  translatedNotes: '',
  tags: '',
};

const QUEUE_STORAGE_KEY = 'studytube.watchQueue';
const SESSION_STORAGE_KEY = 'studytube.session';
const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2];
const DEFAULT_CAPTION_DURATION_SECONDS = 600;
const LIVE_CAPTION_PROVIDERS = new Set([
  'youtube-timedtext',
  'yt-dlp-captions',
  'openai-caption-translation',
  'youtube-transcript-api',
]);
const DEFAULT_LEARNING_STATE: VideoLearningState = {
  captionLanguage: 'ko',
  captionsEnabled: true,
  playbackRate: 1,
  loop: {
    enabled: false,
    manual: false,
    start: 0,
    end: 15,
  },
  marks: [],
};

function App() {
  const [session, setSession] = useState<Session | null>(() => readSession());

  function handleAuthComplete(nextSession: Session) {
    const normalizedSession = normalizeSession(nextSession);
    saveSession(normalizedSession);
    setSession(normalizedSession);
  }

  function handleLogout() {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    setSession(null);
  }

  function handleUserUpdate(user: User) {
    setSession((current) => {
      if (!current) {
        return current;
      }

      const nextSession = normalizeSession({ ...current, user });
      saveSession(nextSession);

      return nextSession;
    });
  }

  return (
    <>
      <SiteNav session={session} onLogout={handleLogout} />
      <Routes>
        <Route
          path="/login"
          element={<AuthPage mode="login" onComplete={handleAuthComplete} />}
        />
        <Route
          path="/signup"
          element={<AuthPage mode="signup" onComplete={handleAuthComplete} />}
        />
        <Route
          path="/"
          element={
            <ProtectedRoute session={session}>
              <HomePage session={session!} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/board"
          element={
            <ProtectedRoute session={session}>
              <BoardPage session={session!} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/explore"
          element={
            <ProtectedRoute session={session}>
              <ExplorePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/search"
          element={
            <ProtectedRoute session={session}>
              <CoursePage session={session!} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/watch"
          element={
            <ProtectedRoute session={session}>
              <WatchPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/playlists"
          element={
            <ProtectedRoute session={session}>
              <CoursePage session={session!} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/me"
          element={
            <ProtectedRoute session={session}>
              <MyPage session={session!} onSessionUpdate={handleUserUpdate} />
            </ProtectedRoute>
          }
        />
      </Routes>
    </>
  );
}

function ProtectedRoute({
  children,
  session,
}: {
  children: ReactNode;
  session: Session | null;
}) {
  const location = useLocation();

  if (!session) {
    return <Navigate replace state={{ from: location.pathname }} to="/login" />;
  }

  return children;
}

function SiteNav({
  session,
  onLogout,
}: {
  session: Session | null;
  onLogout: () => void;
}) {
  return (
    <header className="site-nav">
      <Link className="brand" to="/" aria-label="StudyTube home">
        StudyTube
      </Link>
      {session ? (
        <>
          <nav>
            <NavLink to="/watch">학습</NavLink>
            <NavLink to="/explore">보드</NavLink>
            <NavLink to="/board">등록</NavLink>
            <NavLink to="/search">AI 추천</NavLink>
            <NavLink to="/me">내 정보</NavLink>
          </nav>
          <div className="nav-account">
            <Link to="/me">{session.user.name}</Link>
            <button type="button" onClick={onLogout}>
              로그아웃
            </button>
          </div>
        </>
      ) : (
        <div className="nav-account">
          <Link className="nav-cta" to="/login">
            로그인
          </Link>
          <Link className="nav-cta" to="/signup">
            회원가입
          </Link>
        </div>
      )}
    </header>
  );
}

function AuthPage({
  mode,
  onComplete,
}: {
  mode: 'login' | 'signup';
  onComplete: (session: Session) => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({
    name: '',
    email: mode === 'login' ? 'demo@studytube.local' : '',
    password: mode === 'login' ? 'demo1234' : '',
  });
  const [status, setStatus] = useState(
    mode === 'login'
      ? '계정으로 로그인하면 모든 학습 서비스가 열립니다.'
      : '회원가입 후 바로 학습 서비스를 사용할 수 있습니다.',
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const from =
    typeof location.state === 'object' &&
    location.state &&
    'from' in location.state &&
    typeof location.state.from === 'string'
      ? location.state.from
      : '/';

  async function submit(event: FormEvent) {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);

    try {
      const nextSession =
        mode === 'signup'
          ? await signUp(form)
          : await login({ email: form.email, password: form.password });
      completeAuth(nextSession);
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : '인증에 실패했어요. 이메일과 비밀번호를 확인하세요.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function loginWithDemo() {
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setStatus('데모 계정으로 로그인하는 중입니다.');

    try {
      const nextSession = await demoSession();
      completeAuth(nextSession);
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : '데모 로그인에 실패했어요. 서버가 실행 중인지 확인하세요.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function completeAuth(nextSession: Session) {
    onComplete(nextSession);
    navigate(from, { replace: true });
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <p className="eyebrow">StudyTube Account</p>
        <h1>{mode === 'login' ? '로그인' : '회원가입'}</h1>
        <p>{status}</p>
        <button
          className="demo-login-button"
          type="button"
          disabled={isSubmitting}
          onClick={() => void loginWithDemo()}
        >
          데모 계정으로 바로 시작
        </button>
        <div className="form-divider">
          <span>{mode === 'login' ? '또는 직접 로그인' : '또는 새 계정 만들기'}</span>
        </div>
        <form className="stack-form" onSubmit={submit}>
          {mode === 'signup' && (
            <input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="이름"
              disabled={isSubmitting}
            />
          )}
          <input
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
            placeholder="이메일"
            type="email"
            disabled={isSubmitting}
          />
          <input
            value={form.password}
            onChange={(event) =>
              setForm({ ...form, password: event.target.value })
            }
            placeholder="비밀번호"
            type="password"
            disabled={isSubmitting}
          />
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? '처리 중'
              : mode === 'signup'
                ? '회원가입'
                : '로그인'}
          </button>
        </form>
        <div className="auth-switch">
          {mode === 'login' ? (
            <Link to="/signup">계정 만들기</Link>
          ) : (
            <Link to="/login">로그인으로 돌아가기</Link>
          )}
        </div>
      </section>
    </main>
  );
}

function MyPage({
  session,
  onSessionUpdate,
}: {
  session: Session;
  onSessionUpdate: (user: User) => void;
}) {
  const [user, setUser] = useState(session.user);
  const [name, setName] = useState(session.user.name);
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [interests, setInterests] = useState(
    session.user.preferences.interests.join(', '),
  );
  const [pace, setPace] = useState(session.user.preferences.pace);
  const [goal, setGoal] = useState(session.user.preferences.goal);
  const [postCount, setPostCount] = useState(0);
  const [playlistCount, setPlaylistCount] = useState(0);
  const [status, setStatus] = useState('계정 정보를 불러오는 중입니다.');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadProfile() {
      try {
        const [nextUser, postResult, nextPlaylists] = await Promise.all([
          fetchMe(session.token),
          fetchPosts(session.token, '', 1, 1),
          fetchPlaylists(session.token),
        ]);

        if (!mounted) {
          return;
        }

        setUser(nextUser);
        setName(nextUser.name);
        setInterests(nextUser.preferences.interests.join(', '));
        setPace(nextUser.preferences.pace);
        setGoal(nextUser.preferences.goal);
        setPostCount(postResult.total);
        setPlaylistCount(nextPlaylists.length);
        onSessionUpdate(nextUser);
        setStatus('계정 정보가 최신 상태입니다.');
      } catch {
        if (mounted) {
          setStatus('계정 정보를 불러오지 못했습니다. 서버 상태를 확인하세요.');
        }
      }
    }

    void loadProfile();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.token]);

  async function submit(event: FormEvent) {
    event.preventDefault();

    if (isSaving) {
      return;
    }

    const trimmedName = name.trim();
    const trimmedCurrentPassword = currentPassword.trim();
    const trimmedPassword = password.trim();
    const nextPreferences = {
      interests: interests
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      pace: pace.trim(),
      goal: goal.trim(),
    };

    if (!trimmedName) {
      setStatus('이름을 입력하세요.');
      return;
    }

    if (!trimmedCurrentPassword) {
      setStatus('내 정보를 바꾸려면 현재 비밀번호로 본인 확인이 필요합니다.');
      return;
    }

    if (
      nextPreferences.interests.length === 0 ||
      !nextPreferences.pace ||
      !nextPreferences.goal
    ) {
      setStatus('관심사, 학습 속도, 목표를 모두 입력하세요.');
      return;
    }

    setIsSaving(true);
    setStatus('변경 사항을 저장하는 중입니다.');

    try {
      const nextUser = await updateMe(session.token, {
        currentPassword: trimmedCurrentPassword,
        name: trimmedName,
        password: trimmedPassword || undefined,
        preferences: nextPreferences,
      });

      setUser(nextUser);
      setName(nextUser.name);
      setInterests(nextUser.preferences.interests.join(', '));
      setPace(nextUser.preferences.pace);
      setGoal(nextUser.preferences.goal);
      setCurrentPassword('');
      setPassword('');
      onSessionUpdate(nextUser);
      setStatus('내 정보가 저장되었습니다.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '저장하지 못했습니다.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="page-shell profile-page">
      <section className="profile-hero">
        <div>
          <p className="eyebrow">My page</p>
          <h1>내 정보</h1>
          <p>
            계정 이름과 비밀번호를 관리하고, 지금까지 만든 학습 데이터를 한눈에
            확인합니다.
          </p>
        </div>
        <div className="profile-stats" aria-label="내 학습 데이터">
          <span>
            <strong>{postCount}</strong>
            등록 영상
          </span>
          <span>
            <strong>{playlistCount}</strong>
            재생목록
          </span>
        </div>
      </section>

      <section className="profile-layout">
        <form className="profile-form" onSubmit={submit}>
          <div className="section-title">
            <h2>계정 설정</h2>
            <span>{status}</span>
          </div>
          <label>
            이름
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="표시할 이름"
            />
          </label>
          <label>
            이메일
            <input value={user.email} readOnly />
          </label>
          <label>
            현재 비밀번호
            <input
              minLength={6}
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              placeholder="변경 저장 전 본인 확인"
            />
          </label>
          <label>
            새 비밀번호
            <input
              minLength={6}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="변경할 때만 입력"
            />
          </label>
          <label>
            관심사
            <input
              value={interests}
              onChange={(event) => setInterests(event.target.value)}
              placeholder="React, 영어 회화, 홈트"
            />
          </label>
          <label>
            학습 속도
            <input
              value={pace}
              onChange={(event) => setPace(event.target.value)}
              placeholder="하루 20분"
            />
          </label>
          <label>
            목표
            <textarea
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="어떤 목표로 영상을 공부하고 싶은지"
            />
          </label>
          <button type="submit" disabled={isSaving}>
            {isSaving ? '저장 중' : '변경 저장'}
          </button>
        </form>

        <aside className="profile-note">
          <strong>{user.name}</strong>
          <p>{user.email}</p>
          <p>{user.preferences.interests.join(', ')}</p>
          <span>{user.preferences.pace} · {user.preferences.goal}</span>
          <span>가입일 {formatDate(user.createdAt)}</span>
        </aside>
      </section>
    </main>
  );
}

function HomePage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [posts, setPosts] = useState<StudyPost[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [status, setStatus] = useState('학습 데이터를 불러오고 있어요');
  const latestPost = posts[0];
  const latestPlaylist = playlists[0];
  const playlistPosts = latestPlaylist
    ? posts.filter((post) => latestPlaylist.postIds.includes(post.id))
    : [];
  const feedbackCount = playlists.reduce(
    (sum, playlist) => sum + playlist.feedback.length,
    0,
  );

  useEffect(() => {
    async function boot() {
      try {
        const [postResult, playlistResult] = await Promise.all([
          fetchPosts(session.token, '', 1, 4),
          fetchPlaylists(session.token),
        ]);

        setPosts(postResult.items);
        setPlaylists(playlistResult);
        setStatus('저장된 학습 데이터가 준비됐어요');
      } catch {
        setStatus('서버를 실행하면 실제 학습 데이터가 표시돼요');
      }
    }

    void boot();
  }, [session.token]);

  return (
    <main className="page-shell product-home">
      <section className="product-home-grid">
        <div className="product-home-copy">
          <p className="eyebrow">StudyTube</p>
          <h1>{session.user.name}님, 바로 이어서 학습하세요</h1>
          <p>
            영상은 사이트 안에서 재생하고, AI 번역 자막·요약·구간 메모는 영상별로
            저장됩니다.
          </p>
          <div className="hero-actions">
            <Link className="primary-link" to="/watch">
              영상 학습 시작
            </Link>
            <button type="button" onClick={() => navigate('/explore')}>
              보드에서 고르기
            </button>
          </div>
          <p className="system-note">{status}</p>
        </div>

        <aside className="home-stats" aria-label="내 학습 현황">
          <span>
            <strong>{posts.length}</strong>
            내 영상 재료
          </span>
          <span>
            <strong>{playlists.length}</strong>
            재생목록
          </span>
          <span>
            <strong>{feedbackCount}</strong>
            피드백
          </span>
        </aside>
      </section>

      <section className="home-focus-grid">
        {latestPost ? (
          <article className="home-video-card">
            <img src={latestPost.thumbnailUrl} alt="" />
            <div>
              <small>{latestPost.channelName}</small>
              <h2>{latestPost.title}</h2>
              <p>{latestPost.summary}</p>
              <TagLine tags={latestPost.tags} />
              <button
                type="button"
                onClick={() => {
                  addVideosToQueue([queueVideoFromPost(latestPost)], queueVideoFromPost(latestPost));
                  navigate(`/watch?videoId=${extractYouTubeId(latestPost.videoUrl) ?? latestPost.id}`);
                }}
              >
                이 영상 보기
              </button>
            </div>
          </article>
        ) : (
          <article className="home-empty-card">
            <h2>아직 등록한 영상이 없습니다</h2>
            <p>유튜브 링크를 넣으면 제목, 채널, 태그, 요약을 자동으로 채워줍니다.</p>
            <Link className="primary-link" to="/board">
              영상 등록하기
            </Link>
          </article>
        )}

        <article className="home-course-card">
          <small>최근 재생목록</small>
          <h2>{latestPlaylist?.title ?? '재생목록을 만들어보세요'}</h2>
          <p>
            {latestPlaylist?.description ||
              '보드에서 마음에 드는 영상을 골라 순서대로 학습할 수 있습니다.'}
          </p>
          {playlistPosts.length > 0 && (
            <div className="home-course-list">
              {playlistPosts.slice(0, 3).map((post, index) => (
                <span key={post.id}>
                  <b>{index + 1}</b>
                  {post.title}
                </span>
              ))}
            </div>
          )}
          <Link className="primary-link" to="/search">
            AI로 추천 받기
          </Link>
        </article>
      </section>
    </main>
  );
}

function ExplorePage() {
  const navigate = useNavigate();
  const [posts, setPosts] = useState<StudyPost[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(
    null,
  );
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('공개 학습 플레이리스트를 불러오는 중입니다.');
  const [playlistQueue, setPlaylistQueue] = useState<QueueVideo[]>(() => readQueue());
  const filteredPlaylists = useMemo(
    () => filterPlaylists(playlists, posts, search),
    [playlists, posts, search],
  );
  const totalPages = Math.max(1, Math.ceil(filteredPlaylists.length / 6));
  const visiblePlaylists = filteredPlaylists.slice((page - 1) * 6, page * 6);
  const selectedPlaylist =
    filteredPlaylists.find((playlist) => playlist.id === selectedPlaylistId) ??
    visiblePlaylists[0] ??
    filteredPlaylists[0] ??
    null;
  const selectedPosts = selectedPlaylist
    ? postsForPlaylistIds(selectedPlaylist.postIds, posts)
    : [];
  const selectedVideos = selectedPosts.map(queueVideoFromPost);
  const selectedAlreadyInPlaylist =
    selectedVideos.length > 0 &&
    selectedVideos.every((video) => isVideoInQueue(playlistQueue, video));

  async function loadPublicBoard() {
    try {
      const [postResult, nextPlaylists] = await Promise.all([
        fetchPublicPosts('', 1, 80),
        fetchPublicPlaylists(),
      ]);
      setPosts(postResult.items);
      setPlaylists(nextPlaylists);
      setSelectedPlaylistId((current) =>
        nextPlaylists.some((playlist) => playlist.id === current)
          ? current
          : nextPlaylists[0]?.id ?? null,
      );
      setStatus(
        nextPlaylists.length > 0
          ? `${nextPlaylists.length}개의 공개 학습 플레이리스트를 찾았어요.`
          : '아직 공개 플레이리스트가 없어요. 영상 등록에서 여러 영상을 묶어 첫 코스를 만들어보세요.',
      );
    } catch {
      setStatus('공개 플레이리스트 보드를 불러오지 못했어요. 서버를 확인하세요.');
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPublicBoard();
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  function changeSearch(nextSearch: string) {
    setSearch(nextSearch);
    setPage(1);
    const count = filterPlaylists(playlists, posts, nextSearch).length;
    setStatus(
      count > 0
        ? `${count}개의 플레이리스트가 검색어와 맞아요.`
        : '맞는 플레이리스트가 없어요. 코스 찾기에서 새 코스를 만들어보세요.',
    );
  }

  function changePage(nextPage: number) {
    const boundedPage = Math.min(Math.max(nextPage, 1), totalPages);
    setPage(boundedPage);
  }

  function addSelectedPlaylistToQueue(watchAfterAdd = false) {
    if (!selectedPlaylist || selectedVideos.length === 0) {
      setStatus('이 플레이리스트에는 아직 담을 수 있는 영상 정보가 없어요.');
      return;
    }

    if (selectedAlreadyInPlaylist) {
      setStatus(`"${selectedPlaylist.title}" 코스는 이미 내 플레이리스트에 있어요.`);

      if (watchAfterAdd) {
        navigate(`/watch?videoId=${selectedVideos[0].videoId}`);
      }

      return;
    }

    const nextQueue = addVideosToQueue(selectedVideos, selectedVideos[0]);
    setPlaylistQueue(nextQueue);
    setStatus(`"${selectedPlaylist.title}" 코스의 ${selectedVideos.length}개 영상을 담았어요.`);

    if (watchAfterAdd) {
      navigate(`/watch?videoId=${selectedVideos[0].videoId}`);
    }
  }

  function openPlaylist() {
    const firstVideo = playlistQueue[0];

    if (firstVideo) {
      navigate(`/watch?videoId=${firstVideo.videoId}`);
    }
  }

  return (
    <main className="page-shell explore-page">
      <section className="page-heading">
        <p className="eyebrow">Public video board</p>
        <h1>다른 사람이 올린 학습 플레이리스트</h1>
        <p>
          보드는 영상 하나가 아니라 여러 영상을 묶은 학습 코스입니다. 코스를
          누르면 포함된 영상, 순서, AI 요약 포인트를 확인하고 통째로 담을 수 있습니다.
        </p>
        <div className="explore-search">
          <input
            value={search}
            onChange={(event) => changeSearch(event.target.value)}
            placeholder="영어 회화, 홈트, 요리, 재테크 같은 주제로 검색"
          />
          <Link className="primary-link" to="/board">
            영상 등록하기
          </Link>
        </div>
        <p className="system-note">{status}</p>
      </section>

      <section className="explore-board">
        <div className="explore-grid">
          {visiblePlaylists.map((playlist) => {
            const playlistPosts = postsForPlaylistIds(playlist.postIds, posts);
            const cover = playlistPosts[0];

            return (
            <button
              className={
                playlist.id === selectedPlaylist?.id
                  ? 'explore-card active'
                  : 'explore-card'
              }
              key={playlist.id}
              type="button"
              onClick={() => setSelectedPlaylistId(playlist.id)}
            >
              {cover ? <img src={cover.thumbnailUrl} alt="" /> : <div className="draft-thumbnail-placeholder">Course</div>}
              <span className="explore-card-body">
                <small>
                  {playlistPosts.length}개 영상 · 후기 {playlist.feedback.length}개
                </small>
                <strong>{playlist.title}</strong>
                <span className="card-summary">
                  {clipText(playlist.description || courseSummaryFromPosts(playlistPosts), 120)}
                </span>
                <TagLine tags={tagsFromPosts(playlistPosts).slice(0, 4)} />
              </span>
            </button>
            );
          })}
          {visiblePlaylists.length === 0 && (
            <div className="empty-product">
              <strong>공개 플레이리스트가 아직 없어요</strong>
              <p>영상 등록에서 여러 영상을 담아 코스로 올리면 이 보드에 표시됩니다.</p>
            </div>
          )}
        </div>

        <aside className="explore-detail">
          {selectedPlaylist ? (
            <>
              {selectedPosts[0] && <img src={selectedPosts[0].thumbnailUrl} alt="" />}
              <small>학습 코스 · {selectedPosts.length}개 영상</small>
              <h2>{selectedPlaylist.title}</h2>
              <p>{selectedPlaylist.description || courseSummaryFromPosts(selectedPosts)}</p>
              <div className="route-card-meta">
                <span>약 {estimateRouteMinutes(selectedPosts, selectedPlaylist.postIds.length)}분</span>
                <span>{selectedPosts.length}개 영상</span>
                <span>후기 {selectedPlaylist.feedback.length}개</span>
              </div>
              <div className="transcript-snippet">
                <span>AI 영상 분석 요약</span>
                <p>{courseAnalysisFromPosts(selectedPosts)}</p>
              </div>
              <ol className="playlist-step-list">
                {selectedPosts.map((post, index) => (
                  <li key={post.id}>
                    <b>{index + 1}</b>
                    <span>
                      <strong>{post.title}</strong>
                      <small>{post.channelName} · {estimateVideoMinutes(post)}분</small>
                    </span>
                  </li>
                ))}
              </ol>
              <TagLine tags={tagsFromPosts(selectedPosts)} />
              <div className="row-actions">
                <button
                  className={selectedAlreadyInPlaylist ? 'added-action' : undefined}
                  type="button"
                  disabled={selectedAlreadyInPlaylist || selectedVideos.length === 0}
                  onClick={() => addSelectedPlaylistToQueue()}
                >
                  {selectedAlreadyInPlaylist ? '이미 담긴 코스' : '코스 통째로 담기'}
                </button>
                <button
                  type="button"
                  disabled={selectedVideos.length === 0}
                  onClick={() => addSelectedPlaylistToQueue(true)}
                >
                  {selectedAlreadyInPlaylist ? '코스 보기' : '담고 코스 보기'}
                </button>
              </div>
              <p
                className={
                  selectedAlreadyInPlaylist ? 'playlist-state active' : 'playlist-state'
                }
              >
                {selectedAlreadyInPlaylist
                  ? '이 코스의 영상이 이미 내 플레이리스트에 담겨 있습니다.'
                  : '담으면 코스 전체가 영상 보기 화면의 재생목록에 순서대로 들어갑니다.'}
              </p>
            </>
          ) : (
            <div className="empty-product">
              <strong>플레이리스트를 선택해 주세요</strong>
              <p>보드에서 코스를 누르면 포함된 영상과 분석 요약을 확인할 수 있어요.</p>
            </div>
          )}
          <PlaylistPreview videos={playlistQueue} onOpen={openPlaylist} />
        </aside>
      </section>

      <div className="pagination wide-pagination">
        <button type="button" onClick={() => changePage(page - 1)}>
          이전
        </button>
        <span>
          {page} / {totalPages}
        </span>
        <button type="button" onClick={() => changePage(page + 1)}>
          다음
        </button>
      </div>
    </main>
  );
}

function BoardPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [posts, setPosts] = useState<StudyPost[]>([]);
  const [selectedPostId, setSelectedPostId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [editor, setEditor] = useState<PostEditor>(emptyEditor);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [status, setStatus] = useState(`${session.user.email} 계정으로 작업 중`);
  const [playlistQueue, setPlaylistQueue] = useState<QueueVideo[]>(() => readQueue());
  const [metadataStatus, setMetadataStatus] = useState('');
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isFetchingMetadata, setIsFetchingMetadata] = useState(false);
  const [courseTitle, setCourseTitle] = useState('나만의 학습 코스');
  const [courseDescription, setCourseDescription] = useState('');
  const [isPublishingCourse, setIsPublishingCourse] = useState(false);

  const selectedPost = useMemo(
    () => posts.find((post) => post.id === selectedPostId) ?? posts[0],
    [posts, selectedPostId],
  );
  const selectedVideo = selectedPost ? queueVideoFromPost(selectedPost) : null;
  const selectedAlreadyInPlaylist = selectedVideo
    ? isVideoInQueue(playlistQueue, selectedVideo)
    : false;
  const totalPages = Math.max(1, Math.ceil(total / 6));
  const draftVideoId = extractYouTubeId(editor.videoUrl);
  const draftThumbnailUrl =
    editor.thumbnailUrl || (draftVideoId ? youtubeThumbnailUrl(draftVideoId) : '');
  const hasDraftPreview = Boolean(
    editor.title.trim() || editor.summary.trim() || draftThumbnailUrl,
  );
  const canSaveDraft = Boolean(
    editor.videoUrl.trim() && editor.title.trim() && editor.summary.trim(),
  );

  useEffect(() => {
    async function boot() {
      try {
        await loadPosts('', 1);
        setStatus(`${session.user.email} 계정으로 작업 중`);
      } catch {
        setStatus('서버를 실행해야 게시판 기능을 사용할 수 있어요');
      }
    }

    void boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.token]);

  async function loadPosts(nextSearch = search, nextPage = page) {
    const result = await fetchPosts(session.token, nextSearch, nextPage, 6);
    setPosts(result.items);
    setTotal(result.total);
    setSelectedPostId((current) => {
      if (result.items.some((post) => post.id === current)) {
        return current;
      }

      return result.items[0]?.id ?? null;
    });
  }

  async function submitPost(event: FormEvent) {
    event.preventDefault();

    if (!session) {
      setStatus('먼저 로그인해주세요');
      return;
    }

    const payload = {
      title: editor.title.trim(),
      videoUrl: editor.videoUrl.trim(),
      thumbnailUrl: editor.thumbnailUrl.trim() || undefined,
      channelName: editor.channelName.trim() || 'YouTube',
      summary: editor.summary.trim(),
      translatedNotes: editor.translatedNotes.trim() || editor.summary.trim(),
      tags: editor.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    };

    if (!payload.title || !payload.videoUrl || !payload.summary) {
      setStatus('제목, 영상 URL, AI 분석 요약은 필수예요.');
      return;
    }

    if (isSaving) {
      return;
    }

    setIsSaving(true);

    try {
      const saved = editingId
        ? await updatePost(session.token, editingId, payload)
        : await createPost(session.token, payload);
      const savedVideo = queueVideoFromPost(saved);
      const nextQueue = addVideosToQueue([savedVideo], savedVideo);
      setPlaylistQueue(nextQueue);

      await loadPosts(search, 1);
      setPage(1);
      setSelectedPostId(saved.id);
      setStatus(
        editingId
          ? '영상 재료를 수정하고 플레이리스트 초안에도 반영했어요'
          : '영상 재료를 저장하고 플레이리스트 초안에 담았어요',
      );
      setEditor(emptyEditor);
      setEditingId(null);
      setIsEditingDetails(false);
      setMetadataStatus('');
    } catch {
      setStatus('게시글 저장에 실패했어요. 서버와 입력값을 확인하세요.');
    } finally {
      setIsSaving(false);
    }
  }

  function updateVideoUrl(videoUrl: string) {
    if (editingId) {
      setEditor((current) => ({ ...current, videoUrl }));
      setMetadataStatus('새 링크로 바꾸려면 다시 분석하면 됩니다.');
      return;
    }

    setEditor({
      ...emptyEditor,
      videoUrl,
    });
    setIsEditingDetails(false);
    setMetadataStatus(
      videoUrl.trim()
        ? '분석하기를 누르면 영상 정보를 가져옵니다.'
        : '',
    );
  }

  function startEdit(post: StudyPost) {
    setEditingId(post.id);
    setEditor({
      title: post.title,
      videoUrl: post.videoUrl,
      thumbnailUrl: post.thumbnailUrl,
      channelName: post.channelName,
      summary: post.summary,
      translatedNotes: post.translatedNotes,
      tags: post.tags.join(', '),
    });
    setIsEditingDetails(true);
    setMetadataStatus('저장된 영상 재료 정보를 수정 중입니다.');
  }

  async function autofillVideoMetadata(inputUrl = editor.videoUrl) {
    const videoUrl = inputUrl.trim();

    if (!videoUrl) {
      setMetadataStatus('YouTube URL을 먼저 입력하세요.');
      return;
    }

    setMetadataStatus('영상 정보를 불러오는 중입니다.');
    setIsFetchingMetadata(true);

    try {
      const result = await askMcp({ url: videoUrl, limit: 1 });
      const metadata = result.result?.videos[0] ?? result.result;

      if (!metadata?.title) {
        setMetadataStatus('영상 정보를 찾지 못했어요.');
        return;
      }

      const summary =
        metadata.summary && metadata.summary !== 'YouTube oEmbed metadata fetched through the MCP server.'
          ? metadata.summary
          : `${metadata.channel} 채널의 YouTube 학습 영상입니다. 제목과 채널 정보를 기준으로 게시글 요약을 자동 생성했습니다.`;

      setEditor((current) => ({
        ...current,
        title: metadata.title,
        channelName: metadata.channel,
        thumbnailUrl: metadata.thumbnailUrl,
        summary,
        translatedNotes:
          current.translatedNotes ||
          `${summary}\n\nAI 분석 요약: 핵심 개념, 구간별 학습 포인트, 복습 질문을 정리하세요.`,
        tags: deriveTags(`${metadata.title} ${metadata.channel} ${summary}`).join(', '),
      }));
      setIsEditingDetails(false);
      setMetadataStatus('분석 완료. 미리보기를 확인하고 바로 등록할 수 있어요.');
    } catch {
      setMetadataStatus('영상 정보 조회에 실패했어요.');
    } finally {
      setIsFetchingMetadata(false);
    }
  }

  async function removePost(id: number) {
    if (!session) {
      setStatus('먼저 로그인해주세요');
      return;
    }

    try {
      await deletePost(session.token, id);
      await loadPosts(search, page);
      setStatus('게시글을 삭제했어요');
    } catch {
      setStatus('게시글 삭제에 실패했어요');
    }
  }

  function addSelectedPostToQueue(post: StudyPost, watchAfterAdd = false) {
    const video = queueVideoFromPost(post);

    if (isVideoInQueue(playlistQueue, video)) {
      setStatus(`"${post.title}" 영상은 이미 내 플레이리스트에 있어요.`);

      if (watchAfterAdd) {
        navigate(`/watch?videoId=${video.videoId}`);
      }

      return;
    }

    const nextQueue = addVideosToQueue([video], video);
    setPlaylistQueue(nextQueue);
    setStatus(`"${post.title}" 영상을 내 플레이리스트에 담았어요.`);

    if (watchAfterAdd) {
      navigate(`/watch?videoId=${video.videoId}`);
    }
  }

  function openPlaylist() {
    const firstVideo = playlistQueue[0];

    if (firstVideo) {
      navigate(`/watch?videoId=${firstVideo.videoId}`);
    }
  }

  async function publishCurrentPlaylist(event: FormEvent) {
    event.preventDefault();
    const postIds = extractPostIds(playlistQueue);

    if (postIds.length === 0) {
      setStatus('플레이리스트로 올릴 영상 재료를 먼저 담아주세요.');
      return;
    }

    if (!courseTitle.trim()) {
      setStatus('플레이리스트 제목을 입력하세요.');
      return;
    }

    setIsPublishingCourse(true);

    try {
      const saved = await createPlaylist(session.token, {
        title: courseTitle.trim(),
        description:
          courseDescription.trim() ||
          `${postIds.length}개 영상으로 구성한 학습 플레이리스트입니다.`,
        postIds,
      });
      setStatus(`"${saved.title}" 플레이리스트를 보드에 올렸어요.`);
    } catch {
      setStatus('플레이리스트 저장에 실패했어요.');
    } finally {
      setIsPublishingCourse(false);
    }
  }

  async function submitComment(event: FormEvent) {
    event.preventDefault();

    if (!session || !selectedPost || !comment.trim()) {
      return;
    }

    try {
      await addComment(session.token, selectedPost.id, comment);
      await loadPosts(search, page);
      setComment('');
      setStatus('댓글을 등록했어요');
    } catch {
      setStatus('댓글 등록에 실패했어요');
    }
  }

  async function changeSearch(value: string) {
    setSearch(value);
    setPage(1);
    try {
      await loadPosts(value, 1);
    } catch {
      setStatus('검색에 실패했어요. 서버를 확인하세요.');
    }
  }

  async function changePage(nextPage: number) {
    const bounded = Math.min(totalPages, Math.max(1, nextPage));
    setPage(bounded);
    try {
      await loadPosts(search, bounded);
    } catch {
      setStatus('페이지 이동에 실패했어요');
    }
  }

  return (
    <main className="page-shell board-page">
      <section className="page-heading">
        <p className="eyebrow">Playlist board studio</p>
        <h1>유튜브 영상을 묶어 학습 플레이리스트를 올리세요</h1>
        <p>
          {status} · 링크를 분석해 영상 재료를 만들고, 여러 영상을 초안에 담은 뒤
          플레이리스트 자체를 보드에 공개합니다.
        </p>
      </section>

      <section className="board-grid">
        <aside className="board-panel post-browser">
          <div className="section-title">
            <h2>내 영상 재료</h2>
            <span>{total}개</span>
          </div>
          <input
            value={search}
            onChange={(event) => void changeSearch(event.target.value)}
            placeholder="코스 주제, 채널, 태그로 검색"
          />
          <div className="board-post-list">
            {posts.map((post) => (
              <button
                className={post.id === selectedPostId ? 'active' : ''}
                key={post.id}
                type="button"
                onClick={() => setSelectedPostId(post.id)}
              >
                <img src={post.thumbnailUrl} alt="" />
                <span>
                  <strong>{post.title}</strong>
                  <small>{post.channelName}</small>
                  <TagLine tags={post.tags.slice(0, 3)} />
                </span>
              </button>
            ))}
            {posts.length === 0 && (
              <p className="empty-copy">공유할 영상 재료가 아직 없어요.</p>
            )}
          </div>
          <div className="pagination">
            <button type="button" onClick={() => void changePage(page - 1)}>
              이전
            </button>
            <span>
              {page} / {totalPages}
            </span>
            <button type="button" onClick={() => void changePage(page + 1)}>
              다음
            </button>
          </div>
          <PlaylistPreview videos={playlistQueue} onOpen={openPlaylist} compact />
          <form className="playlist-publish-form" onSubmit={publishCurrentPlaylist}>
            <strong>플레이리스트로 보드에 올리기</strong>
            <input
              value={courseTitle}
              onChange={(event) => setCourseTitle(event.target.value)}
              placeholder="플레이리스트 제목"
            />
            <textarea
              value={courseDescription}
              onChange={(event) => setCourseDescription(event.target.value)}
              placeholder="이 코스가 어떤 순서로 무엇을 학습하는지"
            />
            <button
              type="submit"
              disabled={isPublishingCourse || extractPostIds(playlistQueue).length === 0}
            >
              {isPublishingCourse ? '올리는 중' : '플레이리스트 올리기'}
            </button>
          </form>
        </aside>

        <section className="board-panel post-detail">
          {selectedPost ? (
            <>
              <img src={selectedPost.thumbnailUrl} alt="" />
              <div className="section-title">
                <div>
                  <small>{selectedPost.channelName}</small>
                  <h2>{selectedPost.title}</h2>
                </div>
                <TagLine tags={selectedPost.tags} />
              </div>
              <p>{selectedPost.summary}</p>
              <div className="curation-meta" aria-label="curation fit">
                <span>
                  <b>{estimateVideoMinutes(selectedPost)}분</b>
                  예상 학습
                </span>
                <span>
                  <b>{difficultyLabel(selectedPost.tags)}</b>
                  추천 난이도
                </span>
                <span>
                  <b>{audienceLabel(selectedPost.tags)}</b>
                  맞는 사람
                </span>
              </div>
              <div className="note-panel">
                <span>AI 영상 분석 요약</span>
                <p>{selectedPost.translatedNotes}</p>
              </div>
              <div className="row-actions">
                <button
                  className={selectedAlreadyInPlaylist ? 'added-action' : undefined}
                  type="button"
                  disabled={selectedAlreadyInPlaylist}
                  onClick={() => addSelectedPostToQueue(selectedPost)}
                >
                  {selectedAlreadyInPlaylist ? '이미 담김' : '내 플레이리스트에 담기'}
                </button>
                <button
                  type="button"
                  onClick={() => addSelectedPostToQueue(selectedPost, true)}
                >
                  {selectedAlreadyInPlaylist ? '영상 보기' : '담고 영상 보기'}
                </button>
                <button type="button" onClick={() => startEdit(selectedPost)}>
                  수정
                </button>
                <button
                  className="danger"
                  type="button"
                  onClick={() => void removePost(selectedPost.id)}
                >
                  삭제
                </button>
              </div>
              <p
                className={
                  selectedAlreadyInPlaylist ? 'playlist-state active' : 'playlist-state'
                }
              >
                {selectedAlreadyInPlaylist
                  ? '이미 내 플레이리스트에 담긴 영상입니다.'
                  : '이 영상 재료를 초안에 담고, 여러 영상을 묶어 플레이리스트로 보드에 올릴 수 있습니다.'}
              </p>
              <div className="comments-box">
                <h3>댓글 {selectedPost.comments.length}개</h3>
                {selectedPost.comments.map((item) => (
                  <p key={item.id}>
                    <strong>{item.authorName}</strong>
                    {item.body}
                  </p>
                ))}
                <form className="inline-form" onSubmit={submitComment}>
                  <input
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    placeholder="댓글 작성"
                  />
                  <button type="submit">등록</button>
                </form>
              </div>
            </>
          ) : (
            <div className="empty-product">
              <strong>선택된 영상 재료가 없어요</strong>
              <p>아래 폼에서 학습 코스에 넣을 좋은 강의를 먼저 저장해보세요.</p>
            </div>
          )}
        </section>

        <section className="board-panel editor-panel">
          <div className="register-heading">
            <div>
              <p className="eyebrow">Add video</p>
              <h2>{editingId ? '영상 재료 수정' : 'YouTube 영상 재료 추가'}</h2>
              <p>
                링크를 분석하면 제목, 채널, 썸네일, AI 분석 요약이 먼저 채워집니다.
                저장하면 플레이리스트 초안에 들어가고, 초안을 코스로 발행합니다.
              </p>
            </div>
            {editingId && <span>수정 중 #{editingId}</span>}
          </div>
          <form className="video-register-form" onSubmit={submitPost}>
            <section className="link-capture">
              <label htmlFor="video-url-input">YouTube 링크</label>
              <div className="link-capture-row">
                <input
                  id="video-url-input"
                  value={editor.videoUrl}
                  onChange={(event) => updateVideoUrl(event.target.value)}
                  placeholder="https://www.youtube.com/watch?v=..."
                  disabled={isSaving}
                />
                <button
                  type="button"
                  disabled={isFetchingMetadata || isSaving || !editor.videoUrl.trim()}
                  onClick={() => void autofillVideoMetadata()}
                >
                  {isFetchingMetadata ? '분석 중' : '영상 분석하기'}
                </button>
              </div>
              <span className="metadata-status">
                {metadataStatus ||
                  '영상 링크 하나로 학습 카드 초안을 만듭니다.'}
              </span>
            </section>

            {hasDraftPreview ? (
              <section className="video-draft-preview">
                {draftThumbnailUrl ? (
                  <img src={draftThumbnailUrl} alt="" />
                ) : (
                  <div className="draft-thumbnail-placeholder">Preview</div>
                )}
                <div className="draft-copy">
                  <small>{editor.channelName || '채널 분석 대기'}</small>
                  <h3>{editor.title || '분석 후 영상 제목이 표시됩니다'}</h3>
                  <p>
                    {editor.summary ||
                      '영상 분석이 끝나면 보드에 표시될 요약이 여기에 들어갑니다.'}
                  </p>
                  <TagLine
                    tags={
                      editor.tags
                        .split(',')
                        .map((tag) => tag.trim())
                        .filter(Boolean)
                        .slice(0, 5)
                    }
                  />
                </div>
                <div className="draft-side">
                  <span>
                    <b>{editor.translatedNotes.trim() ? '준비됨' : '자동 초안'}</b>
                    AI 분석
                  </span>
                  <span>
                    <b>{draftVideoId ? 'YouTube' : '링크 확인'}</b>
                    영상 출처
                  </span>
                </div>
              </section>
            ) : (
              <section className="register-empty-preview">
                <strong>링크를 넣고 영상 분석하기를 눌러주세요</strong>
                <p>
                  분석 결과를 먼저 보여준 뒤 등록합니다. 제목이나 태그는 자동으로
                  채워지고, 마음에 안 드는 부분만 수정하면 됩니다.
                </p>
              </section>
            )}

            {hasDraftPreview && (
              <section className="detail-drawer">
                <button
                  className="detail-toggle"
                  type="button"
                  onClick={() => setIsEditingDetails((current) => !current)}
                >
                  {isEditingDetails ? '세부 정보 닫기' : '세부 정보 수정'}
                </button>
                {isEditingDetails && (
                  <div className="detail-fields">
                    <label>
                      영상 제목
                      <input
                        value={editor.title}
                        onChange={(event) =>
                          setEditor({ ...editor, title: event.target.value })
                        }
                        placeholder="보드에서 클릭할 영상 제목"
                        disabled={isSaving}
                      />
                    </label>
                    <label>
                      채널명
                      <input
                        value={editor.channelName}
                        onChange={(event) =>
                          setEditor({ ...editor, channelName: event.target.value })
                        }
                        placeholder="영상 출처 채널"
                        disabled={isSaving}
                      />
                    </label>
                    <label>
                      태그
                      <input
                        value={editor.tags}
                        onChange={(event) =>
                          setEditor({ ...editor, tags: event.target.value })
                        }
                        placeholder="영어, 운동, 요리, 입문"
                        disabled={isSaving}
                      />
                    </label>
                    <label className="wide-field">
                      요약
                      <textarea
                        value={editor.summary}
                        onChange={(event) =>
                          setEditor({ ...editor, summary: event.target.value })
                        }
                        placeholder="이 영상을 보면 무엇을 배울 수 있는지 적어주세요."
                        disabled={isSaving}
                      />
                    </label>
                    <label className="wide-field">
                      AI 분석 요약
                      <textarea
                        value={editor.translatedNotes}
                        onChange={(event) =>
                          setEditor({
                            ...editor,
                            translatedNotes: event.target.value,
                          })
                        }
                        placeholder="예: 핵심 개념, 구간별 학습 포인트, 복습 질문"
                        disabled={isSaving}
                      />
                    </label>
                  </div>
                )}
              </section>
            )}

            <div className="register-actions">
              <button type="submit" disabled={isSaving || !canSaveDraft}>
                {isSaving
                  ? '저장 중'
                  : editingId
                    ? '수정 저장'
                    : '영상 재료 추가하기'}
              </button>
              {(editingId || hasDraftPreview) && (
                <button
                  className="secondary-action"
                  type="button"
                  disabled={isSaving}
                  onClick={() => {
                    setEditingId(null);
                    setEditor(emptyEditor);
                    setMetadataStatus('');
                    setIsEditingDetails(false);
                  }}
                >
                  취소
                </button>
              )}
            </div>
          </form>
        </section>
      </section>
    </main>
  );
}

function CoursePage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const profile = session.user.preferences;
  const initialQuery = createPersonalizedCoursePrompt(profile);
  const [query, setQuery] = useState(initialQuery);
  const [ragResult, setRagResult] = useState<RagResponse | null>(null);
  const [courseMatches, setCourseMatches] = useState<Playlist[]>([]);
  const [agentResult, setAgentResult] = useState<AgentResponse | null>(null);
  const [mcpResult, setMcpResult] = useState<McpResponse | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [posts, setPosts] = useState<StudyPost[]>([]);
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<number, string>>({});
  const [status, setStatus] = useState(
    profile
      ? `${profile.interests[0]} 취향을 반영해 먼저 기존 보드에서 찾아볼게요.`
      : '원하는 코스를 입력하면 먼저 기존 플레이리스트 보드에서 찾고, 없으면 새로 만들어드립니다.',
  );
  const [isSearching, setIsSearching] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSavingPlaylist, setIsSavingPlaylist] = useState(false);

  useEffect(() => {
    void refreshCourseData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.token]);

  async function refreshCourseData() {
    try {
      const [nextPlaylists, postResult] = await Promise.all([
        fetchPlaylists(session.token),
        fetchPosts(session.token, '', 1, 60),
      ]);
      setPlaylists(nextPlaylists);
      setPosts(postResult.items);
    } catch {
      setStatus('학습 코스 데이터를 불러오지 못했어요. 서버를 확인하세요.');
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = query.trim();

    if (!trimmed || isSearching) {
      return;
    }

    setIsSearching(true);
    setAgentResult(null);
    setMcpResult(null);
    setStatus('먼저 기존 플레이리스트 보드와 저장된 학습 코스에서 찾는 중입니다.');

    try {
      const result = await askRag(trimmed);
      const matches = findMatchingCourses(playlists, posts, trimmed);
      setRagResult(result);
      setCourseMatches(matches);
      setStatus(
        result.relatedPosts.length > 0 || matches.length > 0
          ? '이미 올라온 코스나 영상 분석 요약을 찾았어요. 먼저 이것부터 확인해보세요.'
          : '기존 보드에는 딱 맞는 코스가 없어요. 새 YouTube 코스를 만들어볼 수 있습니다.',
      );
    } catch {
      setStatus('기존 코스 검색에 실패했어요. 서버를 확인하세요.');
    } finally {
      setIsSearching(false);
    }
  }

  async function generateNewCourse() {
    const goal = query.trim() || ragResult?.query || initialQuery;

    if (!goal || isGenerating) {
      return;
    }

    setIsGenerating(true);
    setStatus('새 코스를 만들기 위해 AI가 YouTube 후보와 기존 영상 분석 요약을 함께 살피는 중입니다.');

    const [agentResponse, mcpResponse] = await Promise.allSettled([
      askAgent(goal),
      askMcp(goal),
    ]);

    if (agentResponse.status === 'fulfilled') {
      setAgentResult(agentResponse.value);
    } else {
      setAgentResult(null);
    }

    if (mcpResponse.status === 'fulfilled') {
      setMcpResult(mcpResponse.value);
    } else {
      setMcpResult(null);
    }

    setStatus(
      agentResponse.status === 'fulfilled' || mcpResponse.status === 'fulfilled'
        ? '새 학습 코스 초안을 만들었어요. 저장하거나 바로 시청할 수 있습니다.'
        : '새 코스 생성에 실패했어요. AI 서버가 실행 중인지 확인하세요.',
    );
    setIsGenerating(false);
  }

  function addAndWatch(video: QueueVideo, relatedVideos: QueueVideo[]) {
    const queue = addVideosToQueue(relatedVideos, video);
    const firstVideo = queue.find((item) => item.id === video.id) ?? video;
    navigate(`/watch?videoId=${firstVideo.videoId}`);
  }

  function playSavedPlaylist(playlist: Playlist) {
    const courseVideos = postsForPlaylist(playlist).map((post) =>
      queueVideoFromPost(post),
    );

    if (courseVideos.length === 0) {
      setStatus('이 코스의 영상을 불러오지 못했어요. 플레이리스트 보드를 확인하세요.');
      return;
    }

    addVideosToQueue(courseVideos, courseVideos[0]);
    navigate(`/watch?videoId=${courseVideos[0].videoId}`);
  }

  function postsForPlaylist(playlist: Playlist) {
    return playlist.postIds
      .map((postId) => posts.find((post) => post.id === postId))
      .filter((post): post is StudyPost => Boolean(post));
  }

  async function saveGeneratedCourse() {
    const postIds = extractPostIds(generatedVideos);

    if (postIds.length === 0) {
      setStatus('저장 가능한 기존 영상 재료가 없어요. 새 YouTube 후보는 먼저 영상 등록에 저장해야 코스로 묶을 수 있습니다.');
      return;
    }

    setIsSavingPlaylist(true);

    try {
      const saved = await createPlaylist(session.token, {
        title: agentResult?.playlistTitle ?? `${query.trim() || initialQuery} 학습 코스`,
        description:
          agentResult?.rationale ??
          '내 취향과 검색 결과를 바탕으로 만든 학습 코스입니다.',
        postIds,
      });
      await refreshCourseData();
      setStatus(`"${saved.title}" 코스를 저장했어요.`);
    } catch {
      setStatus('학습 코스 저장에 실패했어요.');
    } finally {
      setIsSavingPlaylist(false);
    }
  }

  async function submitFeedback(event: FormEvent, playlist: Playlist) {
    event.preventDefault();
    const body = feedbackDrafts[playlist.id]?.trim();

    if (!body) {
      return;
    }

    try {
      await addPlaylistFeedback(session.token, playlist.id, {
        rating: 5,
        body,
      });
      setFeedbackDrafts((current) => ({ ...current, [playlist.id]: '' }));
      await refreshCourseData();
      setStatus('피드백이 저장됐어요.');
    } catch {
      setStatus('피드백 저장에 실패했어요.');
    }
  }

  const existingVideos = ragResult?.relatedPosts.map(queueVideoFromRagPost) ?? [];
  const agentVideos =
    agentResult?.recommendations.map((item) => queueVideoFromRecommendation(item)) ??
    [];
  const mcpVideos =
    mcpResult?.result?.videos.flatMap((item) => {
      const video = queueVideoFromMcpVideo(item);

      return video ? [video] : [];
    }) ?? [];
  const generatedVideos = uniqueVideos([...agentVideos, ...mcpVideos]);
  const promptSuggestions = createPromptSuggestions(profile);

  return (
    <main className="page-shell course-page">
      <section className="page-heading">
        <p className="eyebrow">Personal course finder</p>
        <h1>내 취향에 맞는 학습 코스 찾기</h1>
        <p>
          먼저 이미 올라온 학습 플레이리스트와 AI 영상 분석 요약을 확인합니다.
          없으면 AI가 YouTube까지 탐색해서 새 코스 초안을 만듭니다.
        </p>
        {profile && (
          <div className="preference-summary">
            <strong>{profile.goal}</strong>
            <span>{profile.interests.join(', ')} · {profile.pace}</span>
          </div>
        )}
        <div className="quick-prompts" aria-label="추천 예시">
          {promptSuggestions.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => setQuery(prompt)}
            >
              {prompt}
            </button>
          ))}
        </div>
        <form className="search-hero" onSubmit={submit}>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="예: 퇴근 후 20분씩 영어 회화를 배우고 싶어"
            disabled={isSearching || isGenerating}
          />
          <button type="submit" disabled={isSearching || isGenerating}>
            {isSearching ? '찾는 중' : '기존 코스 먼저 찾기'}
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={isSearching || isGenerating}
            onClick={() => void generateNewCourse()}
          >
            {isGenerating ? '만드는 중' : '새로 만들어줘'}
          </button>
        </form>
        <p className="system-note">{status}</p>
      </section>

      {(courseMatches.length > 0 || existingVideos.length > 0 || ragResult) && (
        <section className="course-results">
          <div className="section-title">
            <h2>기존 보드에서 먼저 찾은 결과</h2>
            <span>{courseMatches.length + existingVideos.length}개</span>
          </div>
          {courseMatches.map((playlist) => (
            <article className="course-match" key={playlist.id}>
              <div>
                <strong>{playlist.title}</strong>
                <p>{playlist.description || '이미 저장된 학습 코스입니다.'}</p>
                <div className="route-card-meta">
                  <span>{playlist.postIds.length}개 영상</span>
                  <span>후기 {playlist.feedback.length}개</span>
                </div>
              </div>
              <button type="button" onClick={() => playSavedPlaylist(playlist)}>
                이 코스 보기
              </button>
            </article>
          ))}
          {existingVideos.map((video) => (
            <button
              className="video-result"
              key={video.id}
              type="button"
              onClick={() => addAndWatch(video, existingVideos)}
            >
              <img src={video.thumbnailUrl} alt="" />
              <span>
                <strong>{video.title}</strong>
                <small>{video.channelName}</small>
                {video.evidenceSnippet && (
                  <p className="evidence-copy">{video.evidenceSnippet}</p>
                )}
                <em>AI 분석 기반 영상 보기</em>
              </span>
            </button>
          ))}
          {ragResult && existingVideos.length === 0 && courseMatches.length === 0 && (
            <div className="empty-product">
              <strong>아직 딱 맞는 코스가 없어요</strong>
              <p>새로 만들어달라고 하면 AI가 YouTube까지 탐색해서 코스 초안을 만듭니다.</p>
              <button type="button" onClick={() => void generateNewCourse()}>
                새 코스 만들기
              </button>
            </div>
          )}
        </section>
      )}

      {generatedVideos.length > 0 && (
        <section className="course-results">
          <div className="playlist-toolbar">
            <strong>새 코스 초안 {generatedVideos.length}개 영상</strong>
            <button
              type="button"
              disabled={isSavingPlaylist}
              onClick={() => void saveGeneratedCourse()}
            >
              {isSavingPlaylist ? '저장 중' : '학습 코스로 저장'}
            </button>
          </div>
          {generatedVideos.map((video) => (
            <button
              className="video-result"
              key={video.id}
              type="button"
              onClick={() => addAndWatch(video, generatedVideos)}
            >
              <img src={video.thumbnailUrl} alt="" />
              <span>
                <strong>{video.title}</strong>
                <small>{video.source}</small>
                <em>이 영상부터 코스로 보기</em>
              </span>
            </button>
          ))}
        </section>
      )}

      {agentResult && (
        <section className="agent-trace">
          <div className="section-title">
            <h2>AI가 코스를 만든 과정</h2>
            <span>{agentResult.trace.length}단계</span>
          </div>
          {agentResult.trace.map((step) => (
            <article key={`${step.iteration}-${step.tool}`}>
              <b>{step.iteration}</b>
              <div>
                <strong>{step.tool}</strong>
                <p>{step.reason}</p>
              </div>
            </article>
          ))}
        </section>
      )}

      <section className="saved-playlists">
        <div className="section-title">
          <h2>공개 학습 코스</h2>
          <span>{playlists.length}개</span>
        </div>
        {playlists.map((playlist) => (
          <article key={playlist.id}>
            <div>
              <strong>{playlist.title}</strong>
              <p>{playlist.description || '설명이 없는 학습 코스입니다.'}</p>
              <ol className="playlist-step-list">
                {playlist.postIds.map((postId, index) => {
                  const post = posts.find((item) => item.id === postId);

                  return (
                    <li key={`${playlist.id}-${postId}`}>
                      <b>{index + 1}</b>
                      <span>
                        <strong>{post?.title ?? `영상 재료 #${postId}`}</strong>
                        <small>
                          {post
                            ? `${post.channelName} · ${estimateVideoMinutes(post)}분`
                            : '영상 정보를 다시 불러와야 합니다'}
                        </small>
                      </span>
                    </li>
                  );
                })}
              </ol>
              <div className="route-card-meta">
                <span>{playlist.postIds.length}개 영상</span>
                <span>약 {estimateRouteMinutes(postsForPlaylist(playlist), playlist.postIds.length)}분</span>
                <span>후기 {playlist.feedback.length}개</span>
              </div>
              <button
                className="route-play-button"
                type="button"
                onClick={() => playSavedPlaylist(playlist)}
              >
                코스 바로 보기
              </button>
            </div>
            <form onSubmit={(event) => void submitFeedback(event, playlist)}>
              <input
                value={feedbackDrafts[playlist.id] ?? ''}
                onChange={(event) =>
                  setFeedbackDrafts((current) => ({
                    ...current,
                    [playlist.id]: event.target.value,
                  }))
                }
                placeholder="완주 후기나 추가하면 좋을 영상"
              />
              <button type="submit">저장</button>
            </form>
          </article>
        ))}
        {playlists.length === 0 && (
          <p className="empty-copy">아직 공개 학습 코스가 없어요. 원하는 코스를 검색해 첫 코스를 만들어보세요.</p>
        )}
      </section>
    </main>
  );
}

function WatchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [queue, setQueue] = useState<QueueVideo[]>(() => readQueue());
  const [currentTime, setCurrentTime] = useState(0);
  const [captionResponse, setCaptionResponse] = useState<CaptionResponse | null>(
    null,
  );
  const [captionError, setCaptionError] = useState('');
  const [isCaptionLoading, setIsCaptionLoading] = useState(false);
  const [summaryResponse, setSummaryResponse] =
    useState<VideoSummaryResponse | null>(null);
  const [summaryError, setSummaryError] = useState('');
  const [isSummaryLoading, setIsSummaryLoading] = useState(false);
  const [videoDurationState, setVideoDurationState] =
    useState<VideoDurationState>({
      videoId: '',
      duration: 0,
      waitExpired: false,
    });
  const [noteDraft, setNoteDraft] = useState('');
  const playerRef = useRef<YouTubePlayer | null>(null);
  const activeVideoId = searchParams.get('videoId');
  const currentVideo =
    queue.find((video) => video.videoId === activeVideoId) ?? queue[0] ?? null;
  const videoDuration =
    videoDurationState.videoId === currentVideo?.videoId
      ? videoDurationState.duration
      : 0;
  const durationWaitExpired =
    videoDurationState.videoId === currentVideo?.videoId
      ? videoDurationState.waitExpired
      : false;
  const learning = currentVideo
    ? getVideoLearningState(currentVideo)
    : DEFAULT_LEARNING_STATE;
  const captionsEnabled = learning.captionsEnabled;
  const captionLanguage = learning.captionLanguage;
  const captionResponseMatchesVideo =
    Boolean(currentVideo) &&
    Boolean(captionResponse) &&
    (captionResponse?.videoId === currentVideo?.videoId ||
      captionResponse?.videoId === '');
  const hasLiveCaptionResponse =
    Boolean(currentVideo) &&
    captionResponseMatchesVideo &&
    captionResponse.language === captionLanguage &&
    captionResponse.segments.length > 0 &&
    LIVE_CAPTION_PROVIDERS.has(captionResponse.provider);
  const liveCaptions = useMemo(
    () => (hasLiveCaptionResponse ? captionResponse!.segments : []),
    [captionResponse, hasLiveCaptionResponse],
  );
  const captions = liveCaptions;
  const shouldHoldLastCaption =
    captionResponseMatchesVideo &&
    ['openai-fallback-translation', 'timed-local-fallback'].includes(
      captionResponse?.provider ?? '',
    );
  const summaryResponseMatchesVideo =
    Boolean(currentVideo) &&
    Boolean(summaryResponse) &&
    summaryResponse?.videoId === currentVideo?.videoId &&
    summaryResponse?.language === captionLanguage &&
    summaryResponse.sections.length > 0;
  const isWaitingForSummaryCaptions =
    Boolean(currentVideo) &&
    (isCaptionLoading || (!captionResponseMatchesVideo && !captionError));
  const isSummaryBusy = isSummaryLoading || isWaitingForSummaryCaptions;
  const captionStatus = currentVideo
    ? isCaptionLoading
      ? 'AI 번역 자막 생성 중'
      : captionResponseMatchesVideo
      ? captionResponse.language !== captionLanguage
        ? '선택한 언어 자막을 불러오는 중'
        : LIVE_CAPTION_PROVIDERS.has(captionResponse.provider)
          ? `AI 번역 자막 · ${captionResponse.sourceLanguage} → ${captionResponse.language}`
          : captionError || captionUnavailableStatus(captionResponse.provider)
      : captionError || '실시간 번역 자막 불러오는 중'
    : '';
  const activeCaption = useMemo(() => {
    if (!captionsEnabled || captions.length === 0) {
      return null;
    }

    const timedCaption =
      captions.findLast(
        (segment) => currentTime >= segment.start && currentTime < segment.end,
      ) ?? null;

    if (timedCaption) {
      return timedCaption;
    }

    const lastCaption = captions[captions.length - 1];

    return shouldHoldLastCaption &&
      lastCaption &&
      currentTime >= lastCaption.end
      ? lastCaption
      : null;
  }, [captions, captionsEnabled, currentTime, shouldHoldLastCaption]);

  useEffect(() => {
    if (!currentVideo) {
      return;
    }

    if (isWaitingForSummaryCaptions) {
      return;
    }

    let cancelled = false;

    async function loadSummary() {
      setSummaryResponse(null);
      setSummaryError('');
      setIsSummaryLoading(true);

      try {
        const response = await fetchVideoSummary({
          videoId: currentVideo!.videoId,
          title: currentVideo!.title,
          channelName: currentVideo!.channelName,
          language: captionLanguage,
          summary: currentVideo!.summary,
          translatedNotes: currentVideo!.translatedNotes,
          segments:
            captionResponseMatchesVideo &&
            captionResponse?.language === captionLanguage
              ? captionResponse.segments
              : [],
        });

        if (!cancelled) {
          setSummaryResponse(response);
        }
      } catch {
        if (!cancelled) {
          setSummaryError('AI 상세 요약을 만들지 못했습니다.');
        }
      } finally {
        if (!cancelled) {
          setIsSummaryLoading(false);
        }
      }
    }

    void loadSummary();

    return () => {
      cancelled = true;
    };
  }, [
    captionError,
    captionLanguage,
    captionResponse,
    captionResponseMatchesVideo,
    currentVideo,
    isWaitingForSummaryCaptions,
  ]);

  useEffect(() => {
    if (!activeVideoId && queue[0]) {
      setSearchParams({ videoId: queue[0].videoId });
    }
  }, [activeVideoId, queue, setSearchParams]);

  useEffect(() => {
    if (!currentVideo) {
      return;
    }

    let cancelled = false;

    async function loadPlayer() {
      const youtube = await loadYouTubeApi();

      if (cancelled) {
        return;
      }

      if (!playerRef.current) {
        playerRef.current = new youtube.Player('youtube-player', {
          videoId: currentVideo.videoId,
          playerVars: {
            rel: 0,
            modestbranding: 1,
            enablejsapi: 1,
            cc_load_policy: 0,
            hl: 'ko',
            playsinline: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: (event) => {
              disableNativeCaptions(event.target);
              event.target.setPlaybackRate?.(learning.playbackRate);
              updateVideoDuration(
                event.target,
                currentVideo.videoId,
                setVideoDurationState,
              );
            },
            onStateChange: (event) => {
              if (event.data === 0) {
                playNext();
              }
            },
          },
        });
      } else {
        playerRef.current.loadVideoById(currentVideo.videoId);
        playerRef.current.setPlaybackRate?.(learning.playbackRate);
        disableNativeCaptions(playerRef.current);
      }
    }

    void loadPlayer();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentVideo?.videoId]);

  useEffect(() => {
    if (!currentVideo || videoDuration > 0 || durationWaitExpired) {
      return;
    }

    const videoId = currentVideo.videoId;
    const timeout = window.setTimeout(() => {
      setVideoDurationState((current) =>
        current.videoId === videoId && current.waitExpired
          ? current
          : {
              videoId,
              duration: current.videoId === videoId ? current.duration : 0,
              waitExpired: true,
            },
      );
    }, 2000);

    return () => window.clearTimeout(timeout);
  }, [currentVideo, durationWaitExpired, videoDuration]);

  useEffect(() => {
    const player = playerRef.current;

    if (!player) {
      return;
    }

    player.setPlaybackRate?.(learning.playbackRate);
  }, [currentVideo?.videoId, learning.playbackRate]);

  useEffect(() => {
    if (!currentVideo) {
      return;
    }

    let cancelled = false;

    async function loadCaptions() {
      setCaptionResponse(null);
      setCaptionError('');
      setIsCaptionLoading(true);

      if (videoDuration <= 0 && !durationWaitExpired) {
        return;
      }

      try {
        const response = await fetchTranslatedCaptions({
          videoId: currentVideo!.videoId,
          videoUrl: currentVideo!.videoUrl,
          targetLanguage: captionLanguage,
          allowFallback: false,
          translateFallback: false,
          durationSeconds: Math.round(
            videoDuration || DEFAULT_CAPTION_DURATION_SECONDS,
          ),
        });

        if (!cancelled) {
          setCaptionResponse(response);
          setCaptionError('');
        }
      } catch {
        if (!cancelled) {
          setCaptionError(
            '실시간 번역 자막을 가져오지 못했습니다.',
          );
        }
      } finally {
        if (!cancelled) {
          setIsCaptionLoading(false);
        }
      }
    }

    void loadCaptions();

    return () => {
      cancelled = true;
    };
  }, [captionLanguage, currentVideo, durationWaitExpired, videoDuration]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      try {
        if (playerRef.current) {
          updateVideoDuration(
            playerRef.current,
            currentVideo?.videoId ?? '',
            setVideoDurationState,
          );
        }

        const playerTime = playerRef.current?.getCurrentTime();
        if (typeof playerTime === 'number' && Number.isFinite(playerTime)) {
          if (
            learning.loop.enabled &&
            learning.loop.end > learning.loop.start &&
            playerTime >= learning.loop.end
          ) {
            playerRef.current?.seekTo?.(learning.loop.start, true);
            setCurrentTime(learning.loop.start);
            return;
          }

          setCurrentTime(playerTime);
          return;
        }
      } catch {
        // Keep the last known player time instead of inventing caption time.
      }
    }, 250);

    return () => window.clearInterval(interval);
  }, [
    currentVideo?.videoId,
    learning.loop.enabled,
    learning.loop.end,
    learning.loop.start,
  ]);

  function selectVideo(video: QueueVideo) {
    setCurrentTime(0);
    setNoteDraft('');
    setSearchParams({ videoId: video.videoId });
  }

  function playNext() {
    if (!currentVideo || queue.length === 0) {
      return;
    }

    const currentIndex = queue.findIndex((video) => video.id === currentVideo.id);
    const nextVideo = queue[(currentIndex + 1) % queue.length];
    setCurrentTime(0);
    setSearchParams({ videoId: nextVideo.videoId });
  }

  function removeVideo(video: QueueVideo) {
    const nextQueue = queue.filter((item) => item.id !== video.id);
    setQueue(nextQueue);
    saveQueue(nextQueue);

    if (video.id !== currentVideo?.id) {
      return;
    }

    const nextVideo = nextQueue[0];
    if (nextVideo) {
      setSearchParams({ videoId: nextVideo.videoId });
    } else {
      setSearchParams({});
    }
  }

  function clearQueue() {
    setQueue([]);
    saveQueue([]);
    setSearchParams({});
  }

  function updateCurrentVideoLearning(
    updater: (learningState: VideoLearningState) => VideoLearningState,
  ) {
    if (!currentVideo) {
      return;
    }

    setQueue((previousQueue) => {
      const nextQueue = previousQueue.map((video) =>
        video.id === currentVideo.id
          ? {
              ...video,
              learning: updater(getVideoLearningState(video)),
            }
          : video,
      );
      saveQueue(nextQueue);

      return nextQueue;
    });
  }

  function changeCaptionLanguage(language: CaptionLanguage) {
    updateCurrentVideoLearning((learningState) => ({
      ...learningState,
      captionLanguage: language,
    }));
  }

  function toggleCaptions() {
    updateCurrentVideoLearning((learningState) => ({
      ...learningState,
      captionsEnabled: !learningState.captionsEnabled,
    }));
  }

  function changePlaybackRate(playbackRate: number) {
    playerRef.current?.setPlaybackRate?.(playbackRate);
    updateCurrentVideoLearning((learningState) => ({
      ...learningState,
      playbackRate,
    }));
  }

  function updateLoopRange(patch: Partial<LoopRange>) {
    updateCurrentVideoLearning((learningState) => {
      const nextLoop = { ...learningState.loop, ...patch };
      const normalizedLoop = {
        ...nextLoop,
        manual:
          typeof patch.enabled === 'boolean'
            ? true
            : Boolean(nextLoop.manual),
        start: Math.max(0, Number(nextLoop.start.toFixed(1))),
        end: Math.max(0.5, Number(nextLoop.end.toFixed(1))),
      };

      if (normalizedLoop.end <= normalizedLoop.start) {
        normalizedLoop.end = Number((normalizedLoop.start + 5).toFixed(1));
      }

      return {
        ...learningState,
        loop: normalizedLoop,
      };
    });
  }

  function setLoopPoint(point: 'start' | 'end') {
    if (point === 'start') {
      updateLoopRange({ start: currentTime });
      return;
    }

    updateLoopRange({ end: currentTime });
  }

  function jumpTo(seconds: number) {
    playerRef.current?.seekTo?.(seconds, true);
    setCurrentTime(seconds);
  }

  function saveLearningMark() {
    const caption = activeCaption?.text || '';
    const note = noteDraft.trim() || caption || `${formatTime(currentTime)} 메모`;
    const start = activeCaption?.start ?? Math.max(0, currentTime - 2);
    const end = activeCaption?.end ?? currentTime + 4;

    updateCurrentVideoLearning((learningState) => ({
      ...learningState,
      marks: [
        {
          id: `${Date.now()}-${Math.round(start * 1000)}`,
          start,
          end: Math.max(end, start + 1),
          note,
          caption,
          createdAt: new Date().toISOString(),
        },
        ...learningState.marks,
      ].slice(0, 24),
    }));
    setNoteDraft('');
  }

  function deleteLearningMark(markId: string) {
    updateCurrentVideoLearning((learningState) => ({
      ...learningState,
      marks: learningState.marks.filter((mark) => mark.id !== markId),
    }));
  }

  function loopLearningMark(mark: LearningMark) {
    updateLoopRange({
      enabled: true,
      start: mark.start,
      end: mark.end,
    });
    jumpTo(mark.start);
  }

  if (!currentVideo) {
    return (
      <main className="page-shell simple-page">
        <p className="eyebrow">Watch</p>
        <h1>재생목록이 비어 있어요</h1>
        <p>코스 찾기나 플레이리스트 보드에서 보고 싶은 영상을 담으면 이곳에서 바로 볼 수 있어요.</p>
        <Link className="primary-link" to="/playlists">
          볼 코스 찾으러 가기
        </Link>
      </main>
    );
  }

  const summaryDetails = summaryResponseMatchesVideo
    ? summaryResponse!.sections
    : buildVideoSummaryDetails(currentVideo);
  const summaryBadge = isSummaryBusy
    ? '생성 중'
    : summaryResponseMatchesVideo
      ? `${summaryDetails.length}개 AI 포인트`
      : summaryError || '저장 요약';

  return (
    <main className="page-shell watch-page">
      <section className="watch-layout">
        <article className="watch-player">
          <div className="youtube-shell">
            <div id="youtube-player" />
            {activeCaption && (
              <div className="caption-overlay">{activeCaption.text}</div>
            )}
          </div>
          <div className="watch-meta">
            <div className="watch-meta-bar">
              <div className="watch-caption-meta">
                <small>{currentVideo.channelName}</small>
                <span>{captionStatus}</span>
              </div>
            </div>
            <h1>{currentVideo.title}</h1>
            <section className="watch-summary-card">
              <div className="section-title">
                <h2>영상 요약 정리</h2>
                <span>{summaryBadge}</span>
              </div>
              <div className="watch-summary-scroll">
                {isSummaryBusy && (
                  <article>
                    <b>AI 상세 요약 생성 중</b>
                    <p>영상 자막과 학습 맥락을 분석해 핵심 흐름, 표현, 복습 질문을 정리하고 있습니다.</p>
                  </article>
                )}
                {!isSummaryBusy && summaryDetails.map((detail) => (
                  <article key={`${detail.label}-${detail.body}`}>
                    <b>{detail.label}</b>
                    <p>{detail.body}</p>
                  </article>
                ))}
              </div>
            </section>
          </div>
        </article>

        <aside className="watch-queue study-rail">
          <section className="study-panel">
            <div className="section-title">
              <h2>학습 컨트롤</h2>
              <span>{formatTime(currentTime)}</span>
            </div>
            <div className="control-group">
              <span>자막 언어</span>
              <div className="choice-row">
                <button
                  className={captionLanguage === 'ko' ? 'active' : ''}
                  type="button"
                  onClick={() => changeCaptionLanguage('ko')}
                >
                  한글
                </button>
                <button
                  className={captionLanguage === 'en' ? 'active' : ''}
                  type="button"
                  onClick={() => changeCaptionLanguage('en')}
                >
                  English
                </button>
              </div>
            </div>
            <button
              className={captionsEnabled ? 'caption-toggle active' : 'caption-toggle'}
              type="button"
              onClick={toggleCaptions}
            >
              AI 자막 {captionsEnabled ? '끄기' : '켜기'}
            </button>
            <div className="control-group">
              <span>재생 속도</span>
              <div className="speed-grid">
                {PLAYBACK_RATES.map((rate) => (
                  <button
                    className={learning.playbackRate === rate ? 'active' : ''}
                    key={rate}
                    type="button"
                    onClick={() => changePlaybackRate(rate)}
                  >
                    {rate}x
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="study-panel">
            <div className="section-title">
              <h2>구간 반복</h2>
              <span>{learning.loop.enabled ? 'ON' : 'OFF'}</span>
            </div>
            <div className="loop-range">
              <label>
                시작
                <input
                  min="0"
                  step="0.5"
                  type="number"
                  value={learning.loop.start}
                  onChange={(event) =>
                    updateLoopRange({ start: Number(event.target.value) || 0 })
                  }
                />
              </label>
              <label>
                끝
                <input
                  min="0.5"
                  step="0.5"
                  type="number"
                  value={learning.loop.end}
                  onChange={(event) =>
                    updateLoopRange({ end: Number(event.target.value) || 0.5 })
                  }
                />
              </label>
            </div>
            <div className="loop-actions">
              <button type="button" onClick={() => setLoopPoint('start')}>
                현재 시작
              </button>
              <button type="button" onClick={() => setLoopPoint('end')}>
                현재 끝
              </button>
              <button
                className={learning.loop.enabled ? 'active' : ''}
                type="button"
                onClick={() => updateLoopRange({ enabled: !learning.loop.enabled })}
              >
                반복 {learning.loop.enabled ? '끄기' : '켜기'}
              </button>
            </div>
            <button
              className="wide-button subtle"
              type="button"
              onClick={() => jumpTo(learning.loop.start)}
            >
              {formatTime(learning.loop.start)}부터 재생
            </button>
          </section>

          <section className="study-panel">
            <div className="section-title">
              <h2>구간 메모</h2>
              <span>{learning.marks.length}개</span>
            </div>
            <textarea
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              placeholder="이 구간에서 기억할 개념을 적어두기"
            />
            <button type="button" onClick={saveLearningMark}>
              현재 구간 마킹
            </button>
            <div className="mark-list">
              {learning.marks.map((mark) => (
                <article key={mark.id}>
                  <button type="button" onClick={() => jumpTo(mark.start)}>
                    <b>{formatTime(mark.start)}</b>
                    <span>{mark.note}</span>
                  </button>
                  {mark.caption && <p>{mark.caption}</p>}
                  <div className="mark-actions">
                    <button type="button" onClick={() => loopLearningMark(mark)}>
                      반복
                    </button>
                    <button type="button" onClick={() => deleteLearningMark(mark.id)}>
                      삭제
                    </button>
                  </div>
                </article>
              ))}
              {learning.marks.length === 0 && (
                <p className="empty-copy">아직 저장한 구간이 없어요.</p>
              )}
            </div>
          </section>

          <section className="study-panel queue-panel">
            <div className="section-title">
              <h2>재생목록</h2>
              <span>{queue.length}개</span>
            </div>
          <div className="queue-list">
            {queue.map((video, index) => (
              <article
                className={video.id === currentVideo.id ? 'active' : ''}
                key={video.id}
              >
                <button type="button" onClick={() => selectVideo(video)}>
                  <img src={video.thumbnailUrl} alt="" />
                  <span>
                    <b>{index + 1}</b>
                    <strong>{video.title}</strong>
                    <small>{video.channelName}</small>
                  </span>
                </button>
                <button
                  aria-label={`${video.title} 삭제`}
                  className="queue-remove"
                  type="button"
                  onClick={() => removeVideo(video)}
                >
                  삭제
                </button>
              </article>
            ))}
          </div>
          <button className="wide-button" type="button" onClick={playNext}>
            다음 영상 재생
          </button>
          <button className="wide-button subtle" type="button" onClick={clearQueue}>
            재생목록 비우기
          </button>
          </section>
        </aside>
      </section>
    </main>
  );
}

function TagLine({ tags }: { tags: string[] }) {
  return (
    <span className="tags">
      {tags.map((tag) => (
        <em key={tag}>{tag}</em>
      ))}
    </span>
  );
}

function PlaylistPreview({
  videos,
  onOpen,
  compact = false,
}: {
  videos: QueueVideo[];
  onOpen: () => void;
  compact?: boolean;
}) {
  return (
    <section
      className={compact ? 'playlist-preview-panel compact' : 'playlist-preview-panel'}
    >
      <div className="section-title">
        <h2>내 플레이리스트</h2>
        <span>{videos.length}개</span>
      </div>
      {videos.length > 0 ? (
        <ol className="playlist-step-list">
          {videos.slice(0, compact ? 3 : 5).map((video, index) => (
            <li key={queueVideoKey(video)}>
              <b>{index + 1}</b>
              <span>
                <strong>{video.title}</strong>
                <small>{video.channelName}</small>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="empty-copy">아직 담긴 영상이 없어요.</p>
      )}
      {videos.length > 0 && videos.length > (compact ? 3 : 5) && (
        <small className="playlist-overflow">외 {videos.length - (compact ? 3 : 5)}개</small>
      )}
      <button
        className="wide-button subtle"
        type="button"
        disabled={videos.length === 0}
        onClick={onOpen}
      >
        플레이리스트 보기
      </button>
    </section>
  );
}

function queueVideoFromPost(post: StudyPost): QueueVideo {
  return {
    id: `post-${post.id}`,
    title: post.title,
    videoId: extractYouTubeId(post.videoUrl) ?? String(post.id),
    videoUrl: post.videoUrl,
    thumbnailUrl: post.thumbnailUrl,
    channelName: post.channelName,
    summary: post.summary,
    translatedNotes: post.translatedNotes,
    source: 'board',
  };
}

function queueVideoFromRagPost(post: RagResponse['relatedPosts'][number]) {
  return {
    id: `rag-${post.id}`,
    title: post.title,
    videoId: extractYouTubeId(post.videoUrl) ?? String(post.id),
    videoUrl: post.videoUrl,
    thumbnailUrl: post.thumbnailUrl,
    channelName: post.channelName,
    summary: post.summary,
    translatedNotes: post.translatedNotes,
    source: `AI 분석 매칭 ${post.score}`,
    evidenceSnippet: post.evidenceSnippet,
  };
}

function queueVideoFromRecommendation(
  item: AgentResponse['recommendations'][number],
): QueueVideo {
  const videoId = extractYouTubeId(item.url) ?? slugify(item.title);

  return {
    id: `agent-${videoId}-${slugify(item.title)}`,
    title: item.title,
    videoId,
    videoUrl: item.url,
    thumbnailUrl: item.thumbnailUrl,
    channelName: item.source,
    summary: item.why,
    translatedNotes: item.why,
    source: item.source,
  };
}

function queueVideoFromMcpVideo(
  item: NonNullable<McpResponse['result']>['videos'][number],
): QueueVideo | null {
  const videoId = item.videoId ?? extractYouTubeId(item.sourceUrl);

  if (!videoId) {
    return null;
  }

  return {
    id: `mcp-${videoId}`,
    title: item.title,
    videoId,
    videoUrl: item.sourceUrl,
    thumbnailUrl: item.thumbnailUrl,
    channelName: item.channel,
    summary: item.summary,
    translatedNotes: item.summary,
    source: item.provider,
  };
}

function uniqueVideos(videos: QueueVideo[]) {
  const seen = new Set<string>();

  return videos.filter((video) => {
    const key = queueVideoKey(video);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function queueVideoKey(video: QueueVideo) {
  return video.videoId || video.videoUrl || video.id;
}

function isVideoInQueue(queue: QueueVideo[], video: QueueVideo) {
  const key = queueVideoKey(video);

  return queue.some((queuedVideo) => queueVideoKey(queuedVideo) === key);
}

function captionUnavailableStatus(provider: string) {
  if (provider === 'ai-service-unavailable') {
    return 'AI 자막 서비스 응답을 받지 못했습니다.';
  }

  if (provider === 'caption-source-unavailable') {
    return '실제 자막 데이터를 찾지 못했습니다.';
  }

  if (provider === 'caption-translation-unavailable') {
    return '원문 자막은 찾았지만 AI 번역 자막을 만들지 못했습니다.';
  }

  if (provider === 'local-fallback') {
    return 'AI 번역 자막을 만들지 못했습니다.';
  }

  return 'YouTube 자막을 불러오지 못했습니다.';
}

function estimateRouteMinutes(posts: StudyPost[], fallbackCount: number) {
  const total = posts.reduce((sum, post) => sum + estimateVideoMinutes(post), 0);

  if (total > 0) {
    return total;
  }

  return Math.max(1, fallbackCount) * 14;
}

function estimateVideoMinutes(post: StudyPost) {
  const textWeight = Math.ceil(
    `${post.summary} ${post.translatedNotes}`.length / 180,
  );

  return Math.min(28, Math.max(8, 8 + textWeight * 3));
}

function difficultyLabel(tags: string[]) {
  const normalized = tags.map((tag) => tag.toLowerCase());

  if (normalized.some((tag) => ['입문', '기초', 'beginner', 'intro'].includes(tag))) {
    return '입문';
  }

  if (
    normalized.some((tag) =>
      ['advanced', '심화', 'pgvector', 'agent', 'nestjs'].includes(tag),
    )
  ) {
    return '실전';
  }

  return '중급';
}

function audienceLabel(tags: string[]) {
  const normalized = tags.map((tag) => tag.toLowerCase());

  if (normalized.some((tag) => ['react', 'frontend', 'hooks'].includes(tag))) {
    return '프론트 학습자';
  }

  if (
    normalized.some((tag) =>
      ['fastapi', 'nestjs', 'backend', 'springboot'].includes(tag),
    )
  ) {
    return '실습형 학습자';
  }

  if (normalized.some((tag) => ['ai', 'rag', 'agent', 'mcp'].includes(tag))) {
    return 'AI 서비스 빌더';
  }

  return '새 주제 입문자';
}

function extractPostIds(videos: QueueVideo[]) {
  return [
    ...new Set(
      videos
        .map((video) => video.id.match(/^(?:post|rag)-(\d+)$/)?.[1])
        .filter((id): id is string => Boolean(id))
        .map((id) => Number(id)),
    ),
  ];
}

function readQueue(): QueueVideo[] {
  try {
    const raw = window.localStorage.getItem(QUEUE_STORAGE_KEY);
    return raw
      ? (JSON.parse(raw) as QueueVideo[]).map((video) => normalizeQueueVideo(video))
      : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: QueueVideo[]) {
  window.localStorage.setItem(
    QUEUE_STORAGE_KEY,
    JSON.stringify(queue.map((video) => normalizeQueueVideo(video))),
  );
}

function readSession(): Session | null {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    return raw ? normalizeSession(JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function saveSession(session: Session) {
  window.localStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify(normalizeSession(session)),
  );
}

function normalizeSession(session: Session): Session {
  return {
    ...session,
    user: normalizeUser(session.user),
  };
}

function normalizeUser(user: User): User {
  return {
    ...user,
    preferences: normalizePreferences(user.preferences),
  };
}

function normalizePreferences(
  preferences: Partial<LearningPreferences> | undefined,
): LearningPreferences {
  const interests = Array.isArray(preferences?.interests)
    ? preferences.interests.filter((item): item is string => Boolean(item?.trim()))
    : [];

  return {
    interests: interests.length > 0 ? interests : ['YouTube 학습', '프론트엔드'],
    pace: preferences?.pace?.trim() || '하루 20분',
    goal: preferences?.goal?.trim() || '짧은 영상으로 꾸준히 복습하기',
  };
}

function createPersonalizedCoursePrompt(profile: PreferenceProfile | null) {
  if (!profile) {
    return '퇴근 후 20분씩 영어 회화를 배우고 싶어';
  }

  const interests = profile.interests.slice(0, 2).join('와 ');
  return `${interests}를 ${profile.pace} 배울 수 있는 코스 추천해줘`;
}

function createPromptSuggestions(profile: PreferenceProfile | null) {
  if (profile) {
    return [
      `${profile.interests[0]} 입문 코스`,
      `${profile.goal}`,
      `${profile.pace} 따라갈 수 있는 취미 코스`,
    ];
  }

  return [
    '퇴근 후 영어 회화',
    '집에서 하는 20분 운동',
    '요리 기초부터 배우기',
    '재테크 처음 시작하기',
  ];
}

function findMatchingCourses(
  playlists: Playlist[],
  posts: StudyPost[],
  query: string,
) {
  const tokens = tokenizeForMatch(query);

  if (tokens.length === 0) {
    return [];
  }

  return playlists
    .map((playlist) => {
      const coursePosts = playlist.postIds
        .map((postId) => posts.find((post) => post.id === postId))
        .filter((post): post is StudyPost => Boolean(post));
      const haystack = [
        playlist.title,
        playlist.description,
        ...coursePosts.flatMap((post) => [
          post.title,
          post.summary,
          post.translatedNotes,
          post.channelName,
          ...post.tags,
        ]),
      ]
        .join(' ')
        .toLowerCase();
      const score = tokens.filter((token) => haystack.includes(token)).length;

      return { playlist, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((item) => item.playlist)
    .slice(0, 3);
}

function filterPlaylists(
  playlists: Playlist[],
  posts: StudyPost[],
  query: string,
) {
  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    return playlists;
  }

  return playlists.filter((playlist) => {
    const playlistPosts = postsForPlaylistIds(playlist.postIds, posts);
    const haystack = [
      playlist.title,
      playlist.description,
      ...playlistPosts.flatMap((post) => [
        post.title,
        post.channelName,
        post.summary,
        post.translatedNotes,
        ...post.tags,
      ]),
    ]
      .join(' ')
      .toLowerCase();

    return haystack.includes(normalized);
  });
}

function postsForPlaylistIds(postIds: number[], posts: StudyPost[]) {
  return postIds
    .map((postId) => posts.find((post) => post.id === postId))
    .filter((post): post is StudyPost => Boolean(post));
}

function tagsFromPosts(posts: StudyPost[]) {
  return [...new Set(posts.flatMap((post) => post.tags))];
}

function courseSummaryFromPosts(posts: StudyPost[]) {
  if (posts.length === 0) {
    return '아직 영상 정보가 연결되지 않은 학습 코스입니다.';
  }

  return posts
    .slice(0, 3)
    .map((post, index) => `${index + 1}. ${post.title}`)
    .join(' · ');
}

function courseAnalysisFromPosts(posts: StudyPost[]) {
  if (posts.length === 0) {
    return 'AI 분석을 만들 영상이 아직 없습니다.';
  }

  return posts
    .slice(0, 4)
    .map((post, index) => {
      const summary = normalizeCaptionSource(post.summary || post.translatedNotes);

      return `${index + 1}. ${post.title}: ${clipText(summary, 120)}`;
    })
    .join('\n');
}

function tokenizeForMatch(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .filter((token) => !['코스', '추천', '배우고', '싶어'].includes(token));
}

function addVideosToQueue(videos: QueueVideo[], selectedVideo: QueueVideo) {
  const existingQueue = readQueue();
  const existingById = new Map(existingQueue.map((video) => [video.id, video]));
  const selectedFirst = [
    selectedVideo,
    ...videos.filter((video) => video.id !== selectedVideo.id),
  ].map((video) => mergeVideoLearning(video, existingById.get(video.id)));
  const selectedIds = new Set(selectedFirst.map((video) => video.id));
  const existing = existingQueue.filter((video) => !selectedIds.has(video.id));
  const nextQueue = uniqueVideos([...selectedFirst, ...existing]);
  saveQueue(nextQueue);

  return nextQueue;
}

function normalizeQueueVideo(video: QueueVideo): QueueVideo {
  return {
    ...video,
    learning: getVideoLearningState(video),
  };
}

function mergeVideoLearning(video: QueueVideo, existing?: QueueVideo): QueueVideo {
  return {
    ...normalizeQueueVideo(video),
    learning: existing
      ? getVideoLearningState(existing)
      : getVideoLearningState(video),
  };
}

function getVideoLearningState(video: QueueVideo): VideoLearningState {
  const learning = video.learning;
  const loop = learning?.loop ?? DEFAULT_LEARNING_STATE.loop;
  const loopWasExplicitlyEnabled = Boolean(loop.manual);

  return {
    captionLanguage:
      learning?.captionLanguage === 'en' || learning?.captionLanguage === 'ko'
        ? learning.captionLanguage
        : DEFAULT_LEARNING_STATE.captionLanguage,
    captionsEnabled:
      typeof learning?.captionsEnabled === 'boolean'
        ? learning.captionsEnabled
        : DEFAULT_LEARNING_STATE.captionsEnabled,
    playbackRate: PLAYBACK_RATES.includes(learning?.playbackRate ?? 0)
      ? learning!.playbackRate
      : DEFAULT_LEARNING_STATE.playbackRate,
    loop: {
      enabled:
        typeof loop.enabled === 'boolean'
          ? loop.enabled && loopWasExplicitlyEnabled
          : DEFAULT_LEARNING_STATE.loop.enabled,
      manual: loopWasExplicitlyEnabled,
      start: typeof loop.start === 'number' ? loop.start : DEFAULT_LEARNING_STATE.loop.start,
      end: typeof loop.end === 'number' ? loop.end : DEFAULT_LEARNING_STATE.loop.end,
    },
    marks: Array.isArray(learning?.marks)
      ? learning.marks
          .filter((mark) => typeof mark.note === 'string')
          .map((mark) => ({
            id: mark.id || `${mark.start}-${mark.createdAt || Date.now()}`,
            start: typeof mark.start === 'number' ? mark.start : 0,
            end:
              typeof mark.end === 'number'
                ? Math.max(mark.end, (mark.start ?? 0) + 1)
                : 4,
            note: mark.note,
            caption: mark.caption || '',
            createdAt: mark.createdAt || new Date().toISOString(),
          }))
      : [],
  };
}

function deriveTags(source: string) {
  const tokens = source
    .toLowerCase()
    .replace(/[^a-z0-9가-힣#+\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .filter(
      (token) =>
        ![
          'the',
          'and',
          'with',
          'course',
          'video',
          'youtube',
          '학습',
          '영상',
          '채널의',
        ].includes(token),
    );

  return [...new Set(tokens)].slice(0, 5);
}

function extractYouTubeId(url: string): string | null {
  const patterns = [
    /youtube\.com\/watch\?v=([^&]+)/,
    /youtu\.be\/([^?]+)/,
    /youtube\.com\/embed\/([^?]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function youtubeThumbnailUrl(videoId: string) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function buildVideoSummaryDetails(video: QueueVideo) {
  const details: Array<{ label: string; body: string }> = [];
  const summary = normalizeCaptionSource(video.summary);
  const notes = normalizeCaptionSource(video.translatedNotes);

  if (isReadableCaptionSource(summary)) {
    details.push({
      label: '핵심 요약',
      body: summary,
    });
  }

  if (isReadableCaptionSource(notes) && notes !== summary) {
    const timedBlocks = extractTimedSummaryBlocks(notes);

    if (timedBlocks.length > 0) {
      details.push(...timedBlocks);
    } else {
      details.push(
        ...splitSummaryParagraphs(notes).map((body, index) => ({
          label: index === 0 ? '학습 포인트' : `추가 정리 ${index + 1}`,
          body,
        })),
      );
    }
  }

  if (details.length === 0) {
    return [
      {
        label: '요약 준비 중',
        body: '이 영상에는 아직 자세한 요약이 저장되지 않았습니다. 영상 재료의 AI 분석 요약을 보강하면 이 영역에 학습 정리가 표시됩니다.',
      },
    ];
  }

  return details.slice(0, 12);
}

function extractTimedSummaryBlocks(text: string) {
  const matches = [
    ...text.matchAll(/(?:(\d{1,2}):)?(\d{1,2}):(\d{2})/g),
  ];

  return matches
    .map((match, index) => {
      const nextMatch = matches[index + 1];
      const body = text
        .slice(match.index! + match[0].length, nextMatch?.index ?? text.length)
        .replace(/\s+/g, ' ')
        .trim();

      return isReadableCaptionSource(body)
        ? {
            label: formatTime(captionTimestampToSeconds(match)),
            body,
          }
        : null;
    })
    .filter((block): block is { label: string; body: string } => Boolean(block));
}

function splitSummaryParagraphs(text: string) {
  const sentences = text
    .split(/(?<=[.!?。]|다\.)\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => isReadableCaptionSource(sentence));
  const chunks: string[] = [];

  for (let index = 0; index < sentences.length; index += 2) {
    chunks.push(sentences.slice(index, index + 2).join(' '));
  }

  return chunks.length > 0 ? chunks : [text];
}

function normalizeCaptionSource(value: string) {
  return value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('AI 분석 요약:'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isReadableCaptionSource(value: string) {
  const compact = value.replace(/\s+/g, '');

  if (compact.length < 3) {
    return false;
  }

  if (/[�\uF900-\uFAFF]/.test(compact)) {
    return false;
  }

  const questionMarks = compact.match(/\?/g)?.length ?? 0;

  if (
    /\?{2,}/.test(compact) ||
    (questionMarks >= 2 && questionMarks / compact.length > 0.12)
  ) {
    return false;
  }

  return /[a-zA-Z가-힣0-9]/.test(compact);
}

function captionTimestampToSeconds(match: RegExpMatchArray) {
  const hoursOrMinutes = Number(match[1] ?? 0);
  const minutesOrSeconds = Number(match[2]);
  const seconds = Number(match[3]);

  return match[1]
    ? hoursOrMinutes * 3600 + minutesOrSeconds * 60 + seconds
    : minutesOrSeconds * 60 + seconds;
}

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, '0');

  return `${minutes}:${seconds}`;
}

function clipText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, ' ').trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trim()}...`;
}

function disableNativeCaptions(player: YouTubePlayer) {
  try {
    player.unloadModule?.('captions');
  } catch {
    // The custom overlay still follows the local caption toggle.
  }
}

function updateVideoDuration(
  player: YouTubePlayer,
  videoId: string,
  setVideoDurationState: Dispatch<SetStateAction<VideoDurationState>>,
) {
  if (!videoId) {
    return;
  }

  try {
    const duration = player.getDuration?.();

    if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) {
      setVideoDurationState((current) =>
        current.videoId === videoId &&
        Math.abs(current.duration - duration) <= 0.5 &&
        current.waitExpired
          ? current
          : {
              videoId,
              duration,
              waitExpired: true,
            },
      );
    }
  } catch {
    // Duration becomes available asynchronously in the YouTube iframe API.
  }
}

function loadYouTubeApi(): Promise<YouTubeApi> {
  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }

  return new Promise((resolve) => {
    window.onYouTubeIframeAPIReady = () => {
      if (window.YT) {
        resolve(window.YT);
      }
    };

    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      document.body.appendChild(script);
    }
  });
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export default App;
