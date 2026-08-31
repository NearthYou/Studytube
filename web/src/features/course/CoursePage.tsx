import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { askAgent, askMcp, askRag } from "../../api";
import { createCourse, fetchOwnerCourses, publishCourse } from "../../courseApi";
import {
  chooseCourseRecommendationVideos,
  createCourseRecommendationContext,
  createPersonalizedCoursePrompt,
  createPromptSuggestions,
  hasLearningPreferences,
  learningPreferenceSummary,
} from "../../courseDiscovery";
import { readLearningHistory } from "../learning/learningHistory";
import { addVideosToQueue } from "../../watchQueueStorage";
import {
  clearCourseRecommendation,
  isCourseRecommendationSaved,
  readCourseRecommendation,
  saveCourseRecommendation,
} from "./courseRecommendationStorage";
import {
  attachCourseSequence,
  canFormCourse,
  courseStepFromQueueVideo,
  queueVideoFromMcpVideo,
  queueVideoFromRagPost,
  queueVideoFromRecommendation,
  uniqueVideos,
  type QueueVideo,
} from "../../watchQueue";
import type { AgentResponse, Course, McpResponse, RagResponse, Session } from "../../types";
import { RecommendationVideoResult } from "./RecommendationVideoResult";
import "./CoursePage.css";

