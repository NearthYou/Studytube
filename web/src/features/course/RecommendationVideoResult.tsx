import type { QueueVideo } from '../../watchQueue.ts';
import { recommendationPresentation } from './recommendationPresentation.ts';

export function RecommendationVideoResult({
  actionLabel,
  index,
  onSelect,
  video,
}: {
  actionLabel: string;
  index: number;
  onSelect: () => void;
  video: QueueVideo;
}) {
  const presentation = recommendationPresentation(video, index);
  return (
    <button className="video-result" type="button" onClick={onSelect}>
      <img src={video.thumbnailUrl} alt="" />
      <span>
        <small>{presentation.stepLabel}</small>
        <strong>{video.title}</strong>
        <small>{video.channelName || 'YouTube'}</small>
        {presentation.reasonText && (
          <span className="course-recommendation-reasons">
            {presentation.reasonText}
          </span>
        )}
        <em>{actionLabel}</em>
      </span>
    </button>
  );
}
