export type CaptionTrackKind = 'youtube_caption' | 'transcription' | null;

export type CaptionTrackBounds = {
  startSeconds: number;
  endSeconds: number;
};

export function isFullVideoCaptionCoverage(
  sourceKind: CaptionTrackKind,
  source: CaptionTrackBounds,
  candidate: CaptionTrackBounds,
): boolean {
  if (sourceKind !== 'youtube_caption') return false;
  if (!validBounds(source) || !validBounds(candidate)) return false;
  if (source.startSeconds > 5) return false;

  const sourceDuration = source.endSeconds - source.startSeconds;
  const endToleranceSeconds = Math.min(30, Math.max(5, sourceDuration * 0.05));
  return (
    candidate.startSeconds <= source.startSeconds + 5 &&
    candidate.endSeconds >= source.endSeconds - endToleranceSeconds
  );
}

function validBounds(bounds: CaptionTrackBounds): boolean {
  return (
    Number.isFinite(bounds.startSeconds) &&
    Number.isFinite(bounds.endSeconds) &&
    bounds.startSeconds >= 0 &&
    bounds.endSeconds > bounds.startSeconds
  );
}
