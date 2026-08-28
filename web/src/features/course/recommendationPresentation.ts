import type { QueueVideo } from '../../watchQueue.ts';

const ROLE_LABELS: Partial<Record<NonNullable<QueueVideo['courseRole']>, string>> = {
  introduction: '입문',
  concept: '핵심 개념',
  practice: '따라 하기',
  application: '활용',
};

export function recommendationPresentation(video: QueueVideo, index: number) {
  const roleLabel = video.courseRole ? ROLE_LABELS[video.courseRole] : undefined;
  const reasons = [
    ...new Set(
      (video.recommendationReasons ?? [])
        .map((reason) => reason.trim())
        .filter(Boolean),
    ),
  ].slice(0, 4);
  return {
    stepLabel: roleLabel
      ? `${index + 1}단계 ${roleLabel}`
      : `${index + 1}번째 영상`,
    reasonText: reasons.join(' / '),
  };
}
