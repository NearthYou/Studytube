import type { CaptionSegment } from './types';

const FINAL_CAPTION_END_HOLD_SECONDS = 4;
const VIDEO_END_TOLERANCE_SECONDS = 0.75;

export function selectActiveCaption({
  captionsEnabled,
  currentTime,
  holdLastCaption,
  segments,
  videoDuration,
}: {
  captionsEnabled: boolean;
  currentTime: number;
  holdLastCaption: boolean;
  segments: CaptionSegment[];
  videoDuration: number;
}) {
  if (!captionsEnabled || segments.length === 0) {
    return null;
  }

  const timedCaption =
    segments.findLast(
      (segment) => currentTime >= segment.start && currentTime < segment.end,
    ) ?? null;

  if (timedCaption) {
    return timedCaption;
  }

  const lastCaption = segments[segments.length - 1];

  if (!lastCaption || currentTime < lastCaption.end) {
    return null;
  }

  if (holdLastCaption) {
    return lastCaption;
  }

  if (
    videoDuration > 0 &&
    currentTime <= videoDuration + VIDEO_END_TOLERANCE_SECONDS &&
    videoDuration - lastCaption.end <= FINAL_CAPTION_END_HOLD_SECONDS
  ) {
    return lastCaption;
  }

  return null;
}
