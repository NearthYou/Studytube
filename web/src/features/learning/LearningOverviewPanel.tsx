import { formatTime } from "../../videoSummaryDetails.ts";
import { useLearningOverview } from "./useLearningOverview.ts";
import { LearningPanelState } from "./LearningPanelState.tsx";

export function LearningOverviewPanel({
  active,
  contextId,
  onSeek,
}: {
  active: boolean;
  contextId: string;
  onSeek: (seconds: number) => void;
}) {
  const overview = useLearningOverview(contextId, active);

  if (
    !contextId ||
    overview.status === "pending" ||
    (overview.status === "ready" && overview.coverage.scope !== "full_video")
  ) {
    return (
      <LearningPanelState
        description="영상 전체 자막이 준비되면 시작부터 끝까지 고르게 정리합니다."
        title="영상 전체 내용을 준비하고 있어요"
      />
    );
  }

  if (overview.status === "failed" || !overview.summary) {
    const fullVideoUnavailable =
      overview.errorCode === "FULL_VIDEO_CAPTIONS_REQUIRED";
    return (
      <LearningPanelState
        description={
          fullVideoUnavailable
            ? "영상 전체 자막을 확인할 수 없어 초반 내용만으로 정리하지 않았어요."
            : "영상은 계속 볼 수 있어요. 학습 자막을 만든 뒤 다시 확인해 주세요."
        }
        title={
          fullVideoUnavailable
            ? "영상 전체를 정리할 수 없어요"
            : "내용을 정리하지 못했어요"
        }
      />
    );
  }

  return (
    <section className="learning-overview-panel">
      <header>
        <span>영상 전체 정리</span>
        <h2>내용 정리</h2>
      </header>
      <p className="overview-copy">{overview.summary.overview}</p>
      <div className="overview-chapters">
        {overview.summary.chapters.map((chapter) => (
          <article key={`${chapter.startSeconds}:${chapter.endSeconds}`}>
            <button type="button" onClick={() => onSeek(chapter.startSeconds)}>
              {formatTime(chapter.startSeconds)}
            </button>
            <div>
              <h3>{chapter.title}</h3>
              <p>{chapter.body}</p>
            </div>
          </article>
        ))}
      </div>
      {overview.summary.takeaways.length > 0 && (
        <section className="overview-takeaways">
          <h3>기억할 내용</h3>
          <ul>
            {overview.summary.takeaways.slice(0, 3).map((takeaway) => (
              <li key={takeaway}>{takeaway}</li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
