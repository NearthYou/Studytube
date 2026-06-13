import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Dispatch,
  FormEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  SetStateAction,
} from 'react';
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
  isDemoUserSession,
  normalizeSession,
  readSession,
  saveSession,
} from './authSession';
import { courseAnalysisSectionsFromPosts } from './courseAnalysis';
import {
  courseSummaryFromPosts,
  createPersonalizedCoursePrompt,
  createPromptSuggestions,
  filterPlaylists,
  findMatchingCourses,
  postsForPlaylistIds,
  tagsFromPosts,
} from './courseDiscovery';
import {
  EXPLORE_BOARD_PAGE_SIZE,
  paginateExplorePlaylists,
  selectExploreCommentPost,
  selectExplorePlaylist,
} from './exploreBoard';
import {
  captionStatusText,
  hasDisplayableLiveCaptionResponse,
  nativeYouTubeCaptionLanguage,
  selectActiveCaption,
  shouldUseNativeYouTubeCaptions,
  sourceCaptionTranslationPollDelay,
  syncNativeYouTubeCaptions,
  youtubeCaptionPlayerVars,
} from './captions';
import { playlistThumbnailStackFromPosts } from './playlistThumbnailStack';
import { isPointerInPlayerControlsHoverZone } from './playerControls';
import { SESSION_STORAGE_KEY } from './localStudyStorage';
import {
  audienceLabel,
  difficultyLabel,
  estimateQueueMinutes,
  estimateRouteMinutes,
  estimateVideoMinutes,
  sampleCaptionSegmentsForSummary,
} from './learningRouteMetrics';
import {
  DEFAULT_PLAYLIST_DRAFT_TITLE,
  createPlaylistDraft,
  patchActivePlaylistDraft,
  removePlaylistDraft,
  selectActivePlaylistDraft,
  type PlaylistDraftState,
} from './playlistDrafts';
import {
  buildWatchPlaylistChoices,
  findMatchingWatchPlaylistChoice,
  type WatchPlaylistChoice,
} from './watchLibrary';
import {
  fallbackPostEditorFromVideoUrl,
  hasPostEditorVideoUrl,
  isPostEditorReadyToSave,
  postRegistrationRefreshSearch,
  videoRegistrationSubmitLabel,
} from './postEditor';
import {
  authCompletionDestination,
  signupTutorialNextDestination,
  tutorialNextDestination,
  type AuthMode,
} from './onboarding';
import {
  DEFAULT_LEARNING_STATE,
  PLAYBACK_RATES,
  extractPostIds,
  findPostIdForQueueVideo,
  getVideoLearningState,
  isVideoInQueue,
  mergeVideosIntoQueue,
  normalizeQueueVideo,
  postPayloadFromQueueVideo,
  queueVideoFromMcpVideo,
  queueVideoFromPost,
  queueVideoFromRagPost,
  queueVideoFromRecommendation,
  queueVideoKey,
  uniqueVideos,
  type CaptionLanguage,
  type LearningMark,
  type LoopRange,
  type QueueVideo,
  type VideoLearningState,
} from './watchQueue';
import {
  addVideosToQueue,
  readPlaylistDraftState,
  readWatchQueue,
  savePlaylistDraftState,
  saveWatchQueue,
} from './watchQueueStorage';
import {
  deriveTags,
  extractYouTubeId,
  youtubeThumbnailUrl,
} from './videoMetadata';
import {
  buildVideoSummaryDetails,
  clipText,
  formatTime,
  formatVideoSummarySections,
} from './videoSummaryDetails';
import {
  addComment,
  askAgent,
  askMcp,
  askRag,
  createPlaylist,
  createPost,
  deleteComment,
  deletePost,
  demoSession,
  fetchPlaylists,
  fetchPosts,
  fetchPublicPlaylists,
  fetchPublicPosts,
  fetchTranslatedCaptions,
  fetchVideoSummary,
  fetchMe,
  isUnauthorizedRequest,
  login,
  signUp,
  updateMe,
  updatePost,
} from './api';
import type {
  AgentResponse,
  CaptionResponse,
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

const DEFAULT_CAPTION_DURATION_SECONDS = 600;
const MAX_SOURCE_CAPTION_TRANSLATION_POLLS = 13;
const LIVE_CAPTION_PROVIDERS = new Set([
  'youtube-timedtext',
  'yt-dlp-captions',
  'openai-caption-translation',
  'youtube-transcript-api',
  'youtube-source-captions',
]);
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
          path="/tutorial"
          element={
            <ProtectedRoute session={session}>
              <TutorialPage session={session!} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/board"
          element={
            <ProtectedRoute session={session}>
              <BoardPage
                session={session!}
                onSessionRefresh={handleAuthComplete}
              />
            </ProtectedRoute>
          }
        />
        <Route
          path="/explore"
          element={
            <ProtectedRoute session={session}>
              <ExplorePage session={session!} />
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
              <WatchPage session={session!} />
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
  mode: AuthMode;
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
    const destination = authCompletionDestination({ mode, from });

    onComplete(nextSession);
    navigate(destination, {
      replace: true,
      state:
        mode === 'signup'
          ? { next: signupTutorialNextDestination(from) }
          : undefined,
    });
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

function TutorialPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const location = useLocation();
  const nextPath = tutorialNextDestination(
    typeof location.state === 'object' &&
      location.state &&
      'next' in location.state
      ? location.state.next
      : undefined,
  );
  const nextLabel =
    nextPath === '/board' ? '튜토리얼 마치기' : '가던 곳으로 계속';
  const tutorialSteps = [
    {
      number: '01',
      title: '유튜브 링크를 학습 자료로 바꿉니다',
      body: '등록 화면에 영상 링크를 넣으면 제목, 채널, 태그, 요약 노트가 자동으로 정리됩니다.',
    },
    {
      number: '02',
      title: 'AI 추천으로 코스를 만듭니다',
      body: '관심 주제를 입력하면 관련 영상을 묶어 작은 플레이리스트로 시작할 수 있습니다.',
    },
    {
      number: '03',
      title: '학습 화면에서 자막, 메모, 반복 구간을 조절합니다',
      body: '영상을 보며 중요한 지점을 마킹해 메모하고, 한국어/영어 자막과 재생 속도, 반복 구간을 함께 조절할 수 있습니다.',
    },
  ];
  const tutorialHighlights = [
    '처음에는 영상 하나만 등록해도 충분합니다.',
    '보드에 쌓인 영상은 코스와 학습 큐로 다시 이어집니다.',
    '내 정보에서 관심사와 목표를 바꾸면 추천 맥락도 함께 바뀝니다.',
  ];
  const tutorialPreviewItems = [
    {
      label: '등록',
      title: '링크 분석',
      meta: '요약 · 태그 · 노트',
    },
    {
      label: '코스',
      title: 'AI 추천',
      meta: '관심사 기반 큐',
    },
    {
      label: '학습',
      title: '마킹 메모',
      meta: '자막 · 반복 구간',
    },
  ];

  function finishTutorial(destination: string) {
    navigate(destination, { replace: true });
  }

  return (
    <main className="page-shell tutorial-page">
      <section className="tutorial-hero">
        <div className="tutorial-copy">
          <p className="eyebrow">첫 시작</p>
          <h1>
            {session.user.name}님,
            <br />
            StudyTube는 영상을 공부 흐름으로 바꿉니다
          </h1>
          <p>
            링크를 모으는 곳에서 끝나지 않고, 요약과 코스 추천, 자막 기반 학습까지
            한 번에 이어가는 개인 학습 보드입니다.
          </p>
          <div className="tutorial-actions">
            <button type="button" onClick={() => finishTutorial('/board')}>
              첫 영상 등록
            </button>
            <button type="button" onClick={() => finishTutorial('/search')}>
              AI 추천 보기
            </button>
            <button
              className="quiet-button"
              type="button"
              onClick={() => finishTutorial(nextPath)}
            >
              {nextLabel}
            </button>
          </div>
        </div>

        <aside className="tutorial-preview" aria-label="StudyTube 핵심 흐름 미리보기">
          <div className="tutorial-preview-topbar">
            <span>StudyTube</span>
            <strong>01</strong>
          </div>
          <div className="tutorial-preview-main">
            <div className="tutorial-preview-card">
              <small>현재 흐름</small>
              <strong>영상 하나가 학습 코스로 바뀝니다</strong>
              <div className="tutorial-preview-bars" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            </div>
            <nav className="tutorial-preview-menu" aria-label="튜토리얼 단계">
              {tutorialPreviewItems.map((item) => (
                <span key={item.label}>
                  <b>{item.label}</b>
                  <strong>{item.title}</strong>
                  <small>{item.meta}</small>
                </span>
              ))}
            </nav>
          </div>
        </aside>
      </section>

      <section className="tutorial-flow" aria-label="서비스 이용 흐름">
        {tutorialSteps.map((step) => (
          <article key={step.number}>
            <span>{step.number}</span>
            <h2>{step.title}</h2>
            <p>{step.body}</p>
          </article>
        ))}
      </section>

      <section className="tutorial-note">
        <div>
          <p className="eyebrow">오늘의 시작점</p>
          <h2>영상 하나를 등록하면 나머지는 이어집니다</h2>
        </div>
        <ul>
          {tutorialHighlights.map((highlight) => (
            <li key={highlight}>{highlight}</li>
          ))}
        </ul>
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
            현재 비밀번호로 본인 확인을 마친 뒤 계정 정보와 학습 취향을 변경합니다.
            <br />
            이 취향은 코스 추천과 플레이리스트 탐색에 반영됩니다.
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
          <section className="profile-form-section identity-section">
            <div>
              <strong>본인 확인</strong>
              <p>이름, 비밀번호, 취향 중 하나라도 바꾸려면 현재 비밀번호가 필요합니다.</p>
            </div>
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
          </section>

          <section className="profile-form-section">
            <div>
              <strong>계정 정보</strong>
              <p>서비스 안에서 표시될 이름과 로그인 비밀번호를 관리합니다.</p>
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
              새 비밀번호
              <input
                minLength={6}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="변경할 때만 입력"
              />
            </label>
          </section>

          <section className="profile-form-section preference-section">
            <div>
              <strong>학습 취향</strong>
              <p>AI Agent가 코스를 추천할 때 사용할 관심사, 속도, 목표입니다.</p>
            </div>
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
          </section>
          <button type="submit" disabled={isSaving}>
            {isSaving ? '저장 중' : '변경 저장'}
          </button>
        </form>

        <aside className="profile-note">
          <strong>{user.name}</strong>
          <p>{user.email}</p>
          <small>현재 학습 취향</small>
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
  const latestPost = posts[0];
  const latestPlaylist = playlists[0];
  const playlistPosts = latestPlaylist
    ? posts.filter((post) => latestPlaylist.postIds.includes(post.id))
    : [];
  const latestVideo = latestPost ? queueVideoFromPost(latestPost) : null;
  const latestVideoTarget = latestPost
    ? `/watch?videoId=${extractYouTubeId(latestPost.videoUrl) ?? latestPost.id}`
    : '/watch';
  const nextQueuePosts =
    playlistPosts.length > 0 ? playlistPosts.slice(0, 3) : posts.slice(1, 4);

  function playLatestVideo() {
    if (!latestPost || !latestVideo) {
      navigate('/board');
      return;
    }

    addVideosToQueue([latestVideo], latestVideo);
    navigate(latestVideoTarget);
  }

  useEffect(() => {
    async function boot() {
      try {
        const [postResult, playlistResult] = await Promise.all([
          fetchPosts(session.token, '', 1, 4),
          fetchPlaylists(session.token),
        ]);

        setPosts(postResult.items);
        setPlaylists(playlistResult);
      } catch {
        setPosts([]);
        setPlaylists([]);
      }
    }

    void boot();
  }, [session.token]);

  return (
    <main className="page-shell product-home">
      <section className="product-home-hero">
        <div className="product-home-copy">
          <p className="eyebrow">오늘 학습</p>
          <h1>
            {session.user.name}님,
            <br />
            이어서 학습하세요
          </h1>
          <p>
            최근에 담은 영상 하나만 먼저 보여드릴게요. 바로 재생하거나,
            오늘 볼 다른 코스를 고를 수 있습니다.
          </p>
          <div className="home-hero-actions">
            {latestPost ? (
              <button type="button" onClick={playLatestVideo}>
                바로 재생
              </button>
            ) : (
              <Link className="primary-link" to="/board">
                영상 등록하기
              </Link>
            )}
            <button type="button" onClick={() => navigate('/search')}>
              다른 코스 보기
            </button>
          </div>
        </div>

        {latestPost ? (
          <article className="home-feature-card">
            <button
              className="home-feature-media"
              type="button"
              onClick={playLatestVideo}
              aria-label={`${latestPost.title} 바로 재생`}
            >
              <img src={latestPost.thumbnailUrl} alt="" />
              <span>▶</span>
            </button>
            <div className="home-feature-copy">
              <small>
                {latestPost.channelName} · 약 {estimateVideoMinutes(latestPost)}분
              </small>
              <h2>{latestPost.title}</h2>
              <p>{clipText(latestPost.summary || latestPost.translatedNotes, 140)}</p>
              <TagLine tags={latestPost.tags} />
            </div>
          </article>
        ) : (
          <article className="home-feature-card empty">
            <div className="home-empty-visual">학습</div>
            <div className="home-feature-copy">
              <small>첫 학습 영상 만들기</small>
              <h2>아직 등록한 영상이 없습니다</h2>
              <p>유튜브 링크 하나만 넣으면 제목, 채널, 태그, 요약을 자동으로 채워줍니다.</p>
              <Link className="primary-link" to="/board">
                영상 등록하기
              </Link>
            </div>
          </article>
        )}
      </section>

      <section className="home-support-grid">
        <article className="home-queue-card">
          <div className="section-title">
            <div>
              <small>{latestPlaylist ? '최근 코스' : '다음 단계'}</small>
              <h2>{latestPlaylist?.title ?? '다음 학습을 준비하세요'}</h2>
            </div>
            <Link to={latestPlaylist ? '/explore' : '/board'}>
              {latestPlaylist ? '코스 보기' : '영상 등록'}
            </Link>
          </div>
          <p>
            {latestPlaylist?.description ||
              '영상이 쌓이면 여기에서 오늘 이어갈 작은 학습 큐를 보여드립니다.'}
          </p>
          {nextQueuePosts.length > 0 ? (
            <div className="home-course-list">
              {nextQueuePosts.map((post, index) => (
                <button
                  key={post.id}
                  type="button"
                  onClick={() => {
                    const video = queueVideoFromPost(post);

                    addVideosToQueue([video], video);
                    navigate(`/watch?videoId=${extractYouTubeId(post.videoUrl) ?? post.id}`);
                  }}
                >
                  <b>{index + 1}</b>
                  <span>
                    <strong>{post.title}</strong>
                    <small>{post.channelName} · 약 {estimateVideoMinutes(post)}분</small>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="home-queue-empty">
              보드에서 영상을 담으면 다음 학습 큐가 여기에 조용히 쌓입니다.
            </p>
          )}
        </article>
      </section>
    </main>
  );
}

function ExplorePage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [posts, setPosts] = useState<StudyPost[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(
    null,
  );
  const [commentPostId, setCommentPostId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('공개 학습 플레이리스트를 불러오는 중입니다.');
  const [playlistQueue, setPlaylistQueue] = useState<QueueVideo[]>(() =>
    readWatchQueue(),
  );
  const filteredPlaylists = useMemo(
    () => filterPlaylists(playlists, posts, search),
    [playlists, posts, search],
  );
  const totalPages = Math.max(
    1,
    Math.ceil(filteredPlaylists.length / EXPLORE_BOARD_PAGE_SIZE),
  );
  const visiblePlaylists = paginateExplorePlaylists(filteredPlaylists, page);
  const selectedPlaylist = selectExplorePlaylist(
    filteredPlaylists,
    selectedPlaylistId,
  );
  const selectedPosts = useMemo(
    () =>
      selectedPlaylist ? postsForPlaylistIds(selectedPlaylist.postIds, posts) : [],
    [posts, selectedPlaylist],
  );
  const selectedCommentPost = selectExploreCommentPost(selectedPosts, commentPostId);
  const selectedCommentTotal = selectedPosts.reduce(
    (count, post) => count + post.comments.length,
    0,
  );
  const selectedAnalysisSections = useMemo(
    () => courseAnalysisSectionsFromPosts(selectedPosts),
    [selectedPosts],
  );
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
          : null,
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
      setStatus(`"${selectedPlaylist.title}" 코스는 이미 담겨 있어요.`);

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

  function closeSelectedPlaylist() {
    setSelectedPlaylistId(null);
    setCommentPostId(null);
  }

  function openSelectedPlaylist(playlistId: number) {
    setSelectedPlaylistId(playlistId);
    setCommentPostId(null);
  }

  async function refreshPublicBoardAfterComment() {
    await loadPublicBoard();
  }

  return (
    <main className="page-shell explore-page">
      <section className="page-heading">
        <p className="eyebrow">Public video board</p>
        <h1>
          다른 사람이 올린 학습
          <br />
          플레이리스트
        </h1>
        <p>
          보드는 영상 하나가 아니라 여러 영상을 묶은 학습 코스입니다. <br /> 코스를
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

            return (
              <button
                className={
                  playlist.id === selectedPlaylist?.id
                    ? 'explore-card active'
                    : 'explore-card'
                }
                key={playlist.id}
                type="button"
                onClick={() => openSelectedPlaylist(playlist.id)}
              >
                <PlaylistThumbnailStack posts={playlistPosts} />
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

        {selectedPlaylist && (
          <div
            className="explore-detail-overlay"
            role="presentation"
            onClick={closeSelectedPlaylist}
          >
            <aside
              aria-label="선택한 게시글 상세"
              aria-modal="true"
              className="explore-detail"
              role="dialog"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                className="detail-close-button"
                type="button"
                onClick={closeSelectedPlaylist}
              >
                닫기
              </button>
              <div className="explore-detail-hero">
                <PlaylistThumbnailStack posts={selectedPosts} size="detail" />
                <div className="explore-detail-copy">
                  <small>학습 코스 · {selectedPosts.length}개 영상</small>
                  <h2>{selectedPlaylist.title}</h2>
                  <p>{selectedPlaylist.description || courseSummaryFromPosts(selectedPosts)}</p>
                  <div className="route-card-meta">
                    <span>약 {estimateRouteMinutes(selectedPosts, selectedPlaylist.postIds.length)}분</span>
                    <span>{selectedPosts.length}개 영상</span>
                    <span>후기 {selectedPlaylist.feedback.length}개</span>
                  </div>
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
                      ? '이 코스의 영상이 이미 담겨 있습니다.'
                      : '담으면 코스 전체가 영상 보기 화면의 재생목록에 순서대로 들어갑니다.'}
                  </p>
                </div>
              </div>
              <div className="explore-detail-content">
                <div className="analysis-snippet">
                  <span>AI 영상 분석 요약</span>
                  <div className="analysis-section-list">
                    {selectedAnalysisSections.map((section) => (
                      <article className="analysis-section" key={section.heading}>
                        <strong>{section.heading}</strong>
                        <p>{section.body}</p>
                      </article>
                    ))}
                    {selectedAnalysisSections.length === 0 && (
                      <p className="analysis-empty">
                        AI 분석을 만들 영상이 아직 없습니다.
                      </p>
                    )}
                  </div>
                </div>
                <section className="course-video-strip">
                  <div className="section-title">
                    <h3>코스 순서</h3>
                    <span>{selectedPosts.length}개</span>
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
                </section>
              </div>
              <div className="explore-detail-lower">
                {selectedCommentPost && (
                  <section className="comments-stack compact" aria-label="코스 영상 댓글">
                    <div className="section-title">
                      <div>
                        <small>Board comments</small>
                        <h3>댓글</h3>
                      </div>
                      <span>{selectedCommentTotal}개</span>
                    </div>
                    <div className="comment-target-tabs" aria-label="댓글을 볼 영상 선택">
                      {selectedPosts.map((post, index) => (
                        <button
                          className={
                            post.id === selectedCommentPost.id ? 'active' : undefined
                          }
                          key={post.id}
                          type="button"
                          onClick={() => setCommentPostId(post.id)}
                        >
                          {index + 1}
                        </button>
                      ))}
                    </div>
                    <CommentSection
                      post={selectedCommentPost}
                      token={session.token}
                      currentUserId={session.user.id}
                      title={selectedCommentPost.title}
                      onChanged={refreshPublicBoardAfterComment}
                    />
                  </section>
                )}
              </div>
            </aside>
          </div>
        )}
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

function BoardPage({
  onSessionRefresh,
  session,
}: {
  onSessionRefresh: (session: Session) => void;
  session: Session;
}) {
  const navigate = useNavigate();
  const [posts, setPosts] = useState<StudyPost[]>([]);
  const [selectedPostId, setSelectedPostId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [editor, setEditor] = useState<PostEditor>(emptyEditor);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [status, setStatus] = useState(`${session.user.email} 계정으로 작업 중`);
  const [playlistDraftState, setPlaylistDraftState] =
    useState<PlaylistDraftState<QueueVideo>>(() => readPlaylistDraftState());
  const [metadataStatus, setMetadataStatus] = useState('');
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isFetchingMetadata, setIsFetchingMetadata] = useState(false);
  const [isPublishingCourse, setIsPublishingCourse] = useState(false);
  const [isBoardReady, setIsBoardReady] = useState(false);
  const activeDraft = selectActivePlaylistDraft(playlistDraftState);
  const playlistDrafts = playlistDraftState.drafts;
  const playlistQueue = activeDraft.videos;
  const courseTitle = activeDraft.title;
  const courseDescription = activeDraft.description;
  const activeDraftTitle = courseTitle.trim() || DEFAULT_PLAYLIST_DRAFT_TITLE;

  const selectedPost = useMemo(
    () => posts.find((post) => post.id === selectedPostId) ?? posts[0],
    [posts, selectedPostId],
  );
  const selectedVideo = selectedPost ? queueVideoFromPost(selectedPost) : null;
  const selectedAlreadyInPlaylist = selectedVideo
    ? isVideoInQueue(playlistQueue, selectedVideo)
    : false;
  const playlistPostIds = extractPostIds(playlistQueue);
  const playlistMinutes = estimateQueueMinutes(playlistQueue);
  const totalPages = Math.max(1, Math.ceil(total / 6));
  const draftVideoId = extractYouTubeId(editor.videoUrl);
  const draftThumbnailUrl =
    editor.thumbnailUrl || (draftVideoId ? youtubeThumbnailUrl(draftVideoId) : '');
  const hasDraftPreview = Boolean(
    editor.title.trim() || editor.summary.trim() || draftThumbnailUrl,
  );
  const canSubmitVideo = isBoardReady && hasPostEditorVideoUrl(editor);
  const isVideoReadyToSave = isPostEditorReadyToSave(editor);
  const submitVideoLabel = videoRegistrationSubmitLabel({
    isEditing: Boolean(editingId),
    isFetchingMetadata,
    isSaving,
    readyToSave: isVideoReadyToSave,
  });

  useEffect(() => {
    async function boot() {
      setIsBoardReady(false);
      try {
        await loadPosts('', 1);
        setIsBoardReady(true);
        setStatus(`${session.user.email} 계정으로 작업 중`);
      } catch (error) {
        if (isUnauthorizedRequest(error) && isDemoUserSession(session)) {
          try {
            const refreshedSession = await refreshDemoBoardSession();
            await loadPosts('', 1, refreshedSession.token);
            setIsBoardReady(true);
            setStatus(`${refreshedSession.user.email} 계정으로 작업 중`);
            return;
          } catch {
            // Fall through to the generic message below.
          }
        }

        setIsBoardReady(false);
        setStatus(
          isUnauthorizedRequest(error)
            ? '로그인 세션이 만료됐어요. 다시 로그인한 뒤 영상을 등록해주세요.'
            : '서버를 실행하거나 다시 로그인해야 게시판 기능을 사용할 수 있어요',
        );
      }
    }

    void boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.token]);

  async function loadPosts(
    nextSearch = search,
    nextPage = page,
    token = session.token,
  ) {
    const result = await fetchPosts(token, nextSearch, nextPage, 6);
    setPosts(result.items);
    setTotal(result.total);
    setSelectedPostId((current) => {
      if (result.items.some((post) => post.id === current)) {
        return current;
      }

      return result.items[0]?.id ?? null;
    });
  }

  async function refreshDemoBoardSession() {
    const nextSession = await demoSession();
    onSessionRefresh(nextSession);

    return nextSession;
  }

  function commitPlaylistDraftState(
    updater: (
      current: PlaylistDraftState<QueueVideo>,
    ) => PlaylistDraftState<QueueVideo>,
  ) {
    setPlaylistDraftState((current) => {
      const nextState = updater(current);
      savePlaylistDraftState(nextState);

      return nextState;
    });
  }

  function updateActiveDraft(patch: {
    title?: string;
    description?: string;
    videos?: QueueVideo[];
  }) {
    commitPlaylistDraftState((current) =>
      patchActivePlaylistDraft(current, patch),
    );
  }

  function createNewPlaylistDraft() {
    const draft = createPlaylistDraft<QueueVideo>({
      title: `작업 코스 ${playlistDrafts.length + 1}`,
    });
    commitPlaylistDraftState((current) => ({
      drafts: [draft, ...current.drafts],
      activeDraftId: draft.id,
    }));
    setStatus('새 작업 코스를 만들었어요.');
  }

  function switchPlaylistDraft(draftId: string) {
    const nextDraft = playlistDrafts.find((draft) => draft.id === draftId);
    commitPlaylistDraftState((current) => ({
      ...current,
      activeDraftId: draftId,
    }));
    setStatus(`"${nextDraft?.title || '선택한 코스'}" 코스를 편집 중입니다.`);
  }

  function deleteActivePlaylistDraft() {
    const replacementDraft = createPlaylistDraft<QueueVideo>();
    commitPlaylistDraftState((current) =>
      removePlaylistDraft(current, activeDraft.id, replacementDraft),
    );
    setStatus(`"${activeDraftTitle}" 코스를 삭제했어요.`);
  }

  async function analyzeVideoMetadataForEditor(
    inputUrl = editor.videoUrl,
    baseEditor = editor,
  ): Promise<{ nextEditor: PostEditor; status: string } | null> {
    const videoUrl = inputUrl.trim();
    const result = await askMcp({ url: videoUrl, limit: 1 });
    const metadata = result.result?.videos[0] ?? result.result;

    if (!metadata?.title) {
      return null;
    }

    const title = metadata.title;
    const channelName = metadata.channel || 'YouTube';
    const sourceUrl = metadata.sourceUrl || videoUrl;
    const metadataVideoId =
      'videoId' in metadata && typeof metadata.videoId === 'string'
        ? metadata.videoId
        : undefined;
    const sourceVideoId =
      metadataVideoId || extractYouTubeId(sourceUrl) || extractYouTubeId(videoUrl);
    let summary =
      metadata.summary &&
      metadata.summary !== 'YouTube oEmbed metadata fetched through the MCP server.'
        ? metadata.summary
        : `${channelName} 채널의 YouTube 학습 영상입니다. 제목과 채널 정보를 기준으로 게시글 요약을 자동 생성했습니다.`;
    let translatedNotes = `${summary}\n\nAI 분석 요약: 핵심 개념, 구간별 학습 포인트, 복습 질문을 정리하세요.`;
    let nextMetadataStatus = '분석 완료. 미리보기를 확인하고 바로 등록할 수 있어요.';

    if (sourceVideoId) {
      try {
        const captions = await fetchTranslatedCaptions({
          videoId: sourceVideoId,
          videoUrl: sourceUrl,
          targetLanguage: 'en',
          fallbackText: summary,
          translateFallback: false,
        });
        const detailedSummary = await fetchVideoSummary({
          videoId: sourceVideoId,
          title,
          channelName,
          language: 'ko',
          summary,
          translatedNotes,
          segments: sampleCaptionSegmentsForSummary(captions.segments),
        });
        const formattedNotes = formatVideoSummarySections(detailedSummary.sections);
        const firstSummary = detailedSummary.sections.find((section) =>
          section.body.trim(),
        )?.body;

        if (formattedNotes) {
          translatedNotes = formattedNotes;
        }

        if (firstSummary) {
          summary = clipText(firstSummary, 280);
        }

        nextMetadataStatus = `AI 영상 분석 완료. ${detailedSummary.sections.length}개 학습 포인트를 채웠어요.`;
      } catch {
        nextMetadataStatus =
          '영상 기본 정보는 가져왔지만 AI 상세 요약은 만들지 못했어요. 세부 정보에서 직접 보강할 수 있습니다.';
      }
    }

    return {
      nextEditor: {
        ...baseEditor,
        title,
        videoUrl,
        channelName,
        thumbnailUrl:
          metadata.thumbnailUrl ||
          baseEditor.thumbnailUrl ||
          (sourceVideoId ? youtubeThumbnailUrl(sourceVideoId) : ''),
        summary,
        translatedNotes: baseEditor.translatedNotes || translatedNotes,
        tags: deriveTags(`${title} ${channelName} ${summary}`).join(', '),
      },
      status: nextMetadataStatus,
    };
  }

  function postPayloadFromEditor(sourceEditor: PostEditor) {
    return {
      title: sourceEditor.title.trim(),
      videoUrl: sourceEditor.videoUrl.trim(),
      thumbnailUrl: sourceEditor.thumbnailUrl.trim() || undefined,
      channelName: sourceEditor.channelName.trim() || 'YouTube',
      summary: sourceEditor.summary.trim(),
      translatedNotes:
        sourceEditor.translatedNotes.trim() || sourceEditor.summary.trim(),
      tags: sourceEditor.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    };
  }

  async function savePostWithSessionRecovery(
    payload: ReturnType<typeof postPayloadFromEditor>,
  ) {
    try {
      const saved = editingId
        ? await updatePost(session.token, editingId, payload)
        : await createPost(session.token, payload);

      return { saved, token: session.token };
    } catch (error) {
      if (!isUnauthorizedRequest(error) || !isDemoUserSession(session)) {
        throw error;
      }

      setStatus('데모 세션을 다시 연결한 뒤 영상을 저장합니다.');
      const refreshedSession = await refreshDemoBoardSession();
      const saved = editingId
        ? await updatePost(refreshedSession.token, editingId, payload)
        : await createPost(refreshedSession.token, payload);

      return { saved, token: refreshedSession.token };
    }
  }

  async function submitPost(event: FormEvent) {
    event.preventDefault();

    if (!session) {
      setStatus('먼저 로그인해주세요');
      return;
    }

    if (!editor.videoUrl.trim()) {
      setStatus('YouTube 링크를 먼저 입력하세요.');
      setMetadataStatus('YouTube URL을 먼저 입력하세요.');
      return;
    }

    if (isSaving || isFetchingMetadata) {
      return;
    }

    setIsSaving(true);

    try {
      let editorToSave = editor;

      if (!isPostEditorReadyToSave(editorToSave)) {
        setIsFetchingMetadata(true);
        setMetadataStatus('영상 정보를 분석한 뒤 바로 저장합니다.');

        try {
          const analyzed = await analyzeVideoMetadataForEditor(
            editorToSave.videoUrl,
            editorToSave,
          );

          const fallbackEditor = fallbackPostEditorFromVideoUrl(
            editorToSave.videoUrl,
            editorToSave,
          );

          if (!analyzed && !fallbackEditor) {
            setStatus(
              '영상 정보를 찾지 못했어요. URL을 확인하거나 세부 정보를 직접 입력해주세요.',
            );
            setMetadataStatus('영상 정보를 찾지 못했어요.');
            setIsEditingDetails(true);
            return;
          }

          editorToSave = analyzed?.nextEditor ?? fallbackEditor!;
          setEditor(editorToSave);
          setMetadataStatus(
            analyzed?.status ||
              '영상 분석을 완료하지 못했지만 기본 정보로 먼저 저장합니다.',
          );
        } catch {
          const fallbackEditor = fallbackPostEditorFromVideoUrl(
            editorToSave.videoUrl,
            editorToSave,
          );

          if (!fallbackEditor) {
            setStatus(
              '영상 정보 조회에 실패했어요. URL을 확인하거나 세부 정보를 직접 입력해주세요.',
            );
            setMetadataStatus('영상 정보 조회에 실패했어요.');
            setIsEditingDetails(true);
            return;
          }

          editorToSave = fallbackEditor;
          setEditor(editorToSave);
          setMetadataStatus(
            '영상 분석을 완료하지 못했지만 기본 정보로 먼저 저장합니다.',
          );
        } finally {
          setIsFetchingMetadata(false);
        }
      }

      const payload = postPayloadFromEditor(editorToSave);

      if (!payload.title || !payload.videoUrl || !payload.summary) {
        setStatus('제목, 영상 URL, AI 분석 요약은 필수예요.');
        setIsEditingDetails(true);
        return;
      }

      try {
        const { saved, token } = await savePostWithSessionRecovery(payload);
        const savedVideo = queueVideoFromPost(saved);
        const nextQueue = mergeVideosIntoQueue(
          playlistQueue,
          [savedVideo],
          savedVideo,
        );
        updateActiveDraft({ videos: nextQueue });

        const refreshSearch = postRegistrationRefreshSearch(search);
        setSearch(refreshSearch);
        await loadPosts(refreshSearch, 1, token);
        setPage(1);
        setSelectedPostId(saved.id);
        setStatus(
          editingId
            ? '영상을 수정하고 작업 중인 코스에도 반영했어요.'
            : '영상을 저장하고 작업 중인 코스에 담았어요.',
        );
        setEditor(emptyEditor);
        setEditingId(null);
        setIsEditingDetails(false);
        setMetadataStatus('');
      } catch (error) {
        if (isUnauthorizedRequest(error)) {
          setIsBoardReady(false);
          setStatus('로그인 세션이 만료됐어요. 다시 로그인한 뒤 영상을 등록해주세요.');
          setMetadataStatus('다시 로그인한 뒤 등록을 이어갈 수 있어요.');
          return;
        }

        setStatus('게시글 저장에 실패했어요. 서버와 입력값을 확인하세요.');
      }
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
        ? isBoardReady
          ? '아래 버튼으로 분석과 추가를 한 번에 진행합니다.'
          : '게시판 연결이 끊겼어요. 다시 로그인한 뒤 등록해주세요.'
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
    setMetadataStatus('저장된 영상 정보를 수정 중입니다.');
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
      setStatus(`"${post.title}" 영상은 이미 "${activeDraftTitle}" 코스에 있어요.`);

      if (watchAfterAdd) {
        navigate(`/watch?videoId=${video.videoId}`);
      }

      return;
    }

    const nextQueue = mergeVideosIntoQueue(playlistQueue, [video], video);
    updateActiveDraft({ videos: nextQueue });
    setStatus(`"${post.title}" 영상을 "${activeDraftTitle}" 코스에 담았어요.`);

    if (watchAfterAdd) {
      navigate(`/watch?videoId=${video.videoId}`);
    }
  }

  function openPlaylist() {
    const firstVideo = playlistQueue[0];

    if (firstVideo) {
      saveWatchQueue(playlistQueue);
      navigate(`/watch?videoId=${firstVideo.videoId}`);
    }
  }

  async function publishCurrentPlaylist(event: FormEvent) {
    event.preventDefault();
    const postIds = extractPostIds(playlistQueue);

    if (postIds.length === 0) {
      setStatus('공개할 코스에 영상을 먼저 담아주세요.');
      return;
    }

    if (!courseTitle.trim()) {
      setStatus('코스 제목을 입력하세요.');
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
      commitPlaylistDraftState((current) =>
        removePlaylistDraft(current, activeDraft.id, createPlaylistDraft<QueueVideo>()),
      );
      setStatus(`"${saved.title}" 코스를 보드에 올렸어요.`);
    } catch {
      setStatus('코스 공개에 실패했어요.');
    } finally {
      setIsPublishingCourse(false);
    }
  }

  function removeVideoFromDraft(video: QueueVideo) {
    const nextQueue = playlistQueue.filter(
      (item) => queueVideoKey(item) !== queueVideoKey(video),
    );
    updateActiveDraft({ videos: nextQueue });
    setStatus(`"${video.title}" 영상을 작업 중인 코스에서 뺐어요.`);
  }

  function clearDraftPlaylist() {
    updateActiveDraft({ videos: [] });
    setStatus('작업 중인 코스를 비웠어요.');
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

  const registrationSteps = [
    {
      number: '01',
      title: editingId ? '수정할 링크 확인' : '링크 입력',
      body: 'YouTube URL',
    },
    {
      number: '02',
      title: '영상 보관함 저장',
      body: '제목, 요약, 태그 자동 정리',
    },
    {
      number: '03',
      title: editingId ? '수정 반영' : '작업 코스에 담김',
      body: editingId ? '기존 카드 업데이트' : activeDraftTitle,
    },
  ];
  const detailToggleLabel = isEditingDetails
    ? '세부 정보 닫기'
    : '필요한 정보만 수정';

  return (
    <main className="page-shell board-page">
      <section className="page-heading">
        <p className="eyebrow">Playlist board studio</p>
        <h1>영상 추가부터 코스 공개까지</h1>
        <p>
          링크를 넣으면 영상 보관함에 저장되고, 바로 작업 중인 코스에 담깁니다.
          필요한 영상만 모아 순서를 정한 뒤 보드에 공개하세요.
        </p>
        <p className="system-note">{status}</p>
      </section>

      <section className="board-grid">
        <section className="board-panel editor-panel">
          <div className="register-heading">
            <div className="register-title-copy">
              <p className="eyebrow">1. 영상 추가</p>
              <h2>{editingId ? '영상 정보 수정' : 'YouTube 링크 저장'}</h2>
              <p>
                URL 하나면 보관함 저장과 작업 코스 담기를 한 번에 처리합니다.
              </p>
            </div>
            <aside className="register-destination" aria-label="등록 저장 위치">
              <span>{editingId ? '수정 대상' : '저장 후 들어갈 곳'}</span>
              <strong>{editingId ? `영상 #${editingId}` : activeDraftTitle}</strong>
              <small>
                {editingId
                  ? '저장된 카드 업데이트'
                  : `${playlistQueue.length}개 영상으로 구성 중`}
              </small>
            </aside>
          </div>
          <form className="video-register-form" onSubmit={submitPost}>
            <section className={canSubmitVideo ? 'link-capture ready' : 'link-capture'}>
              <div className="field-heading">
                <label htmlFor="video-url-input">YouTube 링크</label>
                <small>URL만 붙여넣기</small>
              </div>
              <div className="link-capture-row">
                <input
                  id="video-url-input"
                  value={editor.videoUrl}
                  onChange={(event) => updateVideoUrl(event.target.value)}
                  placeholder="https://www.youtube.com/watch?v=..."
                  disabled={isSaving}
                />
                <button
                  className="link-submit-button"
                  type="submit"
                  disabled={isSaving || isFetchingMetadata || !canSubmitVideo}
                >
                  {submitVideoLabel}
                </button>
              </div>
              <span className={metadataStatus ? 'metadata-status active' : 'metadata-status'}>
                {metadataStatus ||
                  '분석이 끝나면 보관함과 작업 코스에 바로 추가됩니다.'}
              </span>
            </section>
            <ol className="registration-path" aria-label="영상 등록 흐름">
              {registrationSteps.map((step) => (
                <li key={step.number}>
                  <b>{step.number}</b>
                  <span>
                    <strong>{step.title}</strong>
                    <small>{step.body}</small>
                  </span>
                </li>
              ))}
            </ol>

            <div className="registration-workspace">
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
                      <b>{editor.translatedNotes.trim() ? '준비됨' : '자동 정리'}</b>
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
                  <strong>먼저 링크만 넣어도 됩니다</strong>
                  <p>
                    제목, 썸네일, 요약은 분석 후 자동으로 채워집니다. 필요한 항목만
                    열어 수정하세요.
                  </p>
                </section>
              )}

              <aside className="registration-support" aria-label="등록 후 연결">
                <strong>{editingId ? '수정 저장 전 확인' : '저장되면'}</strong>
                <ul>
                  <li>영상 보관함에 추가</li>
                  <li>{editingId ? '선택한 카드 업데이트' : '작업 중인 코스에 담김'}</li>
                  <li>선택한 영상으로 바로 표시</li>
                </ul>
              </aside>
            </div>

            {hasDraftPreview && (
              <section className="detail-drawer">
                <div className="detail-drawer-header">
                  <span>
                    <strong>세부 정보</strong>
                    <small>자동 입력값이 어색할 때만 열어 수정하세요.</small>
                  </span>
                  <button
                    className="detail-toggle"
                    type="button"
                    onClick={() => setIsEditingDetails((current) => !current)}
                  >
                    {detailToggleLabel}
                  </button>
                </div>
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

            {(editingId || hasDraftPreview) && (
              <div className="register-actions">
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
                  입력 초기화
                </button>
              </div>
            )}
          </form>
        </section>

        <section className="board-panel playlist-builder-panel">
          <div className="section-title">
            <div>
              <small>2. 작업 중인 코스</small>
              <h2>코스 구성</h2>
            </div>
            <span>{playlistDrafts.length}개 코스</span>
          </div>
          <section className="draft-switcher" aria-label="작업 코스 선택">
            <div className="draft-switcher-header">
              <div>
                <small>현재 코스</small>
                <strong>{activeDraftTitle}</strong>
              </div>
              <span>{playlistQueue.length}개 영상</span>
            </div>
            <div className="draft-tabs">
              {playlistDrafts.map((draft, index) => (
                <button
                  className={draft.id === activeDraft.id ? 'active' : ''}
                  key={draft.id}
                  type="button"
                  onClick={() => switchPlaylistDraft(draft.id)}
                >
                  <small>코스 {index + 1}</small>
                  <strong>{draft.title || DEFAULT_PLAYLIST_DRAFT_TITLE}</strong>
                  <span>{draft.videos.length}개 영상</span>
                </button>
              ))}
            </div>
            <div className="draft-actions">
              <button type="button" onClick={createNewPlaylistDraft}>
                새 코스
              </button>
              <button
                className="danger-light"
                type="button"
                onClick={deleteActivePlaylistDraft}
              >
                이 코스 삭제
              </button>
            </div>
          </section>
          <p className="builder-copy">
            지금 공개할 영상만 여기에 모입니다. 새로 등록한 영상은 자동으로 들어오고,
            보관함에서도 필요한 영상을 더 담을 수 있습니다.
          </p>
          <div className="playlist-builder-stats">
            <span>
              <b>{playlistQueue.length}</b>
              담긴 영상
            </span>
            <span>
              <b>{playlistMinutes}분</b>
              예상 학습
            </span>
            <span>
              <b>{playlistPostIds.length}</b>
              공개 가능
            </span>
          </div>
          <PlaylistPreview
            videos={playlistQueue}
            onOpen={openPlaylist}
            onRemove={removeVideoFromDraft}
            title="코스 영상 순서"
            emptyText="아직 담긴 영상이 없어요. 링크를 등록하거나 보관함에서 영상을 추가하세요."
          />
          <form className="playlist-publish-form" onSubmit={publishCurrentPlaylist}>
            <strong>코스 공개하기</strong>
            <input
              value={courseTitle}
              onChange={(event) => updateActiveDraft({ title: event.target.value })}
              placeholder="코스 제목"
            />
            <textarea
              value={courseDescription}
              onChange={(event) =>
                updateActiveDraft({ description: event.target.value })
              }
              placeholder="이 코스의 학습 순서와 목표"
            />
            <button
              type="submit"
              disabled={isPublishingCourse || playlistPostIds.length === 0}
            >
              {isPublishingCourse ? '공개하는 중' : '코스 공개하기'}
            </button>
          </form>
          <button
            className="wide-button subtle"
            type="button"
            disabled={playlistQueue.length === 0}
            onClick={clearDraftPlaylist}
          >
            코스 비우기
          </button>
        </section>

        <aside className="board-panel post-browser">
          <div className="section-title">
            <div>
              <small>3. 영상 보관함</small>
              <h2>저장한 영상</h2>
            </div>
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
              <p className="empty-copy">아직 저장한 영상이 없어요.</p>
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
        </aside>

        <section className="board-panel post-detail">
          {selectedPost ? (
            <>
              <img src={selectedPost.thumbnailUrl} alt="" />
              <div className="section-title">
                <div>
                  <small>4. 선택한 영상 · {selectedPost.channelName}</small>
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
                  {selectedAlreadyInPlaylist ? '이미 담김' : '코스에 담기'}
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
                  ? `이미 "${activeDraftTitle}" 코스에 담긴 영상입니다.`
                  : '이 영상을 작업 중인 코스에 담고, 여러 영상을 묶어 보드에 공개할 수 있습니다.'}
              </p>
            </>
          ) : (
            <div className="empty-product">
              <strong>선택된 영상이 없어요</strong>
              <p>위 폼에서 학습 코스에 넣을 영상을 먼저 저장해보세요.</p>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

function PlaylistThumbnailStack({
  posts,
  size = 'card',
}: {
  posts: StudyPost[];
  size?: 'card' | 'detail';
}) {
  const stack = playlistThumbnailStackFromPosts(posts);
  const classes = [
    'playlist-thumbnail-stack',
    `is-${size}`,
    `count-${Math.max(1, stack.items.length)}`,
  ].join(' ');

  if (stack.items.length === 0) {
    return (
      <div className={`${classes} is-empty`} aria-label="플레이리스트 썸네일 없음">
        <span>학습</span>
      </div>
    );
  }

  return (
    <div className={classes} aria-label={`${stack.totalCount}개 영상 썸네일`}>
      {stack.items.map((item, index) => (
        <img
          alt=""
          className={`thumbnail-layer layer-${index + 1}`}
          key={item.id}
          src={item.src}
        />
      ))}
      {stack.overflowCount > 0 && (
        <span className="playlist-thumbnail-overflow">+{stack.overflowCount}</span>
      )}
    </div>
  );
}

function CommentSection({
  post,
  token,
  currentUserId,
  title,
  onChanged,
}: {
  post: StudyPost;
  token: string;
  currentUserId: number;
  title?: string;
  onChanged: (postId: number) => Promise<void>;
}) {
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  async function submitComment(event: FormEvent) {
    event.preventDefault();

    const body = draft.trim();

    if (!body) {
      setStatus('댓글 내용을 입력하세요.');
      return;
    }

    if (isSaving) {
      return;
    }

    setIsSaving(true);

    try {
      await addComment(token, post.id, body);
      setDraft('');
      setStatus('댓글을 등록했어요.');
      await onChanged(post.id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '댓글을 등록하지 못했어요.');
    } finally {
      setIsSaving(false);
    }
  }

  async function removeComment(commentId: number) {
    if (isSaving) {
      return;
    }

    setIsSaving(true);

    try {
      await deleteComment(token, post.id, commentId);
      setStatus('댓글을 삭제했어요.');
      await onChanged(post.id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '댓글을 삭제하지 못했어요.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="comments-panel">
      <div className="comments-heading">
        <div>
          <strong>{title ?? '댓글'}</strong>
          <span>{post.comments.length}개 댓글</span>
        </div>
        {status && <small>{status}</small>}
      </div>
      <div className="comment-list">
        {post.comments.map((comment) => {
          const canDelete =
            comment.authorId === currentUserId || post.authorId === currentUserId;

          return (
            <article className="comment-item" key={comment.id}>
              <div>
                <strong>{comment.authorName}</strong>
                <span>{formatDate(comment.createdAt)}</span>
              </div>
              <p>{comment.body}</p>
              {canDelete && (
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => void removeComment(comment.id)}
                >
                  삭제
                </button>
              )}
            </article>
          );
        })}
        {post.comments.length === 0 && (
          <p className="empty-copy">아직 댓글이 없어요. 첫 의견을 남겨보세요.</p>
        )}
      </div>
      <form className="comment-form" onSubmit={submitComment}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="댓글을 입력하세요"
          disabled={isSaving}
        />
        <button type="submit" disabled={isSaving || !draft.trim()}>
          {isSaving ? '처리 중' : '댓글 달기'}
        </button>
      </form>
    </section>
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
      const [nextPlaylists, nextPosts] = await Promise.all([
        fetchPlaylists(session.token),
        fetchOwnedPostsForLibrary(session.token),
      ]);
      setPlaylists(nextPlaylists);
      setPosts(nextPosts);
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
    if (generatedVideos.length === 0) {
      setStatus('저장할 코스 초안이 없어요. 먼저 새 코스를 만들어주세요.');
      return;
    }

    setIsSavingPlaylist(true);
    setStatus('코스를 저장하는 중입니다. 새 영상은 내 보드에 함께 저장합니다.');

    try {
      const postIds = await ensurePostIdsForGeneratedVideos(generatedVideos);

      const saved = await createPlaylist(session.token, {
        title: agentResult?.playlistTitle ?? `${query.trim() || initialQuery} 학습 코스`,
        description:
          agentResult?.rationale ??
          '내 취향과 검색 결과를 바탕으로 만든 학습 코스입니다.',
        postIds,
      });
      await refreshCourseData();
      setStatus(`"${saved.title}" 코스를 저장했어요. 학습 화면에서 바로 선택할 수 있습니다.`);
    } catch {
      setStatus('학습 코스 저장에 실패했어요.');
    } finally {
      setIsSavingPlaylist(false);
    }
  }

  async function ensurePostIdsForGeneratedVideos(videos: QueueVideo[]) {
    const nextPostIds: number[] = [];
    const seenPostIds = new Set<number>();
    let availablePosts = posts;

    for (const video of videos) {
      const existingPostId = findPostIdForQueueVideo(video, availablePosts);

      if (existingPostId) {
        if (!seenPostIds.has(existingPostId)) {
          nextPostIds.push(existingPostId);
          seenPostIds.add(existingPostId);
        }

        continue;
      }

      const savedPost = await createPost(session.token, postPayloadFromQueueVideo(video));
      availablePosts = [savedPost, ...availablePosts];

      if (!seenPostIds.has(savedPost.id)) {
        nextPostIds.push(savedPost.id);
        seenPostIds.add(savedPost.id);
      }
    }

    setPosts(availablePosts);

    return nextPostIds;
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
        <h1>
          내 취향에 맞는
          <br />
          학습 코스 찾기
        </h1>
        <p>
          먼저 이미 올라온 학습 플레이리스트와 AI 영상 분석 요약을 확인합니다.
          <br />
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
                  <p className="analysis-copy">{video.evidenceSnippet}</p>
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
            <div>
              <strong>AI가 만든 코스 초안 {generatedVideos.length}개 영상</strong>
              <small>저장하면 새 영상도 내 보드에 함께 보관됩니다.</small>
            </div>
            <button
              type="button"
              disabled={isSavingPlaylist}
              onClick={() => void saveGeneratedCourse()}
            >
              {isSavingPlaylist ? '저장 중' : '영상 저장하고 코스 만들기'}
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

    </main>
  );
}

function WatchPage({ session }: { session: Session }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [queue, setQueue] = useState<QueueVideo[]>(() => readWatchQueue());
  const [savedPlaylists, setSavedPlaylists] = useState<Playlist[]>([]);
  const [libraryPosts, setLibraryPosts] = useState<StudyPost[]>([]);
  const [playlistDraftState, setPlaylistDraftState] =
    useState<PlaylistDraftState<QueueVideo>>(() => readPlaylistDraftState());
  const [playlistLibraryStatus, setPlaylistLibraryStatus] =
    useState('내 플레이리스트를 불러오는 중입니다.');
  const [currentTime, setCurrentTime] = useState(0);
  const [captionResponse, setCaptionResponse] = useState<CaptionResponse | null>(
    null,
  );
  const [captionError, setCaptionError] = useState('');
  const [isCaptionLoading, setIsCaptionLoading] = useState(false);
  const [captionRefreshAttempts, setCaptionRefreshAttempts] = useState(0);
  const [isPlayerControlsHovered, setIsPlayerControlsHovered] = useState(false);
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
  const captionSyncStateRef = useRef<{
    captionsEnabled: boolean;
    customCaptionsAvailable: boolean;
    language: string;
  }>({
    captionsEnabled: DEFAULT_LEARNING_STATE.captionsEnabled,
    customCaptionsAvailable: false,
    language: DEFAULT_LEARNING_STATE.captionLanguage,
  });
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
    hasDisplayableLiveCaptionResponse({
      captionLanguage,
      liveCaptionProviders: LIVE_CAPTION_PROVIDERS,
      response: captionResponse,
    });
  const liveCaptions = useMemo(
    () => (hasLiveCaptionResponse ? captionResponse!.segments : []),
    [captionResponse, hasLiveCaptionResponse],
  );
  const captions = liveCaptions;
  const shouldUseNativeCaptionFallback =
    Boolean(currentVideo) &&
    captionResponseMatchesVideo &&
    captionResponse?.provider === 'youtube-native-captions' &&
    shouldUseNativeYouTubeCaptions({
      captionsEnabled,
      customCaptionsAvailable: hasLiveCaptionResponse,
      nativeFallbackAvailable: true,
    });
  const nativeCaptionLanguage = nativeYouTubeCaptionLanguage({
    fallbackLanguage: captionLanguage,
    response: captionResponseMatchesVideo ? captionResponse : null,
  });
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
  const captionStatus = captionStatusText({
    captionError,
    captionLanguage,
    captionResponse,
    captionResponseMatchesVideo,
    captionsEnabled,
    hasCurrentVideo: Boolean(currentVideo),
    hasLiveCaptionResponse,
    isCaptionLoading,
    shouldUseNativeCaptionFallback,
  });
  const activeCaption = useMemo(() => {
    return selectActiveCaption({
      captionsEnabled,
      currentTime,
      holdLastCaption: shouldHoldLastCaption,
      segments: captions,
      videoDuration,
    });
  }, [captions, captionsEnabled, currentTime, shouldHoldLastCaption, videoDuration]);
  captionSyncStateRef.current = {
    captionsEnabled,
    customCaptionsAvailable: !shouldUseNativeCaptionFallback,
    language: nativeCaptionLanguage,
  };
  const playlistChoices = useMemo(
    () =>
      buildWatchPlaylistChoices({
        savedPlaylists,
        posts: libraryPosts,
        drafts: playlistDraftState.drafts,
        videoFromPost: queueVideoFromPost,
      }),
    [libraryPosts, playlistDraftState.drafts, savedPlaylists],
  );
  const activePlaylistChoice = useMemo(
    () => findMatchingWatchPlaylistChoice(playlistChoices, queue, queueVideoKey),
    [playlistChoices, queue],
  );

  const syncPlayerNativeCaptions = useCallback((player: YouTubePlayer) => {
    syncNativeYouTubeCaptions({
      ...captionSyncStateRef.current,
      player,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadPlaylistLibrary() {
      const draftState = readPlaylistDraftState();
      setPlaylistDraftState(draftState);

      try {
        const [nextPlaylists, nextPosts] = await Promise.all([
          fetchPlaylists(session.token),
          fetchOwnedPostsForLibrary(session.token),
        ]);

        if (cancelled) {
          return;
        }

        const nextChoices = buildWatchPlaylistChoices({
          savedPlaylists: nextPlaylists,
          posts: nextPosts,
          drafts: draftState.drafts,
          videoFromPost: queueVideoFromPost,
        });

        setSavedPlaylists(nextPlaylists);
        setLibraryPosts(nextPosts);
        setPlaylistLibraryStatus(
          nextChoices.length > 0
            ? `${nextChoices.length}개의 플레이리스트를 고를 수 있어요.`
            : '아직 재생할 수 있는 플레이리스트가 없어요.',
        );
      } catch {
        if (!cancelled) {
          setPlaylistDraftState(readPlaylistDraftState());
          setPlaylistLibraryStatus(
            '저장된 플레이리스트를 불러오지 못했어요. 작업 초안은 바로 사용할 수 있습니다.',
          );
        }
      }
    }

    void loadPlaylistLibrary();

    return () => {
      cancelled = true;
    };
  }, [session.token]);

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
            ...youtubeCaptionPlayerVars({
              captionsEnabled,
              customCaptionsAvailable: !shouldUseNativeCaptionFallback,
              language: nativeCaptionLanguage,
            }),
            playsinline: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: (event) => {
              syncPlayerNativeCaptions(event.target);
              event.target.setPlaybackRate?.(learning.playbackRate);
              updateVideoDuration(
                event.target,
                currentVideo.videoId,
                setVideoDurationState,
              );
            },
            onStateChange: (event) => {
              syncPlayerNativeCaptions(event.target);

              if (event.data === 0) {
                playNext();
              }
            },
          },
        });
      } else {
        playerRef.current.loadVideoById(currentVideo.videoId);
        playerRef.current.setPlaybackRate?.(learning.playbackRate);
        syncPlayerNativeCaptions(playerRef.current);
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
    const player = playerRef.current;

    if (!player) {
      return;
    }

    syncPlayerNativeCaptions(player);
  }, [
    captionLanguage,
    captionsEnabled,
    currentVideo?.videoId,
    hasLiveCaptionResponse,
    nativeCaptionLanguage,
    shouldUseNativeCaptionFallback,
    syncPlayerNativeCaptions,
  ]);

  useEffect(() => {
    if (!currentVideo) {
      return;
    }

    let cancelled = false;

    async function loadCaptions() {
      setCaptionResponse(null);
      setCaptionError('');
      setIsCaptionLoading(true);
      setCaptionRefreshAttempts(0);

      try {
        const response = await fetchTranslatedCaptions({
          videoId: currentVideo!.videoId,
          videoUrl: currentVideo!.videoUrl,
          targetLanguage: captionLanguage,
          allowFallback: false,
          translateFallback: false,
          durationSeconds: DEFAULT_CAPTION_DURATION_SECONDS,
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
  }, [captionLanguage, currentVideo]);

  useEffect(() => {
    if (
      !currentVideo ||
      !captionResponseMatchesVideo ||
      captionResponse?.provider !== 'youtube-source-captions' ||
      captionResponse.language !== captionLanguage ||
      captionRefreshAttempts >= MAX_SOURCE_CAPTION_TRANSLATION_POLLS
    ) {
      return;
    }

    let cancelled = false;
    const translationPollDelay =
      sourceCaptionTranslationPollDelay(captionRefreshAttempts);
    const timeout = window.setTimeout(() => {
      async function refreshTranslatedCaptions() {
        try {
          const response = await fetchTranslatedCaptions({
            videoId: currentVideo.videoId,
            videoUrl: currentVideo.videoUrl,
            targetLanguage: captionLanguage,
            allowFallback: false,
            translateFallback: false,
            durationSeconds: DEFAULT_CAPTION_DURATION_SECONDS,
          });

          if (!cancelled) {
            setCaptionRefreshAttempts((attempts) => attempts + 1);
            setCaptionResponse(response);
            setCaptionError('');
          }
        } catch {
          if (!cancelled) {
            setCaptionRefreshAttempts((attempts) => attempts + 1);
          }
        }
      }

      void refreshTranslatedCaptions();
    }, translationPollDelay);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [
    captionLanguage,
    captionRefreshAttempts,
    captionResponse,
    captionResponseMatchesVideo,
    currentVideo,
  ]);

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
    saveWatchQueue(nextQueue);

    if (video.id !== currentVideo?.id) {
      return;
    }

    const nextVideo = nextQueue[0];
    if (nextVideo) {
      setSearchParams({ videoId: nextVideo.videoId });
    } else {
      playerRef.current?.destroy();
      playerRef.current = null;
      setCurrentTime(0);
      setNoteDraft('');
      setSearchParams({});
      setPlaylistLibraryStatus(
        playlistChoices.length > 0
          ? '재생목록을 비웠어요. 보유한 플레이리스트를 다시 선택할 수 있습니다.'
          : '재생목록을 비웠어요. 새 코스를 찾아 담아보세요.',
      );
    }
  }

  function clearQueue() {
    setQueue([]);
    saveWatchQueue([]);
    playerRef.current?.destroy();
    playerRef.current = null;
    setCurrentTime(0);
    setNoteDraft('');
    setSearchParams({});
    setPlaylistLibraryStatus(
      playlistChoices.length > 0
        ? '재생목록을 비웠어요. 보유한 플레이리스트를 다시 선택할 수 있습니다.'
        : '재생목록을 비웠어요. 새 코스를 찾아 담아보세요.',
    );
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
      saveWatchQueue(nextQueue);

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

  function updateCaptionControlsHover(event: ReactMouseEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const nextHovered = isPointerInPlayerControlsHoverZone({
      bottom: bounds.bottom,
      clientY: event.clientY,
      top: bounds.top,
    });

    setIsPlayerControlsHovered((current) =>
      current === nextHovered ? current : nextHovered,
    );
  }

  function playPlaylistChoice(choice: WatchPlaylistChoice<QueueVideo>) {
    const nextQueue = choice.videos.map((video) => normalizeQueueVideo(video));
    const firstVideo = nextQueue[0];

    if (!firstVideo) {
      setPlaylistLibraryStatus('이 플레이리스트에는 재생할 영상이 없어요.');
      return;
    }

    setQueue(nextQueue);
    saveWatchQueue(nextQueue);
    setCurrentTime(0);
    setNoteDraft('');
    setSearchParams({ videoId: firstVideo.videoId });
    setPlaylistLibraryStatus(`"${choice.title}" 플레이리스트를 재생합니다.`);
  }

  if (!currentVideo) {
    return (
      <main className="page-shell watch-empty-page">
        <section className="watch-empty-shell">
          <div className="watch-empty-copy">
            <p className="eyebrow">학습</p>
            <h1>학습할 플레이리스트를 선택하세요</h1>
            <p>
              저장한 코스와 작업 중인 초안을 바로 이어서 볼 수 있습니다.
              선택하면 첫 영상부터 재생목록이 시작됩니다.
            </p>
            <div className="watch-empty-actions">
              <Link className="primary-link" to="/playlists">
                새 코스 찾기
              </Link>
              <Link className="quiet-link" to="/board">
                등록 화면으로
              </Link>
            </div>
          </div>
          <WatchPlaylistPicker
            activeChoiceId={activePlaylistChoice?.id ?? null}
            choices={playlistChoices}
            onSelect={playPlaylistChoice}
            status={playlistLibraryStatus}
          />
        </section>
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
          <div
            className="youtube-shell"
            onMouseLeave={() => setIsPlayerControlsHovered(false)}
            onMouseMove={updateCaptionControlsHover}
          >
            <div id="youtube-player" />
            {activeCaption && (
              <div
                className={
                  isPlayerControlsHovered
                    ? 'caption-overlay raised'
                    : 'caption-overlay'
                }
              >
                {activeCaption.text}
              </div>
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
          <WatchPlaylistPicker
            activeChoiceId={activePlaylistChoice?.id ?? null}
            choices={playlistChoices}
            onSelect={playPlaylistChoice}
            status={playlistLibraryStatus}
          />

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

function WatchPlaylistPicker({
  choices,
  activeChoiceId,
  status,
  onSelect,
}: {
  choices: WatchPlaylistChoice<QueueVideo>[];
  activeChoiceId: string | null;
  status: string;
  onSelect: (choice: WatchPlaylistChoice<QueueVideo>) => void;
}) {
  return (
    <section className="study-panel playlist-library-panel">
      <div className="section-title">
        <h2>보유한 플레이리스트</h2>
        <span>{choices.length}개</span>
      </div>
      <p className="playlist-library-status">{status}</p>
      {choices.length > 0 ? (
        <div className="playlist-choice-list">
          {choices.map((choice) => (
            <button
              className={choice.id === activeChoiceId ? 'active' : ''}
              key={choice.id}
              type="button"
              onClick={() => onSelect(choice)}
            >
              <PlaylistChoiceThumbnail videos={choice.videos} />
              <span className="playlist-choice-copy">
                <span className="playlist-choice-kind">
                  {choice.kind === 'saved' ? '저장한 코스' : '작업 초안'}
                </span>
                <strong>{choice.title}</strong>
                <span className="playlist-choice-description">
                  {clipText(choice.description, 86)}
                </span>
                <em>{choice.metaLabel}</em>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="empty-copy">등록 화면에서 플레이리스트를 만들면 여기에 표시됩니다.</p>
      )}
    </section>
  );
}

function PlaylistChoiceThumbnail({ videos }: { videos: QueueVideo[] }) {
  const visibleVideos = videos.slice(0, 3);

  if (visibleVideos.length === 0) {
    return (
      <span className="playlist-choice-thumb is-empty">
        <span>학습</span>
      </span>
    );
  }

  return (
    <span className={`playlist-choice-thumb count-${visibleVideos.length}`}>
      {visibleVideos.map((video, index) => (
        <img
          alt=""
          className={`thumb-layer layer-${index + 1}`}
          key={queueVideoKey(video)}
          src={video.thumbnailUrl}
        />
      ))}
      {videos.length > visibleVideos.length && (
        <span className="thumb-overflow">+{videos.length - visibleVideos.length}</span>
      )}
    </span>
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
  onRemove,
  title = '내 플레이리스트',
  emptyText = '아직 담긴 영상이 없어요.',
  compact = false,
}: {
  videos: QueueVideo[];
  onOpen: () => void;
  onRemove?: (video: QueueVideo) => void;
  title?: string;
  emptyText?: string;
  compact?: boolean;
}) {
  return (
    <section
      className={compact ? 'playlist-preview-panel compact' : 'playlist-preview-panel'}
    >
      <div className="section-title">
        <h2>{title}</h2>
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
              {onRemove && (
                <button
                  className="playlist-item-remove"
                  type="button"
                  onClick={() => onRemove(video)}
                >
                  삭제
                </button>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="empty-copy">{emptyText}</p>
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

async function fetchOwnedPostsForLibrary(token: string) {
  const pageSize = 24;
  const firstPage = await fetchPosts(token, '', 1, pageSize);
  const posts = [...firstPage.items];
  const totalPages = Math.ceil(firstPage.total / pageSize);

  for (let page = 2; page <= totalPages; page += 1) {
    const result = await fetchPosts(token, '', page, pageSize);
    posts.push(...result.items);
  }

  return posts;
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

export default App;
