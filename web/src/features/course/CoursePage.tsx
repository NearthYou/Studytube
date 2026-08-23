import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router";
import { askAgent, askMcp, askRag, createPost, fetchPosts } from "../../api";
import { createCourse, fetchOwnerCourses, publishCourse } from "../../courseApi";
import { createPersonalizedCoursePrompt, createPromptSuggestions, findMatchingCourses, hasLearningPreferences } from "../../courseDiscovery";
import { addVideosToQueue } from "../../watchQueueStorage";
import { findPostIdForQueueVideo, postPayloadFromQueueVideo, queueVideoFromCourseStep, queueVideoFromMcpVideo, queueVideoFromRagPost, queueVideoFromRecommendation, uniqueVideos, type QueueVideo } from "../../watchQueue";
import type { AgentResponse, Course, McpResponse, Playlist, RagResponse, Session, StudyPost } from "../../types";

export function CoursePage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const profile = session.user.preferences;
  const hasProfile = hasLearningPreferences(profile);
  const initialQuery = createPersonalizedCoursePrompt(profile);
  const [query, setQuery] = useState("");
  const [ragResult, setRagResult] = useState<RagResponse | null>(null);
  const [courseMatches, setCourseMatches] = useState<Playlist[]>([]);
  const [agentResult, setAgentResult] = useState<AgentResponse | null>(null);
  const [mcpResult, setMcpResult] = useState<McpResponse | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const playlists = useMemo(
    () =>
      courses
        .filter((course) => course.status !== "archived")
        .map(playlistViewFromCourse),
    [courses],
  );
  const [posts, setPosts] = useState<StudyPost[]>([]);
  const [status, setStatus] = useState(
    hasProfile
      ? `${profile.interests[0]} 취향을 반영해 먼저 기존 보드에서 찾아볼게요.`
      : "원하는 코스를 입력하면 먼저 기존 플레이리스트 보드에서 찾고, 없으면 새로 만들어드립니다.",
  );
  const [isSearching, setIsSearching] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSavingPlaylist, setIsSavingPlaylist] = useState(false);

  useEffect(() => {
    void refreshCourseData();
  }, [session.user.id]);

  async function refreshCourseData() {
    try {
      const [nextCourses, ownedPosts] = await Promise.all([
        fetchOwnerCourses(),
        fetchOwnedPostsForLibrary(),
      ]);
      setCourses(nextCourses);
      setPosts([
        ...nextCourses.flatMap((course) => postsFromCourse(course, ownedPosts)),
        ...ownedPosts,
      ]);
    } catch {
      setStatus("학습 코스 데이터를 불러오지 못했어요. 서버를 확인하세요.");
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
    setStatus(
      "먼저 기존 플레이리스트 보드와 저장된 학습 코스에서 찾는 중입니다.",
    );

    try {
      const result = await askRag(trimmed);
      const matches = findMatchingCourses(playlists, posts, trimmed);
      setRagResult(result);
      setCourseMatches(matches);
      setStatus(
        result.relatedPosts.length > 0 || matches.length > 0
          ? "이미 올라온 코스나 영상 분석 요약을 찾았어요. 먼저 이것부터 확인해보세요."
          : "기존 보드에는 딱 맞는 코스가 없어요. 새 YouTube 코스를 만들어볼 수 있습니다.",
      );
    } catch {
      setStatus("기존 코스 검색에 실패했어요. 서버를 확인하세요.");
    } finally {
      setIsSearching(false);
    }
  }

  async function generateNewCourse() {
    const goal = query.trim() || ragResult?.query || initialQuery;

    if (!goal || isGenerating) {
      if (!goal) {
        setStatus("새 코스를 만들 주제나 목표를 먼저 입력하세요.");
      }
      return;
    }

    setIsGenerating(true);
    setStatus(
      "새 코스를 만들기 위해 AI가 YouTube 후보와 기존 영상 분석 요약을 함께 살피는 중입니다.",
    );

    const [agentResponse, mcpResponse] = await Promise.allSettled([
      askAgent(goal),
      askMcp(goal),
    ]);

    if (agentResponse.status === "fulfilled") {
      setAgentResult(agentResponse.value);
    } else {
      setAgentResult(null);
    }

    if (mcpResponse.status === "fulfilled") {
      setMcpResult(mcpResponse.value);
    } else {
      setMcpResult(null);
    }

    setStatus(
      agentResponse.status === "fulfilled" || mcpResponse.status === "fulfilled"
        ? "새 학습 코스를 만들었어요. 저장하거나 바로 시청할 수 있습니다."
        : "새 코스 생성에 실패했어요. AI 서버가 실행 중인지 확인하세요.",
    );
    setIsGenerating(false);
  }

  function addAndWatch(video: QueueVideo, relatedVideos: QueueVideo[]) {
    const queue = addVideosToQueue(relatedVideos, video);
    const firstVideo = queue.find((item) => item.id === video.id) ?? video;
    navigate(`/watch?videoId=${firstVideo.videoId}`);
  }

  function playSavedPlaylist(playlist: Playlist) {
    const course = courses.find((candidate) => candidate.id === playlist.id);
    const courseVideos = course?.steps.map(queueVideoFromCourseStep) ?? [];

    if (courseVideos.length === 0) {
      setStatus(
        "이 코스의 영상을 불러오지 못했어요. 플레이리스트 보드를 확인하세요.",
      );
      return;
    }

    addVideosToQueue(courseVideos, courseVideos[0]);
    navigate(`/watch?videoId=${courseVideos[0].videoId}`);
  }

  async function saveGeneratedCourse() {
    if (generatedVideos.length === 0) {
      setStatus("저장할 코스가 없어요. 먼저 새 코스를 만들어주세요.");
      return;
    }

    setIsSavingPlaylist(true);
    setStatus("코스를 저장하는 중입니다. 새 영상은 내 보드에 함께 저장합니다.");

    try {
      const postIds = await ensurePostIdsForGeneratedVideos(generatedVideos);

      const title =
        agentResult?.playlistTitle ??
        `${query.trim() || initialQuery || "AI 추천"} 학습 코스`;
      const description =
        agentResult?.rationale ??
        "내 취향과 검색 결과를 바탕으로 만든 학습 코스입니다.";
      const created = await createCourse(
        {
          title,
          description,
          steps: postIds.map((sourcePostId) => ({ sourcePostId })),
        },
        generatedCourseIdempotencyKey(
          session.user.id,
          title,
          description,
          postIds,
        ),
      );
      const saved =
        created.status === "draft"
          ? await publishCourse(created.id, created.version)
          : created;
      await refreshCourseData();
      setStatus(
        `"${saved.title}" 코스를 저장했어요. 학습 화면에서 바로 선택할 수 있습니다.`,
      );
    } catch {
      setStatus("학습 코스 저장에 실패했어요.");
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

      const savedPost = await createPost(postPayloadFromQueueVideo(video));
      availablePosts = [savedPost, ...availablePosts];

      if (!seenPostIds.has(savedPost.id)) {
        nextPostIds.push(savedPost.id);
        seenPostIds.add(savedPost.id);
      }
    }

    setPosts(availablePosts);

    return nextPostIds;
  }

  const existingVideos =
    ragResult?.relatedPosts.map(queueVideoFromRagPost) ?? [];
  const agentVideos =
    agentResult?.recommendations.map((item) =>
      queueVideoFromRecommendation(item),
    ) ?? [];
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
          없으면 AI가 YouTube까지 탐색해서 새 학습 코스를 만듭니다.
        </p>
        {hasProfile && (
          <div className="preference-summary">
            <strong>{profile.goal}</strong>
            <span>
              {profile.interests.join(", ")} / {profile.pace}
            </span>
          </div>
        )}
        <div className="quick-prompts" aria-label="추천 예시">
          {promptSuggestions.map((prompt) => (
            <button key={prompt} type="button" onClick={() => setQuery(prompt)}>
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
            {isSearching ? "찾는 중" : "기존 코스 먼저 찾기"}
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={isSearching || isGenerating}
            onClick={() => void generateNewCourse()}
          >
            {isGenerating ? "만드는 중" : "새로 만들어줘"}
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
                <p>{playlist.description || "이미 저장된 학습 코스입니다."}</p>
                <div className="route-card-meta">
                  <span>{playlist.postIds.length}개 영상</span>
                  <span>댓글 {playlist.feedback.length}개</span>
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
          {ragResult &&
            existingVideos.length === 0 &&
            courseMatches.length === 0 && (
              <div className="empty-product">
                <strong>아직 딱 맞는 코스가 없어요</strong>
                <p>
                  새로 만들어달라고 하면 AI가 YouTube까지 탐색해서 학습 코스를
                  만듭니다.
                </p>
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
              <strong>
                AI가 만든 학습 코스 {generatedVideos.length}개 영상
              </strong>
              <small>저장하면 새 영상도 내 보드에 함께 보관됩니다.</small>
            </div>
            <button
              type="button"
              disabled={isSavingPlaylist}
              onClick={() => void saveGeneratedCourse()}
            >
              {isSavingPlaylist ? "저장 중" : "영상 저장하고 코스 만들기"}
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

async function fetchOwnedPostsForLibrary() {
  const pageSize = 24;
  const firstPage = await fetchPosts("", 1, pageSize);
  const posts = [...firstPage.items];
  const totalPages = Math.ceil(firstPage.total / pageSize);
  for (let page = 2; page <= totalPages; page += 1) {
    const result = await fetchPosts("", page, pageSize);
    posts.push(...result.items);
  }
  return posts;
}

function playlistViewFromCourse(course: Course): Playlist {
  return {
    id: course.id,
    ownerId: course.ownerId ?? 0,
    title: course.title,
    description: course.description,
    postIds: course.steps.map((step) => courseStepViewId(course.id, step)),
    feedback: course.feedback.map((feedback) => ({
      ...feedback,
      playlistId: course.id,
      authorId: feedback.authorId ?? -1,
    })),
    createdAt: course.createdAt,
  };
}

function postsFromCourse(course: Course, sourcePosts: StudyPost[] = []) {
  const sourceById = new Map(sourcePosts.map((post) => [post.id, post]));
  return course.steps.map((step) => {
    const source = step.sourcePostId ? sourceById.get(step.sourcePostId) : null;
    return {
      id: courseStepViewId(course.id, step),
      authorId: course.ownerId ?? source?.authorId ?? 0,
      authorName: source?.authorName ?? "Course author",
      title: step.snapshot.title,
      videoUrl: step.snapshot.videoUrl,
      thumbnailUrl: step.snapshot.thumbnailUrl,
      channelName: step.snapshot.channelName,
      summary: source?.summary ?? "",
      translatedNotes: source?.translatedNotes ?? "",
      tags: source?.tags ?? [],
      comments: [],
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
    } satisfies StudyPost;
  });
}

function courseStepViewId(courseId: number, step: Course["steps"][number]) {
  return -(courseId * 1_000 + step.position);
}

function generatedCourseIdempotencyKey(
  userId: number,
  title: string,
  description: string,
  postIds: number[],
) {
  const value = `${title}\n${description}\n${postIds.join(",")}`;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `generated-course:v1:u${userId}:p${(hash >>> 0).toString(36)}`;
}
