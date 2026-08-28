import assert from "node:assert/strict";
import test from "node:test";
import type { Course, LearningPreferences } from "../src/types.ts";
import type { LearningHistoryEntry } from "../src/features/learning/learningHistory.ts";
import type { QueueVideo } from "../src/watchQueue.ts";

type BuildRecommendationContext = (
  profile: LearningPreferences | null,
  subject: string,
  courses: Course[],
  history: LearningHistoryEntry[],
) => {
  subject: string;
  pace: string;
  learningGoal: string;
  interests: string[];
  excludedVideoIds: string[];
  recentVideos: Array<{
    videoId: string;
    title: string;
    channel: string;
    completed: boolean;
  }>;
};

test("recommendation context excludes watched and saved videos while retaining recent topics", async () => {
  const module = (await import("../src/courseDiscovery.ts")) as Record<
    string,
    unknown
  >;
  const build = module.createCourseRecommendationContext as
    | BuildRecommendationContext
    | undefined;

  assert.equal(
    typeof build,
    "function",
    "최근 학습과 저장 코스를 추천 맥락으로 만드는 함수가 필요합니다.",
  );
  if (!build) return;

  const history: LearningHistoryEntry[] = [
    {
      video: {
        id: "recent-1",
        title: "C++ 변수 기초",
        videoId: "abc123DEF45",
        videoUrl: "https://www.youtube.com/watch?v=abc123DEF45",
        thumbnailUrl: "recent.jpg",
        channelName: "지난 코딩 채널",
        summary: "변수와 자료형",
        translatedNotes: "",
        source: "course",
      },
      lastPositionSeconds: 600,
      durationSeconds: 1200,
      completed: false,
      lastViewedAt: "2026-08-28T00:00:00.000Z",
    },
  ];
  const courses: Course[] = [
    {
      id: 7,
      title: "저장한 C++ 코스",
      description: "",
      visibility: "private",
      status: "draft",
      version: 1,
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:00.000Z",
      publishedAt: null,
      feedback: [],
      steps: [
        {
          id: "step-1",
          position: 1,
          snapshot: {
            title: "저장한 반복문 강의",
            videoUrl: "https://www.youtube.com/watch?v=courseVID01",
            thumbnailUrl: "course.jpg",
            channelName: "저장 채널",
          },
        },
      ],
    },
  ];
  const profile: LearningPreferences = {
    interests: ["프로그래밍", "영어"],
    pace: "하루 20분",
    goal: "기초부터 직접 코드를 작성하기",
  };

  const context = build(profile, "C++", courses, history);

  assert.deepEqual(context, {
    subject: "C++",
    pace: "하루 20분",
    learningGoal: "기초부터 직접 코드를 작성하기",
    interests: ["프로그래밍", "영어"],
    excludedVideoIds: ["abc123DEF45", "courseVID01"],
    recentVideos: [
      {
        videoId: "abc123DEF45",
        title: "C++ 변수 기초",
        channel: "지난 코딩 채널",
        completed: false,
      },
    ],
  });
});

test("an empty evaluated recommendation is not padded with unranked fallback videos", async () => {
  const module = (await import("../src/courseDiscovery.ts")) as Record<
    string,
    unknown
  >;
  const choose = module.chooseCourseRecommendationVideos as
    | ((
        agentCompleted: boolean,
        ranked: QueueVideo[],
        fallback: QueueVideo[],
      ) => QueueVideo[])
    | undefined;
  assert.equal(
    typeof choose,
    "function",
    "품질 검사를 마친 빈 결과와 검색 실패를 구분해야 합니다.",
  );
  if (!choose) return;

  const fallback: QueueVideo = {
    id: "mcp-fallback",
    title: "무관한 인기 영상",
    videoId: "sHS1z9Pr4v8",
    videoUrl: "https://www.youtube.com/watch?v=sHS1z9Pr4v8",
    thumbnailUrl: "fallback.jpg",
    channelName: "인기 채널",
    summary: "",
    translatedNotes: "",
    source: "youtube-search-page",
  };

  assert.deepEqual(choose(true, [], [fallback]), []);
  assert.deepEqual(choose(false, [], [fallback]), [fallback]);
});
