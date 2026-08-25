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

  if (!contextId || overview.status === "pending") {
    return (
      <LearningPanelState
        description="학습 자막이 준비되면 영상의 흐름과 주요 구간을 보여드릴게요."
        title="내용 정리를 준비하고 있어요"
      />
    );
  }

  if (overview.status === "failed" || !overview.summary) {
    return (
      <LearningPanelState
        description="영상은 계속 볼 수 있어요. 학습 자막을 만든 뒤 다시 확인해 주세요."
        title="내용을 정리하지 못했어요"
      />
    );
  }

  const scopeLabel =
    overview.coverage.scope === "study_range"
      ? `${formatTime(overview.coverage.startSeconds)}–${formatTime(overview.coverage.endSeconds)} 이번 학습 정리`
      : "영상 전체 정리";

  return (
    <section className="learning-overview-panel">
      <header>
        <span>{scopeLabel}</span>
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
