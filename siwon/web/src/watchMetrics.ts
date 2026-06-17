type WatchQueueMetricVideo = {
  summary?: string;
  translatedNotes?: string;
};

export function estimateQueueMinutes(videos: WatchQueueMetricVideo[]) {
  if (videos.length === 0) {
    return 0;
  }

  const total = videos.reduce((sum, video) => {
    const textWeight = Math.ceil(
      `${video.summary ?? ''} ${video.translatedNotes ?? ''}`.length / 180,
    );

    return sum + Math.min(28, Math.max(8, 8 + textWeight * 3));
  }, 0);

  return total > 0 ? total : videos.length * 14;
}
