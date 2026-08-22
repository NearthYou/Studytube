import type {
  AgentResponse,
  CourseStep,
  McpResponse,
  RagResponse,
  StudyPost,
} from './types.ts';
import { deriveTags, extractYouTubeId, slugify } from './videoMetadata.ts';

export type QueueVideo = {
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
  courseStepId?: string;
  sourcePostId?: number | null;
  learning?: VideoLearningState;
  learningContextId?: string;
  learningWorkId?: string;
};

export function queueVideoFromLearningIntake(input: {
  videoId: string;
  videoUrl: string;
  contextId: string;
  workId: string;
}): QueueVideo {
  return normalizeQueueVideo({
    id: `learning-${input.videoId}`,
    title: "새 학습 영상",
    videoId: input.videoId,
    videoUrl: input.videoUrl,
    thumbnailUrl: `https://i.ytimg.com/vi/${input.videoId}/hqdefault.jpg`,
    channelName: "YouTube",
    summary: "",
    translatedNotes: "",
    source: "직접 등록",
    learningContextId: input.contextId,
    learningWorkId: input.workId,
  });
}

export type CaptionLanguage = 'ko' | 'en';

export type LoopRange = {
  enabled: boolean;
  manual?: boolean;
  start: number;
  end: number;
};

export type LearningMark = {
  id: string;
  start: number;
  end: number;
  note: string;
  caption: string;
  createdAt: string;
};

export type VideoLearningState = {
  captionLanguage: CaptionLanguage;
  captionsEnabled: boolean;
  playbackRate: number;
  loop: LoopRange;
  marks: LearningMark[];
};

export const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2];