export function CourseBuilderPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const profile = session.user.preferences;
  const hasProfile = hasLearningPreferences(profile);
  const preferenceSummary = learningPreferenceSummary(profile);
  const initialQuery = createPersonalizedCoursePrompt(profile);
  const [query, setQuery] = useState("");
  const [ragResult, setRagResult] = useState<RagResponse | null>(null);
  const [agentResult, setAgentResult] = useState<AgentResponse | null>(null);
  const [mcpResult, setMcpResult] = useState<McpResponse | null>(null);
  const [recommendation, setRecommendation] = useState(() =>
    readCourseRecommendation(),
  );
  const [courses, setCourses] = useState<Course[]>([]);
  const [status, setStatus] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSavingPlaylist, setIsSavingPlaylist] = useState(false);
  const generationInFlight = useRef(false);
  const recommendationAlreadySaved = Boolean(
    recommendation && isCourseRecommendationSaved(recommendation, courses),
  );

  useEffect(() => {
    void refreshCourseData();
  }, [session.user.id]);

  useEffect(() => {
    if (!recommendationAlreadySaved) return;
    clearCourseRecommendation();
  }, [recommendationAlreadySaved]);

  async function refreshCourseData() {
    try {
      setCourses(await fetchOwnerCourses());
    } catch {
      setStatus("내 코스를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    await generateNewCourse();
  }

  async function generateNewCourse(requestedSubject?: string) {
    const subject = (requestedSubject ?? query).trim();
    const goal =
      createPersonalizedCoursePrompt(profile, subject) ||
      subject ||
      initialQuery;

    if (!goal || generationInFlight.current) {
      if (!goal) {
        setStatus("새 코스를 만들 주제나 목표를 먼저 입력하세요.");
      }
      return;
    }

    generationInFlight.current = true;
    setIsGenerating(true);
    try {
      clearCourseRecommendation();
      setRecommendation(null);
      setRagResult(null);
      setAgentResult(null);
      setMcpResult(null);
      setStatus("저장한 학습 자료와 YouTube에서 맞는 영상을 찾고 있어요.");
      const recommendationContext = createCourseRecommendationContext(
        profile,
        subject,
        courses,
        readLearningHistory(),
      );

      const [ragResponse, agentResponse, mcpResponse] = await Promise.allSettled([
        askRag(subject || goal),
        askAgent(
          goal,
          profile?.interests ?? [],
          recommendationContext,
        ),
        askMcp({ query: subject || recommendationContext.subject, limit: 10 }),
      ]);

      if (ragResponse.status === "fulfilled") {
        setRagResult(ragResponse.value);
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

      const agentCandidates =
        agentResponse.status === "fulfilled"
          ? agentResponse.value.recommendations.flatMap((item) => {
              const video = queueVideoFromRecommendation(item);
              return video ? [video] : [];
            })
          : [];
      const fallbackCandidates =
        mcpResponse.status === "fulfilled"
          ? (mcpResponse.value.result?.videos ?? []).flatMap((item) => {
              const video = queueVideoFromMcpVideo(item);
              return video ? [video] : [];
            })
          : [];
      const playableVideos = uniqueVideos(
        chooseCourseRecommendationVideos(
          agentResponse.status === "fulfilled",
          agentCandidates,
          fallbackCandidates,
        ),
      ).slice(0, 4);
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
          ? `${playableVideos.length}개 영상을 순서대로 골랐어요.`
          : playableVideos.length === 1
            ? "맞는 영상 한 개를 찾았어요. 바로 시작할 수 있어요."
            : "맞는 영상을 찾지 못했어요. 배우고 싶은 내용이나 영상 길이를 조금 더 자세히 적어주세요.",
      );
    } finally {
      generationInFlight.current = false;
      setIsGenerating(false);
    }
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
        "코스를 만들려면 재생할 수 있는 영상이 두 개 이상 필요해요.",
      );
      return;
    }

    setIsSavingPlaylist(true);
    setStatus("코스를 저장하고 있어요.");

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
      clearCourseRecommendation();
      setRecommendation(null);
      setAgentResult(null);
      setMcpResult(null);
      setRagResult(null);
      setStatus(
        `"${saved.title}" 코스를 저장했어요.`,
      );
      navigate("/courses");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? `코스를 저장하지 못했습니다. ${error.message}`
          : "코스를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.",
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
  const generatedVideos = uniqueVideos(
    chooseCourseRecommendationVideos(Boolean(agentResult), agentVideos, mcpVideos),
  ).slice(0, 4);
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
    generatedVideos.length === 0 && !recommendationAlreadySaved
      ? (recommendation?.videos ?? [])
      : [];

  return (
    <main className="page-shell course-page">
      <header className="course-builder-page-heading">
        <div>
          <h1>새 코스 만들기</h1>
          <p>배울 내용을 적으면 맞는 영상을 골라 순서대로 보여드려요.</p>
        </div>
        <Link to="/courses">저장 코스 보기</Link>
      </header>

      <section className="course-builder">
        <header className="course-builder-heading">
          <div>
            <h2>무엇을 배우고 싶나요?</h2>
          </div>
        </header>
        <div className="course-builder-body">
          {hasProfile && preferenceSummary && (
            <div className="course-preference-note">
              <span>{preferenceSummary}</span>
              <Link state={{ returnTo: "/courses/new" }} to="/me/preferences">
                추천 바꾸기
              </Link>
            </div>
          )}
          <div className="quick-prompts" aria-label="바로 추천">
            {promptSuggestions.map((prompt) => (
              <button
                disabled={isGenerating}
                key={prompt}
                type="button"
                onClick={() => {
                  setQuery(prompt);
                  void generateNewCourse(prompt);
                }}
              >
                {prompt}
              </button>
            ))}
          </div>
          <form className="search-hero" onSubmit={submit}>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="예: 퇴근 후 20분씩 중국어 회화를 배우고 싶어"
              disabled={isGenerating}
            />
            <button
              aria-busy={isGenerating}
              type="submit"
              disabled={isGenerating}
            >
              {isGenerating ? "코스 만드는 중" : "코스 만들기"}
            </button>
          </form>
          {status && (
            <p className="system-note" aria-live="polite">
              {status}
            </p>
          )}
          <p className="course-recommendation-basis">
            자막이 있고 아직 보지 않은 영상을 먼저 고릅니다. 조회수는 비슷한 영상끼리 비교할 때만 봐요.
          </p>
        </div>
      </section>

      {preparedVideos.length > 0 && recommendation && (
        <section className="course-results prepared-course">
          <div className="playlist-toolbar">
            <div>
              <strong>저장 전 코스</strong>
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
                  첫 영상 보기
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
            <RecommendationVideoResult
              actionLabel={index === 0 ? "첫 영상 보기" : "이 영상부터 보기"}
              index={index}
              key={video.videoId}
              onSelect={() =>
                canFormCourse(preparedVideos)
                  ? addCourseAndWatch(video, preparedVideos, {
                      id: `recent-recommendation-${recommendation.updatedAt}`,
                      title: recommendation.title,
                    })
                  : addAndWatch(video, preparedVideos)
              }
              video={video}
            />
          ))}
        </section>
      )}

      {existingVideos.length > 0 && (
        <section className="course-results">
          <div className="section-title">
            <h2>함께 참고한 학습 자료</h2>
            <span>{existingVideos.length}개</span>
          </div>
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
              <small>{generatedVideos.length}개 영상을 위에서부터 차례로 봅니다.</small>
            </div>
            <button
              type="button"
              disabled={isSavingPlaylist}
              onClick={() => void saveGeneratedCourse()}
            >
              {isSavingPlaylist ? "저장 중" : "영상 저장하고 코스 만들기"}
            </button>
          </div>
          {generatedVideos.map((video, index) => (
            <RecommendationVideoResult
              actionLabel="이 영상부터 코스로 보기"
              index={index}
              key={video.id}
              onSelect={() =>
                addCourseAndWatch(video, generatedVideos, {
                  id: `generated-course-${generatedVideos.map((item) => item.videoId).join("-")}`,
                  title: generatedTitle,
                })
              }
              video={video}
            />
          ))}
        </section>
      )}

      {!generatedCourseReady && generatedVideos.length === 1 && (
        <section className="course-results single-video-result">
          <div className="section-title">
            <div>
              <h2>맞는 영상 한 개를 찾았어요</h2>
              <p>관련 없는 영상을 채우지 않았어요. 이 영상부터 바로 시작할 수 있어요.</p>
            </div>
          </div>
          <RecommendationVideoResult
            actionLabel="이 영상 학습하기"
            index={0}
            onSelect={() => addAndWatch(generatedVideos[0], generatedVideos)}
            video={generatedVideos[0]}
          />
        </section>
      )}

    </main>
  );
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
    ? `배우려는 내용: ${normalizedGoal}`
    : "관심사와 검색 결과로 만든 코스예요.";
}
