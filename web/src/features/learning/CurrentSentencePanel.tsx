import { useState } from "react";
import { explainLearningSegment } from "../../api.ts";
import type { SegmentExplanationResponse } from "../../types.ts";
import { formatTime } from "../../videoSummaryDetails.ts";
import type { CaptionlessPanelPresentation } from "./learningPanelPresentation.ts";
import { LearningPanelState } from "./LearningPanelState.tsx";

type Props = {
  contextId: string;
  currentTime: number;
  segmentStart: number;
  segmentEnd: number;
  sourceLanguage: string;
  source: string;
  korean: string;
  status: string;
  captionsReady: boolean;
  coverageRepairing: boolean;
  coverageCaptureActive: boolean;
  coverageStartsAt: number | null;
  emptyState: CaptionlessPanelPresentation;
  onEmptyAction: () => void;
  onOpenTranscript: () => void;
  onPause: () => void;
  onSave: () => void;
  onStartCoverageCapture: () => void;
  onRetryCaptions: () => void;
  retryingCaptions: boolean;
  translationUnavailable: boolean;
};

export function CurrentSentencePanel({
  contextId,
  currentTime,
  segmentStart,
  segmentEnd,
  sourceLanguage,
  source,
  korean,
  status,
  captionsReady,
  coverageRepairing,
  coverageCaptureActive,
  coverageStartsAt,
  emptyState,
  onEmptyAction,
  onOpenTranscript,
  onPause,
  onSave,
  onStartCoverageCapture,
  onRetryCaptions,
  retryingCaptions,
  translationUnavailable,
}: Props) {
  const [explanation, setExplanation] =
    useState<SegmentExplanationResponse | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function explain() {
    if (!contextId || !source || segmentEnd <= segmentStart) return;
    onPause();
    setLoading(true);
    setMessage("");
    try {
      setExplanation(
        await explainLearningSegment({
          contextId,
          startSeconds: segmentStart,
          endSeconds: segmentEnd,
        }),
      );
    } catch {
      setMessage("이 문장을 설명하지 못했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="current-sentence-panel">
      {!captionsReady ? (
        <LearningPanelState
          actionDisabled={emptyState.actionDisabled}
          actionLabel={emptyState.actionLabel}
          description={emptyState.description}
          onAction={emptyState.action ? onEmptyAction : undefined}
          title={emptyState.title}
        />
      ) : (
        <>
          <header>
            <div>
              <span>지금 듣는 문장</span>
              <time>{formatTime(currentTime)}</time>
            </div>
            <button className="quiet-action" type="button" onClick={onOpenTranscript}>
              전체 자막
            </button>
          </header>

          {source ? (
            <>
              <div className="sentence-copy">
                <small>{sourceLanguage ? `원문 ${sourceLanguage}` : "원문"}</small>
                <p lang={sourceLanguage || undefined}>{source}</p>
              </div>
              <div className="sentence-copy translated">
                <small>한국어</small>
                <p lang="ko">
                  {korean ||
                    (translationUnavailable
                      ? "한국어 번역을 준비하지 못했어요."
                      : "번역을 준비하고 있어요.")}
                </p>
              </div>

              <p className="sentence-status" aria-live="polite">
                {status}
              </p>
              {translationUnavailable && (
                <button
                  className="quiet-action"
                  disabled={retryingCaptions}
                  type="button"
                  onClick={onRetryCaptions}
                >
                  {retryingCaptions ? "한국어 준비 중" : "한국어 다시 준비"}
                </button>
              )}
              <div className="sentence-actions">
                <button type="button" onClick={onSave}>
                  이 문장 저장
                </button>
                <button
                  className="secondary-action"
                  disabled={loading}
                  type="button"
                  onClick={() => void explain()}
                >
                  {loading ? "설명하는 중" : "문장 이해하기"}
                </button>
              </div>
            </>
          ) : (
            <LearningPanelState
              actionDisabled={coverageCaptureActive}
              actionLabel={
                coverageStartsAt !== null && currentTime < coverageStartsAt
                  ? coverageCaptureActive
                    ? "자막 만드는 중"
                    : "처음부터 자막 시작"
                  : ""
              }
              description={
                coverageRepairing
                  ? "영상은 계속 볼 수 있어요. 바로 필요하면 처음부터 자막을 시작할 수 있어요."
                  : "이 구간의 자막을 확인하고 있어요. 준비되면 바로 표시할게요."
              }
              onAction={
                coverageStartsAt !== null && currentTime < coverageStartsAt
                  ? onStartCoverageCapture
                  : undefined
              }
              title={
                coverageStartsAt !== null && currentTime < coverageStartsAt
                  ? "앞부분 자막을 준비하고 있어요"
                  : "이 구간의 자막을 준비하고 있어요"
              }
            />
          )}
        </>
      )}

      {captionsReady && explanation && (
        <div className="sentence-explanation" aria-live="polite">
          <p>{explanation.plainMeaning}</p>
          {explanation.keyExpressions.length > 0 && (
            <dl>
              {explanation.keyExpressions.map((expression) => (
                <div key={expression.text}>
                  <dt>{expression.text}</dt>
                  <dd>{expression.meaning}</dd>
                </div>
              ))}
            </dl>
          )}
          {explanation.contextNote && <p>{explanation.contextNote}</p>}
        </div>
      )}
      {captionsReady && message && <p className="sentence-status">{message}</p>}
    </section>
  );
}