export const DEFAULT_LEARNING_STATE: VideoLearningState = {
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

export function queueVideoFromPost(post: StudyPost): QueueVideo {
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

export function queueVideoFromCourseStep(step: CourseStep): QueueVideo {
  return {
    id: `course-step-${step.id}`,
    courseStepId: step.id,
    sourcePostId: step.sourcePostId ?? null,
    title: step.snapshot.title,
    videoId: extractYouTubeId(step.snapshot.videoUrl) ?? `course-step-${step.id}`,
    videoUrl: step.snapshot.videoUrl,
    thumbnailUrl: step.snapshot.thumbnailUrl,
    channelName: step.snapshot.channelName,
    summary: '',
    translatedNotes: '',
    source: 'course',
    learning: step.ownerLearningState,
  };
}

export function queueVideoFromRagPost(
  post: RagResponse['relatedPosts'][number],
): QueueVideo {
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

export function queueVideoFromRecommendation(
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

export function queueVideoFromMcpVideo(
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

export function uniqueVideos(videos: QueueVideo[]) {
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

export function queueVideoKey(video: QueueVideo) {
  return video.videoId || video.videoUrl || video.id;
}

export function isVideoInQueue(queue: QueueVideo[], video: QueueVideo) {
  const key = queueVideoKey(video);

  return queue.some((queuedVideo) => queueVideoKey(queuedVideo) === key);
}

export function replaceVideoInQueueIfPresent(
  existingQueue: QueueVideo[],
  savedVideo: QueueVideo,
) {
  const savedKey = queueVideoKey(savedVideo);
  let replaced = false;
  const queue = existingQueue.map((video) => {
    if (queueVideoKey(video) !== savedKey) {
      return video;
    }

    replaced = true;
    return mergeVideoLearning(savedVideo, video);
  });

  return { queue, replaced };
}

export function extractPostIds(videos: QueueVideo[]) {
  return [
    ...new Set(
      videos
        .map((video) => video.id.match(/^(?:post|rag)-(\d+)$/)?.[1])
        .filter((id): id is string => Boolean(id))
        .map((id) => Number(id)),
    ),
  ];
}

export function findPostIdForQueueVideo(video: QueueVideo, posts: StudyPost[]) {
  const directPostId = video.id.match(/^(?:post|rag)-(\d+)$/)?.[1];

  if (directPostId) {
    return Number(directPostId);
  }

  const videoKey = queueVideoKey(video);
  const matchingPost = posts.find((post) => {
    const postVideoId = extractYouTubeId(post.videoUrl) ?? String(post.id);

    return (
      post.videoUrl === video.videoUrl ||
      postVideoId === video.videoId ||
      postVideoId === videoKey
    );
  });

  return matchingPost?.id ?? null;
}

export function postPayloadFromQueueVideo(video: QueueVideo) {
  const summary =
    video.summary.trim() ||
    `${video.channelName || 'YouTube'} 채널의 추천 학습 영상입니다.`;
  const translatedNotes =
    video.translatedNotes.trim() ||
    `${summary}\n\n이 영상을 코스에 포함해 순서대로 학습하세요.`;
  const tags = deriveTags(`${video.title} ${video.channelName} ${summary}`);

  return {
    title: video.title.trim() || '추천 학습 영상',
    videoUrl: video.videoUrl,
    thumbnailUrl: video.thumbnailUrl,
    channelName: video.channelName || video.source || 'YouTube',
    summary,
    translatedNotes,
    tags: tags.length > 0 ? tags : ['추천'],
  };
}

export function mergeVideosIntoQueue(
  existingQueue: QueueVideo[],
  videos: QueueVideo[],
  selectedVideo: QueueVideo,
) {
  const existingById = new Map(existingQueue.map((video) => [video.id, video]));
  const selectedFirst = [
    selectedVideo,
    ...videos.filter((video) => video.id !== selectedVideo.id),
  ].map((video) => mergeVideoLearning(video, existingById.get(video.id)));
  const selectedIds = new Set(selectedFirst.map((video) => video.id));
  const existing = existingQueue.filter((video) => !selectedIds.has(video.id));
  const nextQueue = uniqueVideos([...selectedFirst, ...existing]);

  return nextQueue;
}

export function normalizeQueueVideo(video: QueueVideo): QueueVideo {
  return {
    ...video,
    learning: getVideoLearningState(video),
  };
}

export function isQueueVideoLike(video: unknown): video is QueueVideo {
  return (
    Boolean(video) &&
    typeof video === 'object' &&
    typeof (video as QueueVideo).id === 'string' &&
    typeof (video as QueueVideo).title === 'string' &&
    typeof (video as QueueVideo).videoId === 'string' &&
    typeof (video as QueueVideo).videoUrl === 'string'
  );
}

export function mergeVideoLearning(
  video: QueueVideo,
  existing?: QueueVideo,
): QueueVideo {
  return {
    ...normalizeQueueVideo(video),
    learning: existing
      ? getVideoLearningState(existing)
      : getVideoLearningState(video),
  };
}

export function getVideoLearningState(video: QueueVideo): VideoLearningState {
  const learning = video.learning;
  const loop = learning?.loop ?? DEFAULT_LEARNING_STATE.loop;
  const loopWasExplicitlyEnabled = Boolean(loop.manual);
  const playbackRate = learning?.playbackRate;

  return {
    captionLanguage:
      learning?.captionLanguage === 'en' || learning?.captionLanguage === 'ko'
        ? learning.captionLanguage
        : DEFAULT_LEARNING_STATE.captionLanguage,
    captionsEnabled:
      typeof learning?.captionsEnabled === 'boolean'
        ? learning.captionsEnabled
        : DEFAULT_LEARNING_STATE.captionsEnabled,
    playbackRate:
      typeof playbackRate === 'number' && PLAYBACK_RATES.includes(playbackRate)
        ? playbackRate
        : DEFAULT_LEARNING_STATE.playbackRate,
    loop: {
      enabled:
        typeof loop.enabled === 'boolean'
          ? loop.enabled && loopWasExplicitlyEnabled
          : DEFAULT_LEARNING_STATE.loop.enabled,
      manual: loopWasExplicitlyEnabled,
      start:
        typeof loop.start === 'number' ? loop.start : DEFAULT_LEARNING_STATE.loop.start,
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
