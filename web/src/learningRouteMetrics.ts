import type { StudyPost } from './types.ts';
import type { QueueVideo } from './watchQueue.ts';
import { estimateQueueMinutes as estimateWatchQueueMinutes } from './watchMetrics.ts';

const MAX_SUMMARY_CAPTION_SEGMENTS = 80;

export function estimateRouteMinutes(posts: StudyPost[], fallbackCount: number) {
  const total = posts.reduce((sum, post) => sum + estimateVideoMinutes(post), 0);

  if (total > 0) {
    return total;
  }

  return Math.max(1, fallbackCount) * 14;
}

export function estimateQueueMinutes(videos: QueueVideo[]) {
  return estimateWatchQueueMinutes(videos);
}

export function sampleCaptionSegmentsForSummary(
  segments: Array<{ start: number; end: number; text: string }>,
) {
  if (segments.length <= MAX_SUMMARY_CAPTION_SEGMENTS) {
    return segments;
  }

  const step = Math.ceil(segments.length / MAX_SUMMARY_CAPTION_SEGMENTS);

  return segments
    .filter((_segment, index) => index % step === 0)
    .slice(0, MAX_SUMMARY_CAPTION_SEGMENTS);
}

export function estimateVideoMinutes(post: StudyPost) {
  const textWeight = Math.ceil(
    `${post.summary} ${post.translatedNotes}`.length / 180,
  );

  return Math.min(28, Math.max(8, 8 + textWeight * 3));
}

export function difficultyLabel(tags: string[]) {
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

export function audienceLabel(tags: string[]) {
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
