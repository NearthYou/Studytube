import type { LearningHistoryEntry } from './features/learning/learningHistory.ts';
import type { QueueVideo } from './watchQueue.ts';
import type {
  Course,
  CourseRecommendationContext,
  LearningPreferences,
  Playlist,
  StudyPost,
} from './types.ts';
import { extractYouTubeId } from './videoMetadata.ts';

export function hasLearningPreferences(
  profile: LearningPreferences | null | undefined,
): profile is LearningPreferences {
  return Boolean(
    profile &&
      profile.interests.some((item) => item.trim()) &&
      profile.pace.trim() &&
      profile.goal.trim(),
  );
}

export function createPersonalizedCoursePrompt(
  profile: LearningPreferences | null,
  subject = '',
) {
  const requestedSubject = subject.trim();
  const requestTail =
    '실제로 재생할 수 있는 YouTube 영상 2~4개를 쉬운 순서로 추천해줘.';

  if (!hasLearningPreferences(profile)) {
    return requestedSubject
      ? [`배울 내용: ${requestedSubject}`, requestTail].join('\n')
      : '';
  }

  const interests = profile.interests.slice(0, 2).join(', ');
  if (requestedSubject) {
    return [
      `배울 내용: ${requestedSubject}`,
      `관심사: ${interests}`,
      `학습 속도: ${profile.pace}`,
      `학습 목표: ${profile.goal}`,
      requestTail,
    ].join('\n');
  }

  return [
    `관심사: ${interests}`,
    `학습 속도: ${profile.pace}`,
    `학습 목표: ${profile.goal}`,
    requestTail,
  ].join('\n');
}

export function createPromptSuggestions(profile: LearningPreferences | null) {
  if (!hasLearningPreferences(profile)) {
    return [];
  }

  return [
    `${profile.interests[0]} 입문 코스`,
    `${profile.goal}`,
    `${profile.pace} 따라갈 수 있는 취향 코스`,
  ];
}

export function createCourseRecommendationContext(
  profile: LearningPreferences | null,
  subject: string,
  courses: Course[],
  history: LearningHistoryEntry[],
): CourseRecommendationContext {
  const recentVideos = history.slice(0, 5).map((entry) => ({
    videoId: entry.video.videoId,
    title: entry.video.title,
    channel: entry.video.channelName,
    completed: entry.completed,
  }));
  const excludedVideoIds = new Set(
    recentVideos.map((video) => video.videoId).filter(Boolean),
  );
  for (const course of courses) {
    for (const step of course.steps) {
      const videoId = extractYouTubeId(step.snapshot.videoUrl);
      if (videoId) excludedVideoIds.add(videoId);
    }
  }
  return {
    subject: subject.trim(),
    pace: profile?.pace.trim() ?? '',
    learningGoal: profile?.goal.trim() ?? '',
    interests: profile?.interests.map((item) => item.trim()).filter(Boolean) ?? [],
    excludedVideoIds: [...excludedVideoIds],
    recentVideos,
  };
}

export function chooseCourseRecommendationVideos(
  agentCompleted: boolean,
  rankedVideos: QueueVideo[],
  fallbackVideos: QueueVideo[],
) {
  return agentCompleted ? rankedVideos : fallbackVideos;
}

export function findMatchingCourses(
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
      const coursePosts = postsForPlaylistIds(playlist.postIds, posts);
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

export function filterPlaylists(
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

export function postsForPlaylistIds(postIds: number[], posts: StudyPost[]) {
  return postIds
    .map((postId) => posts.find((post) => post.id === postId))
    .filter((post): post is StudyPost => Boolean(post));
}

export function tagsFromPosts(posts: StudyPost[]) {
  return [...new Set(posts.flatMap((post) => post.tags))];
}

export function courseSummaryFromPosts(posts: StudyPost[]) {
  if (posts.length === 0) {
    return '아직 영상 정보가 연결되지 않은 학습 코스입니다.';
  }

  return posts
    .slice(0, 3)
    .map((post, index) => `${index + 1}. ${post.title}`)
    .join(' / ');
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
