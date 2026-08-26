import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { askAgent, askMcp, askRag, fetchPosts } from "../../api";
import { createCourse, fetchOwnerCourses, publishCourse } from "../../courseApi";
import { createPersonalizedCoursePrompt, createPromptSuggestions, findMatchingCourses, hasLearningPreferences } from "../../courseDiscovery";
import { addVideosToQueue } from "../../watchQueueStorage";
import {
  learningHistoryProgress,
  readLearningHistory,
} from "../learning/learningHistory";
import {
  readCourseRecommendation,
  saveCourseRecommendation,
} from "./courseRecommendationStorage";
import {
  attachCourseSequence,
  canFormCourse,
  courseStepFromQueueVideo,
  queueVideoFromCourseStep,
  queueVideoFromMcpVideo,
  queueVideoFromRagPost,
  queueVideoFromRecommendation,
  uniqueVideos,
  type QueueVideo,
} from "../../watchQueue";
import type { AgentResponse, Course, McpResponse, Playlist, RagResponse, Session, StudyPost } from "../../types";
import "./CoursePage.css";

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
  const [recommendation, setRecommendation] = useState(() =>
    readCourseRecommendation(),
  );
  const [learningHistory] = useState(() => readLearningHistory().slice(0, 6));
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
    const subject = query.trim();
    const goal =
      createPersonalizedCoursePrompt(profile, subject) ||
      subject ||
      initialQuery;

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
      askAgent(goal, profile?.interests ?? []),
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

    const playableVideos = uniqueVideos([
      ...(agentResponse.status === "fulfilled"
        ? agentResponse.value.recommendations.flatMap((item) => {
            const video = queueVideoFromRecommendation(item);
            return video ? [video] : [];
          })
        : []),
      ...(mcpResponse.status === "fulfilled"
        ? (mcpResponse.value.result?.videos ?? []).flatMap((item) => {
            const video = queueVideoFromMcpVideo(item);
            return video ? [video] : [];
          })
        : []),
    ]).slice(0, 4);
    if (playableVideos.length > 0) {
      const recommendationTitle = (
        agentResponse.status === "fulfilled"
          ? agentResponse.value.playlistTitle
          : `${subject || profile?.interests[0] || "맞춤"} 학습 코스`
      )
        .trim()
        .slice(0, 120);
      setRecommendation(
        saveCourseRecommendation({
          goal: subject || goal,
          title: recommendationTitle,
          videos: playableVideos,
        }),
      );
    }
    setStatus(
      canFormCourse(playableVideos)
        ? `${playableVideos.length}개 영상을 학습 순서로 정리했습니다.`
        : playableVideos.length === 1
          ? "관련 영상 한 개를 찾았습니다. 코스로 묶으려면 영상이 두 개 이상 필요합니다."
          : "재생할 수 있는 관련 영상을 찾지 못했습니다. 주제를 조금 더 구체적으로 적어주세요.",
    );
    setIsGenerating(false);
  }

  function addAndWatch(video: QueueVideo, relatedVideos: QueueVideo[]) {
    const queue = addVideosToQueue(relatedVideos, video);
    const firstVideo = queue.find((item) => item.id === video.id) ?? video;
    navigate(`/watch?videoId=${firstVideo.videoId}`);
  }

  function addCourseAndWatch(
    video: QueueVideo,
    videos: QueueVideo[],
    course: { id: string; title: string },
  ) {
    const courseVideos = attachCourseSequence(videos, course);
    const selected =
      courseVideos.find((item) => item.videoId === video.videoId) ??
      courseVideos[0];
    addVideosToQueue(courseVideos, selected);
    navigate(`/watch?videoId=${selected.videoId}`);
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

    addCourseAndWatch(courseVideos[0], courseVideos, {
      id: `saved-course-${course?.id ?? playlist.id}`,
      title: course?.title ?? playlist.title,
    });
  }

  async function saveGeneratedCourse() {
    await saveCourse(
      generatedVideos,
      generatedTitle,
      generatedCourseDescription(recommendation?.goal ?? query),
    );
  }

  async function savePreparedCourse() {
    if (!recommendation) return;

    await saveCourse(
      preparedVideos,
      recommendation.title,
      generatedCourseDescription(recommendation.goal),
    );
  }

  async function saveCourse(
    videos: QueueVideo[],
    title: string,
    description: string,
  ) {
    if (!canFormCourse(videos)) {
      setStatus(
        "코스로 묶으려면 재생할 수 있는 영상이 두 개 이상 필요합니다.",
      );
      return;
    }

    setIsSavingPlaylist(true);
    setStatus("코스를 저장하고 있습니다.");

    try {
      const created = await createCourse(
        {
          title,
          description,
          steps: videos.map(courseStepFromQueueVideo),
        },
        generatedCourseIdempotencyKey(
          session.user.id,
          title,
          description,
          videos.map((video) => video.videoId),
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
    } catch (error) {
      setStatus(
        error instanceof Error
          ? `코스를 저장하지 못했습니다. ${error.message}`
          : "코스를 저장하지 못했습니다. 잠시 후 다시 시도해주세요.",
      );
    } finally {
      setIsSavingPlaylist(false);
    }
  }

  const existingVideos =
    ragResult?.relatedPosts.map(queueVideoFromRagPost) ?? [];
  const agentVideos =
    agentResult?.recommendations.flatMap((item) => {
      const video = queueVideoFromRecommendation(item);
      return video ? [video] : [];
    }) ?? [];
  const mcpVideos =
    mcpResult?.result?.videos.flatMap((item) => {
      const video = queueVideoFromMcpVideo(item);

      return video ? [video] : [];
    }) ?? [];
  const generatedVideos = uniqueVideos([...agentVideos, ...mcpVideos]).slice(
    0,
    4,
  );
  const generatedCourseReady = canFormCourse(generatedVideos);
  const generatedTitle =
    (
      agentResult?.playlistTitle ??
      `${query.trim() || profile?.interests[0] || "맞춤"} 학습 코스`
    )
      .trim()
      .slice(0, 120);
  const promptSuggestions = createPromptSuggestions(profile);
  const preparedVideos =
    generatedVideos.length === 0 ? (recommendation?.videos ?? []) : [];
  const hasStartingPoint =
    playlists.length > 0 || preparedVideos.length > 0 || learningHistory.length > 0;

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

      {preparedVideos.length > 0 && recommendation && (
        <section className="course-results prepared-course">
          <div className="playlist-toolbar">
            <div>
              <strong>준비된 학습 순서</strong>
              <small>{recommendation.title}</small>
            </div>
            {canFormCourse(preparedVideos) ? (
              <div className="prepared-course-actions">
                <button
                  className="secondary-action"
                  type="button"
                  onClick={() =>
                    addCourseAndWatch(preparedVideos[0], preparedVideos, {
                      id: `recent-recommendation-${recommendation.updatedAt}`,
                      title: recommendation.title,
                    })
                  }
                >
                  이어서 시작
                </button>
                <button
                  type="button"
                  disabled={isSavingPlaylist}
                  onClick={() => void savePreparedCourse()}
                >
                  {isSavingPlaylist ? "저장 중" : "코스로 저장"}
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setQuery(recommendation.goal)}>
                이 주제로 더 찾기
              </button>
            )}
          </div>
          {preparedVideos.map((video, index) => (
            <button
              className="video-result"
              key={video.videoId}
              type="button"
              onClick={() =>
                canFormCourse(preparedVideos)
                  ? addCourseAndWatch(video, preparedVideos, {
                      id: `recent-recommendation-${recommendation.updatedAt}`,
                      title: recommendation.title,
                    })
                  : addAndWatch(video, preparedVideos)
              }
            >
              <img src={video.thumbnailUrl} alt="" />
              <span>
                <small>{index + 1}번째 영상</small>
                <strong>{video.title}</strong>
                <em>{index === 0 ? "이어서 학습" : "이 영상부터 시작"}</em>
              </span>
            </button>
          ))}
        </section>
      )}

      {learningHistory.length > 0 && (
        <section className="course-results recent-learning">
          <div className="section-title">
            <h2>최근 학습</h2>
            <span>{learningHistory.length}개</span>
          </div>
          {learningHistory.map((entry) => (
            <button
              className="video-result"
              key={entry.video.videoId}
              type="button"
              onClick={() => addAndWatch(entry.video, [entry.video])}
            >
              <img src={entry.video.thumbnailUrl} alt="" />
              <span>
                <strong>{entry.video.title}</strong>
                <small>
                  {entry.completed
                    ? "학습 완료"
                    : `${learningHistoryProgress(entry)}% 학습`}
                </small>
                <em>{entry.completed ? "다시 보기" : "이어서 보기"}</em>
              </span>
            </button>
          ))}
        </section>
      )}

      {!hasStartingPoint && (
        <section className="learning-empty-state">
          <strong>이어갈 코스가 아직 없습니다</strong>
          <p>영상을 먼저 학습하면 다음 순서를 제안해드립니다.</p>
          <button type="button" onClick={() => navigate("/")}>
            영상으로 시작하기
          </button>
        </section>
      )}

      <section className="course-builder">
        <header className="course-builder-heading">
          <div>
            <h2>{hasStartingPoint ? "새로 찾기" : "코스 찾기"}</h2>
            <p>배우고 싶은 내용을 적으면 관련 영상을 2~4개 골라 순서대로 보여드립니다.</p>
          </div>
          <Link to="/me">학습 설정 바꾸기</Link>
        </header>
        <div className="course-builder-body">
          {hasProfile && (
            <div className="preference-summary">
              <strong>이번 코스에 적용되는 학습 설정</strong>
              <span>관심사 {profile.interests.join(", ")}</span>
              <span>학습 속도 {profile.pace}</span>
              <span>목표 {profile.goal}</span>
            </div>
          )}
          {!hasProfile && (
            <div className="preference-summary empty">
              <strong>학습 설정이 아직 없습니다</strong>
              <span>주제만으로도 만들 수 있고, 설정을 저장하면 관심사와 속도를 함께 반영합니다.</span>
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
          <p className="course-recommendation-basis">
            주제 관련도, 학습 설정, 자막 가능성, 중복 여부를 기준으로 고릅니다. 조회수 순이 아닙니다.
          </p>
        </div>
      </section>

      {(courseMatches.length > 0 || existingVideos.length > 0) && (
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
        </section>
      )}

      {generatedCourseReady && (
        <section className="course-results">
          <div className="playlist-toolbar">
            <div>
              <strong>
                {generatedTitle}
              </strong>
              <small>{generatedVideos.length}개 영상을 위에서부터 순서대로 학습합니다.</small>
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
              onClick={() =>
                addCourseAndWatch(video, generatedVideos, {
                  id: `generated-course-${generatedVideos.map((item) => item.videoId).join("-")}`,
                  title: generatedTitle,
                })
              }
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

      {!generatedCourseReady && generatedVideos.length === 1 && (
        <section className="course-results single-video-result">
          <div className="section-title">
            <div>
              <h2>관련 영상 한 개를 찾았습니다</h2>
              <p>코스로 묶으려면 영상이 두 개 이상 필요합니다. 이 영상은 바로 학습할 수 있습니다.</p>
            </div>
          </div>
          <button
            className="video-result"
            type="button"
            onClick={() => addAndWatch(generatedVideos[0], generatedVideos)}
          >
            <img src={generatedVideos[0].thumbnailUrl} alt="" />
            <span>
              <strong>{generatedVideos[0].title}</strong>
              <small>{generatedVideos[0].channelName || "YouTube"}</small>
              <em>이 영상 학습하기</em>
            </span>
          </button>
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
  videoIds: string[],
) {
  const value = `${title}\n${description}\n${videoIds.join(",")}`;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `generated-course:v2:u${userId}:p${(hash >>> 0).toString(36)}`;
}

function generatedCourseDescription(goal: string) {
  const normalizedGoal = goal.trim();

  return normalizedGoal
    ? `학습 목표: ${normalizedGoal}`
    : "관심사와 검색 결과를 바탕으로 만든 학습 코스입니다.";
}
