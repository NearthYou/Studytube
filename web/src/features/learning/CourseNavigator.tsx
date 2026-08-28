import { useState } from "react";
import { Link } from "react-router";
import type { QueueVideo } from "../../watchQueue.ts";
import { courseNavigatorModel } from "./courseNavigatorModel.ts";

export function CourseNavigator({
  currentVideoId,
  onSelect,
  videos,
}: {
  currentVideoId: string;
  onSelect: (video: QueueVideo) => void;
  videos: QueueVideo[];
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  if (videos.length < 2) return null;

  const { current, currentIndex, next, orderedVideos, previous } =
    courseNavigatorModel(videos, currentVideoId);

  return (
    <nav className="course-navigator" aria-label="현재 코스 순서">
      <div className="course-navigator-summary">
        <strong>{current.course?.title ?? "이어 보는 영상"}</strong>
      </div>
      <div className="course-navigator-actions">
        {previous && (
          <button
            aria-label={`이전 영상: ${previous.title}`}
            className="secondary-action"
            onClick={() => onSelect(previous)}
            type="button"
          >
            이전
          </button>
        )}
        <button
          aria-controls="course-video-picker-list"
          aria-expanded={pickerOpen}
          className="course-video-picker-toggle"
          onClick={() => setPickerOpen((open) => !open)}
          type="button"
        >
          {currentIndex + 1} / {orderedVideos.length} 영상 선택
        </button>
        {next && (
          <button
            aria-label={`다음 영상: ${next.title}`}
            onClick={() => onSelect(next)}
            type="button"
          >
            다음
          </button>
        )}
        <Link to="/courses">코스 목록</Link>
      </div>
      {pickerOpen && (
        <ol className="course-video-picker-list" id="course-video-picker-list">
          {orderedVideos.map((video, index) => {
            const selected = video.videoId === current.videoId;
            return (
              <li key={`${video.videoId}-${index}`}>
                <button
                  aria-current={selected ? "true" : undefined}
                  onClick={() => {
                    setPickerOpen(false);
                    onSelect(video);
                  }}
                  type="button"
                >
                  {video.thumbnailUrl ? (
                    <img alt="" loading="lazy" src={video.thumbnailUrl} />
                  ) : (
                    <span className="course-video-picker-placeholder" />
                  )}
                  <span>
                    <small>{index + 1}번째 영상</small>
                    <strong>{video.title}</strong>
                  </span>
                  {selected && <em>현재 학습 중</em>}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </nav>
  );
}
