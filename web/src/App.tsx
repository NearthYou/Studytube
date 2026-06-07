import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
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
  apiBaseUrl,
  askAgent,
  askMcp,
  askRag,
  createPost,
  deletePost,
  fetchPlaylists,
  fetchPosts,
  login,
  signUp,
  updatePost,
} from './api';
import type {
  AgentResponse,
  McpResponse,
  Playlist,
  RagResponse,
  Session,
  StudyPost,
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
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  results?: QueueVideo[];
};

type CaptionSegment = {
  start: number;
  end: number;
  text: string;
};

type YouTubePlayer = {
  loadVideoById: (videoId: string) => void;
  getCurrentTime: () => number;
  destroy: () => void;
};

type YouTubeApi = {
  Player: new (
    elementId: string,
    options: {
      videoId: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: () => void;
        onStateChange?: (event: { data: number }) => void;
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

function App() {
  const [session, setSession] = useState<Session | null>(() => readSession());

  function handleAuthComplete(nextSession: Session) {
    saveSession(nextSession);
    setSession(nextSession);
  }

  function handleLogout() {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    setSession(null);
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
          path="/search"
          element={
            <ProtectedRoute session={session}>
              <SearchPage />
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
              <PlaylistPage />
            </ProtectedRoute>
          }
        />
      </Routes>
      <footer>
        <span>StudyTube Board</span>
        <span>API: {apiBaseUrl()}</span>
      </footer>
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
            <NavLink to="/watch">영상 보기</NavLink>
            <NavLink to="/board">학습 보드</NavLink>
            <NavLink to="/search">지식 검색</NavLink>
            <NavLink to="/playlists">추천 리스트</NavLink>
          </nav>
          <div className="nav-account">
            <span>{session.user.name}</span>
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
  const from =
    typeof location.state === 'object' &&
    location.state &&
    'from' in location.state &&
    typeof location.state.from === 'string'
      ? location.state.from
      : '/';

  async function submit(event: FormEvent) {
    event.preventDefault();

    try {
      const nextSession =
        mode === 'signup'
          ? await signUp(form)
          : await login({ email: form.email, password: form.password });
      onComplete(nextSession);
      navigate(from, { replace: true });
    } catch {
      setStatus('인증에 실패했어요. 이메일과 비밀번호를 확인하세요.');
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <p className="eyebrow">StudyTube Account</p>
        <h1>{mode === 'login' ? '로그인' : '회원가입'}</h1>
        <p>{status}</p>
        <form className="stack-form" onSubmit={submit}>
          {mode === 'signup' && (
            <input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="이름"
            />
          )}
          <input
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
            placeholder="이메일"
            type="email"
          />
          <input
            value={form.password}
            onChange={(event) =>
              setForm({ ...form, password: event.target.value })
            }
            placeholder="비밀번호"
            type="password"
          />
          <button type="submit">
            {mode === 'signup' ? '회원가입' : '로그인'}
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

function HomePage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [posts, setPosts] = useState<StudyPost[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [status, setStatus] = useState('API에서 학습 데이터를 불러오고 있어요');
  const heroPost = posts[0];

  useEffect(() => {
    async function boot() {
      try {
        const [postResult, playlistResult] = await Promise.all([
          fetchPosts('', 1, 4),
          fetchPlaylists(session.token),
        ]);

        setPosts(postResult.items);
        setPlaylists(playlistResult);
        setStatus('저장된 학습 데이터가 준비됐어요');
      } catch {
        setStatus('NestJS API와 FastAPI AI 서비스를 실행하면 실제 데이터가 표시돼요');
      }
    }

    void boot();
  }, [session.token]);

  function addFirstVideoAndWatch() {
    if (!heroPost) {
      navigate('/search');
      return;
    }

    const video = queueVideoFromPost(heroPost);
    saveQueue([video, ...readQueue().filter((item) => item.id !== video.id)]);
    navigate(`/watch?videoId=${video.videoId}`);
  }

  return (
    <main>
      <section className="hero-section">
        <div className="hero-copy">
          <p className="eyebrow">YouTube learning, organized</p>
          <h1>유튜브로 공부한 모든 것을 내 지식으로 남기세요</h1>
          <p className="hero-description">
            실제 게시판 데이터와 RAG 검색 결과로 학습 영상을 찾고, 재생목록에
            담은 뒤 사이트 안에서 이어서 시청합니다.
          </p>
          <div className="hero-actions">
            <Link className="primary-link" to="/search">
              지식 검색하기
            </Link>
            <button type="button" onClick={addFirstVideoAndWatch}>
              첫 영상 보기
            </button>
          </div>
          <div className="hero-proof" aria-label="service highlights">
            <span>
              <strong>{posts.length}</strong>
              API 학습글
            </span>
            <span>
              <strong>{playlists.length}</strong>
              저장 리스트
            </span>
            <span>
              <strong>RAG</strong>
              실제 검색
            </span>
          </div>
          <p className="system-note">{status}</p>
        </div>

        <div className="hero-device" aria-label="StudyTube product preview">
          <div className="device-toolbar">
            <span />
            <span />
            <span />
          </div>
          <div className="device-body">
            {heroPost ? (
              <>
                <article className="video-preview">
                  <img src={heroPost.thumbnailUrl} alt="" />
                  <div>
                    <small>{heroPost.channelName}</small>
                    <strong>{heroPost.title}</strong>
                    <p>{heroPost.summary}</p>
                  </div>
                </article>
                <div className="assistant-card floating">
                  <small>Watch inside StudyTube</small>
                  <strong>리스트에 추가하면 바로 영상 보기로 이동</strong>
                  <p>
                    영상 옆 재생목록에서 순서대로 보거나 원하는 영상으로
                    바꿔볼 수 있어요.
                  </p>
                </div>
                <div className="mini-list">
                  {posts.slice(0, 3).map((post, index) => (
                    <span key={post.id}>
                      <b>{index + 1}</b>
                      {post.title}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty-product">
                <strong>저장된 영상이 아직 없어요</strong>
                <p>학습 보드에서 YouTube 글을 작성하거나 RAG 검색을 실행하세요.</p>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function BoardPage({ session }: { session: Session }) {
  const [posts, setPosts] = useState<StudyPost[]>([]);
  const [selectedPostId, setSelectedPostId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [editor, setEditor] = useState<PostEditor>(emptyEditor);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [status, setStatus] = useState(`${session.user.email} 계정으로 작업 중`);
  const [metadataStatus, setMetadataStatus] = useState('');

  const selectedPost = useMemo(
    () => posts.find((post) => post.id === selectedPostId) ?? posts[0],
    [posts, selectedPostId],
  );
  const totalPages = Math.max(1, Math.ceil(total / 6));

  useEffect(() => {
    async function boot() {
      try {
        await loadPosts('', 1);
        setStatus(`${session.user.email} 계정으로 작업 중`);
      } catch {
        setStatus('API 서버를 실행해야 게시판 기능을 사용할 수 있어요');
      }
    }

    void boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.token]);

  async function loadPosts(nextSearch = search, nextPage = page) {
    const result = await fetchPosts(nextSearch, nextPage, 6);
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
      translatedNotes: editor.summary.trim(),
      tags: editor.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    };

    if (!payload.title || !payload.videoUrl || !payload.summary) {
      setStatus('제목, 영상 URL, 요약은 필수예요');
      return;
    }

    try {
      const saved = editingId
        ? await updatePost(session.token, editingId, payload)
        : await createPost(session.token, payload);

      await loadPosts(search, 1);
      setPage(1);
      setSelectedPostId(saved.id);
      setStatus(editingId ? '게시글을 수정했어요' : '게시글을 작성했어요');
      setEditor(emptyEditor);
      setEditingId(null);
    } catch {
      setStatus('게시글 저장에 실패했어요. API 서버와 입력값을 확인하세요.');
    }
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
  }

  async function autofillVideoMetadata(inputUrl = editor.videoUrl) {
    const videoUrl = inputUrl.trim();

    if (!videoUrl) {
      setMetadataStatus('YouTube URL을 먼저 입력하세요.');
      return;
    }

    setMetadataStatus('영상 정보를 불러오는 중입니다.');

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
        tags: deriveTags(`${metadata.title} ${metadata.channel} ${summary}`).join(', '),
      }));
      setMetadataStatus('영상 정보가 자동 입력됐어요.');
    } catch {
      setMetadataStatus('영상 정보 조회에 실패했어요.');
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
      setStatus('검색에 실패했어요. API 서버를 확인하세요.');
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
        <p className="eyebrow">Board essentials</p>
        <h1>과제 필수 게시판 기능</h1>
        <p>{status}</p>
      </section>

      <section className="board-grid">
        <aside className="board-panel post-browser">
          <div className="section-title">
            <h2>게시글</h2>
            <span>{total}개</span>
          </div>
          <input
            value={search}
            onChange={(event) => void changeSearch(event.target.value)}
            placeholder="제목, 요약, 태그로 검색"
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
              <p className="empty-copy">저장된 게시글이 아직 없어요.</p>
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
                  <small>{selectedPost.channelName}</small>
                  <h2>{selectedPost.title}</h2>
                </div>
                <TagLine tags={selectedPost.tags} />
              </div>
              <p>{selectedPost.summary}</p>
              <div className="row-actions">
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
              <strong>선택된 게시글이 없어요</strong>
              <p>아래 작성 폼에서 실제 학습 영상을 먼저 저장해보세요.</p>
            </div>
          )}
        </section>

        <section className="board-panel editor-panel">
          <div className="section-title">
            <h2>{editingId ? '게시글 수정' : '게시글 작성'}</h2>
            {editingId && <span>#{editingId}</span>}
          </div>
          <form className="stack-form" onSubmit={submitPost}>
            <input
              value={editor.title}
              onChange={(event) =>
                setEditor({ ...editor, title: event.target.value })
              }
              placeholder="영상 제목"
            />
            <input
              value={editor.videoUrl}
              onChange={(event) =>
                setEditor({ ...editor, videoUrl: event.target.value })
              }
              onBlur={(event) => {
                if (!editingId && event.currentTarget.value.trim()) {
                  void autofillVideoMetadata(event.currentTarget.value);
                }
              }}
              placeholder="YouTube URL"
            />
            <div className="metadata-row">
              <button type="button" onClick={() => void autofillVideoMetadata()}>
                영상 정보 불러오기
              </button>
              <span>{metadataStatus}</span>
            </div>
            <input
              value={editor.channelName}
              onChange={(event) =>
                setEditor({ ...editor, channelName: event.target.value })
              }
              placeholder="채널명"
            />
            <input
              value={editor.tags}
              onChange={(event) =>
                setEditor({ ...editor, tags: event.target.value })
              }
              placeholder="태그: react, hooks, frontend"
            />
            <textarea
              value={editor.summary}
              onChange={(event) =>
                setEditor({ ...editor, summary: event.target.value })
              }
              placeholder="게시글 요약"
            />
            <div className="row-actions">
              <button type="submit">{editingId ? '수정 저장' : '작성하기'}</button>
              {editingId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(null);
                    setEditor(emptyEditor);
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

function SearchPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('React hooks를 공부하고 싶어');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: '궁금한 학습 주제를 물어보세요. RAG가 실제 게시판 데이터를 검색해서 영상 후보를 가져옵니다.',
    },
  ]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = query.trim();

    if (!trimmed) {
      return;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: trimmed,
    };
    setMessages((current) => [...current, userMessage]);
    setQuery('');

    try {
      const result = await askRag(trimmed);
      const videos = result.relatedPosts.map(queueVideoFromRagPost);
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        text:
          videos.length > 0
            ? result.answer
            : '검색 결과가 없어요. 학습 보드에 관련 영상을 먼저 저장해보세요.',
        results: videos,
      };
      setMessages((current) => [...current, assistantMessage]);
    } catch {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          text: 'RAG 검색에 실패했어요. NestJS API와 FastAPI AI 서비스가 실행 중인지 확인하세요.',
        },
      ]);
    }
  }

  function addAndWatch(video: QueueVideo, relatedVideos: QueueVideo[]) {
    const queue = addVideosToQueue(relatedVideos, video);
    const firstVideo = queue.find((item) => item.id === video.id) ?? video;
    navigate(`/watch?videoId=${firstVideo.videoId}`);
  }

  return (
    <main className="page-shell chat-page">
      <section className="page-heading">
        <p className="eyebrow">RAG Knowledge Q&A</p>
        <h1>내 게시판 지식 검색</h1>
        <p>저장된 게시글만 근거로 답하고, 관련 글이 없으면 결과를 비웁니다.</p>
      </section>

      <section className="chat-shell">
        <div className="chat-messages">
          {messages.map((message) => (
            <article className={`chat-message ${message.role}`} key={message.id}>
              <p>{message.text}</p>
              {message.results && message.results.length > 0 && (
                <div className="chat-results">
                  {message.results.map((video) => (
                    <button
                      className="video-result"
                      key={video.id}
                      type="button"
                      onClick={() => addAndWatch(video, message.results ?? [video])}
                    >
                      <img src={video.thumbnailUrl} alt="" />
                      <span>
                        <strong>{video.title}</strong>
                        <small>{video.channelName}</small>
                        <em>리스트에 추가하고 보기</em>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
        <form className="chat-input" onSubmit={submit}>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="예: React hooks를 처음 공부할 때 볼 영상 찾아줘"
          />
          <button type="submit">전송</button>
        </form>
      </section>
    </main>
  );
}

function WatchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [queue, setQueue] = useState<QueueVideo[]>(() => readQueue());
  const [currentTime, setCurrentTime] = useState(0);
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const activeVideoId = searchParams.get('videoId');
  const currentVideo =
    queue.find((video) => video.videoId === activeVideoId) ?? queue[0] ?? null;
  const captions = useMemo(
    () => (currentVideo ? buildCaptionSegments(currentVideo) : []),
    [currentVideo],
  );
  const activeCaption =
    captionsEnabled
      ? captions.find(
          (segment) => currentTime >= segment.start && currentTime < segment.end,
        ) ?? captions[0]
      : null;

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
          },
          events: {
            onStateChange: (event) => {
              if (event.data === 0) {
                playNext();
              }
            },
          },
        });
      } else {
        playerRef.current.loadVideoById(currentVideo.videoId);
      }
    }

    void loadPlayer();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentVideo?.videoId]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      try {
        setCurrentTime(playerRef.current?.getCurrentTime() ?? 0);
      } catch {
        setCurrentTime(0);
      }
    }, 250);

    return () => window.clearInterval(interval);
  }, []);

  function selectVideo(video: QueueVideo) {
    setCurrentTime(0);
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

  if (!currentVideo) {
    return (
      <main className="page-shell simple-page">
        <p className="eyebrow">Watch</p>
        <h1>재생목록이 비어 있어요</h1>
        <p>지식 검색이나 추천 리스트에서 영상을 재생목록에 추가하면 이곳에서 바로 볼 수 있어요.</p>
        <Link className="primary-link" to="/search">
          지식 검색으로 영상 찾기
        </Link>
      </main>
    );
  }

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
              <small>{currentVideo.channelName}</small>
              <button
                className={captionsEnabled ? 'caption-toggle active' : 'caption-toggle'}
                type="button"
                onClick={() => setCaptionsEnabled((current) => !current)}
              >
                자막 {captionsEnabled ? '끄기' : '켜기'}
              </button>
            </div>
            <h1>{currentVideo.title}</h1>
            <p>{currentVideo.summary}</p>
          </div>
        </article>

        <aside className="watch-queue">
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
        </aside>
      </section>
    </main>
  );
}

function PlaylistPage() {
  const navigate = useNavigate();
  const [goal, setGoal] = useState('React hooks와 React Query를 복습하고 싶어');
  const [result, setResult] = useState<AgentResponse | null>(null);
  const [mcpResult, setMcpResult] = useState<McpResponse | null>(null);
  const [status, setStatus] = useState('AI Agent가 실제 RAG 결과를 바탕으로 추천 리스트를 만듭니다.');

  async function createRoute(event: FormEvent) {
    event.preventDefault();

    const [agentResponse, mcpResponse] = await Promise.allSettled([
      askAgent(goal),
      askMcp(goal),
    ]);

    if (agentResponse.status === 'fulfilled') {
      setResult(agentResponse.value);
    } else {
      setResult(null);
    }

    if (mcpResponse.status === 'fulfilled') {
      setMcpResult(mcpResponse.value);
    } else {
      setMcpResult(null);
    }

    if (agentResponse.status === 'fulfilled' || mcpResponse.status === 'fulfilled') {
      setStatus('추천 리스트를 만들었어요. 영상을 누르면 재생목록에 추가하고 이동합니다.');
    } else {
      setStatus('추천 생성에 실패했어요. FastAPI AI 서비스가 실행 중인지 확인하세요.');
    }
  }

  function addRecommendationAndWatch(video: QueueVideo) {
    addVideosToQueue(videos, video);
    navigate(`/watch?videoId=${video.videoId}`);
  }

  const agentVideos =
    result?.recommendations.map((item) => queueVideoFromRecommendation(item)) ??
    [];
  const mcpVideos =
    mcpResult?.result?.videos.flatMap((item) => {
      const video = queueVideoFromMcpVideo(item);

      return video ? [video] : [];
    }) ?? [];
  const videos = uniqueVideos([...agentVideos, ...mcpVideos]);

  return (
    <main className="page-shell simple-page">
      <p className="eyebrow">Agent Playlist</p>
      <h1>Agent 학습 루트 생성</h1>
      <p>{status}</p>
      <form className="search-hero" onSubmit={createRoute}>
        <input
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          placeholder="공부 목표"
        />
        <button type="submit">추천 받기</button>
      </form>
      <section className="result-panel video-result-panel">
        {videos.map((video) => (
          <button
            className="video-result"
            key={video.id}
            type="button"
            onClick={() => addRecommendationAndWatch(video)}
          >
            <img src={video.thumbnailUrl} alt="" />
            <span>
              <strong>{video.title}</strong>
              <small>{video.source}</small>
              <em>리스트에 추가하고 보기</em>
            </span>
          </button>
        ))}
        {videos.length === 0 && (
          <p className="empty-copy">학습 목표를 입력하고 추천을 받아보세요.</p>
        )}
      </section>
      {result && (
        <section className="agent-trace">
          <div className="section-title">
            <h2>Agent 실행 기록</h2>
            <span>{result.trace.length}단계</span>
          </div>
          {result.trace.map((step) => (
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

function TagLine({ tags }: { tags: string[] }) {
  return (
    <span className="tags">
      {tags.map((tag) => (
        <em key={tag}>{tag}</em>
      ))}
    </span>
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
    source: `RAG score ${post.score}`,
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
    const key = video.videoId || video.videoUrl;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function readQueue(): QueueVideo[] {
  try {
    const raw = window.localStorage.getItem(QUEUE_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as QueueVideo[]) : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: QueueVideo[]) {
  window.localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
}

function readSession(): Session | null {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function saveSession(session: Session) {
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

function addVideosToQueue(videos: QueueVideo[], selectedVideo: QueueVideo) {
  const selectedFirst = [
    selectedVideo,
    ...videos.filter((video) => video.id !== selectedVideo.id),
  ];
  const selectedIds = new Set(selectedFirst.map((video) => video.id));
  const existing = readQueue().filter((video) => !selectedIds.has(video.id));
  const nextQueue = uniqueVideos([...selectedFirst, ...existing]);
  saveQueue(nextQueue);

  return nextQueue;
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

function buildCaptionSegments(video: QueueVideo): CaptionSegment[] {
  const source = [video.translatedNotes, video.summary].join(' ');
  const timedSegments = parseTimedCaptions(source);

  if (timedSegments.length > 0) {
    return timedSegments;
  }

  const sentences = source
    .split(/(?<=[.!?。]|다\.)\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const safeSentences =
    sentences.length > 0
      ? sentences
      : ['이 영상의 번역 노트가 아직 없어요. 학습 보드에서 자막 노트를 저장해보세요.'];

  return safeSentences.map((text, index) => ({
    start: index * 5,
    end: (index + 1) * 5,
    text,
  }));
}

function parseTimedCaptions(text: string): CaptionSegment[] {
  const matches = [
    ...text.matchAll(/(?:(\d{1,2}):)?(\d{1,2}):(\d{2})/g),
  ];

  return matches
    .map((match, index) => {
      const nextMatch = matches[index + 1];
      const start = timestampToSeconds(match);
      const end = nextMatch ? timestampToSeconds(nextMatch) : start + 8;
      const captionText = text
        .slice(match.index! + match[0].length, nextMatch?.index ?? text.length)
        .replace(/\s+/g, ' ')
        .trim();

      return captionText
        ? {
            start,
            end: Math.max(end, start + 3),
            text: captionText,
          }
        : null;
    })
    .filter((segment): segment is CaptionSegment => Boolean(segment));
}

function timestampToSeconds(match: RegExpMatchArray) {
  const hoursOrMinutes = Number(match[1] ?? 0);
  const minutesOrSeconds = Number(match[2]);
  const seconds = Number(match[3]);

  return match[1]
    ? hoursOrMinutes * 3600 + minutesOrSeconds * 60 + seconds
    : minutesOrSeconds * 60 + seconds;
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
