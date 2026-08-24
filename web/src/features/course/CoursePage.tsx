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
      ? `${profile.interests[0]} 관심사와 학습 목표를 새 코스에 반영합니다.`
      : "배우고 싶은 주제와 목표를 입력해주세요.",
  );
  const isSearching = false;
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSavingPlaylist, setIsSavingPlaylist] = useState(false);

  useEffect(() => {
    void refreshCourseData();
  }, [session.user.id]);

  async function refreshCourseData() {
    const [courseResult, postResult] = await Promise.allSettled([
      fetchOwnerCourses(),
      fetchOwnedPostsForLibrary(),
    ]);
    const nextCourses = courseResult.status === "fulfilled" ? courseResult.value : [];
    const ownedPosts = postResult.status === "fulfilled" ? postResult.value : [];
    if (courseResult.status === "fulfilled" || postResult.status === "fulfilled") {
      setCourses(nextCourses);
      setPosts([
        ...nextCourses.flatMap((course) => postsFromCourse(course, ownedPosts)),
        ...ownedPosts,
      ]);
      return;
    }
    setStatus("내 코스를 불러오지 못했어요. 잠시 후 다시 시도해주세요.");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    await generateNewCourse();
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
    setAgentResult(null);
    setMcpResult(null);
    setStatus(
      "저장한 학습 자료와 YouTube 영상을 살펴 코스를 만들고 있어요.",
    );

    const [ragResponse, agentResponse, mcpResponse] = await Promise.allSettled([
      askRag(goal),
      askAgent(goal),
      askMcp(goal),
    ]);

    if (ragResponse.status === "fulfilled") {
      setRagResult(ragResponse.value);
      setCourseMatches(findMatchingCourses(playlists, posts, goal));
    }

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
        : "새 코스를 만들지 못했어요. 잠시 후 다시 시도해주세요.",
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
        "이 코스의 영상을 불러오지 못했어요. 코스를 다시 확인해주세요.",
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
    setStatus("코스를 저장하고 있습니다.");

    try {
      const postIds = await ensurePostIdsForGeneratedVideos(generatedVideos);

      const title =
        agentResult?.playlistTitle ??
        `${query.trim() || initialQuery || "맞춤"} 학습 코스`;
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
        <h1>내 코스</h1>
        <p>다음에 볼 영상과 지금까지 이어온 학습을 확인하세요.</p>
      </section>

      {playlists.length > 0 && (
        <section className="course-library" aria-labelledby="my-course-title">
          <div className="section-title">
            <h2 id="my-course-title">이어갈 코스</h2>
            <span>{playlists.length}개</span>
          </div>
          {playlists.map((playlist) => (
            <button key={playlist.id} type="button" onClick={() => playSavedPlaylist(playlist)}>
              <span><strong>{playlist.title}</strong><small>{playlist.postIds.length}개 영상</small></span>
              이어서 학습
            </button>
          ))}
        </section>
      )}

      {playlists.length === 0 && (
        <section className="learning-empty-state">
          <strong>이어갈 코스가 아직 없습니다</strong>
          <p>영상을 먼저 학습하면 다음 순서를 제안해드립니다.</p>
          <button type="button" onClick={() => navigate("/")}>
            영상으로 시작하기
          </button>
        </section>
      )}

      <details className="course-builder">
        <summary>새 코스 찾기</summary>
        <div className="course-builder-body">
          <p>배우고 싶은 주제나 목표가 분명할 때만 새 코스를 찾아보세요.</p>
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
              placeholder="예: 퇴근 후 20분씩 중국어 회화를 배우고 싶어"
              disabled={isSearching || isGenerating}
            />
            <button
              aria-busy={isGenerating}
              type="submit"
              disabled={isSearching || isGenerating}
            >
              {isGenerating ? "코스 만드는 중" : "코스 만들기"}
            </button>
          </form>
          <p className="system-note" aria-live="polite">{status}</p>
        </div>
      </details>

      {(courseMatches.length > 0 || existingVideos.length > 0 || ragResult) && (
        <section className="course-results">
          <div className="section-title">
            <h2>함께 참고한 학습 자료</h2>
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
                <em>이 영상 학습하기</em>
              </span>
            </button>
          ))}
          {ragResult &&
            existingVideos.length === 0 &&
            courseMatches.length === 0 && (
              <div className="empty-product">
                <strong>아직 딱 맞는 코스가 없어요</strong>
                <p>
                  코스 만들기를 누르면 관련 영상을 찾아 학습 순서로 정리합니다.
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
                새 학습 코스 {generatedVideos.length}개 영상
              </strong>
              <small>확인한 뒤 저장하거나 바로 학습할 수 있습니다.</small>
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
                <small>{video.channelName || "YouTube"}</small>
                <em>이 영상부터 코스로 보기</em>
              </span>
            </button>
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
