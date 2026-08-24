import { useState } from "react";
import { explainLearningSegment } from "../../api.ts";
import type { SegmentExplanationResponse } from "../../types.ts";
import { formatTime } from "../../videoSummaryDetails.ts";

type Props = {
  contextId: string;
  currentTime: number;
  segmentStart: number;
  segmentEnd: number;
  sourceLanguage: string;
  source: string;
  korean: string;
  status: string;
  onOpenTranscript: () => void;
  onSave: () => void;
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
  onOpenTranscript,
  onSave,
}: Props) {
  const [explanation, setExplanation] =
    useState<SegmentExplanationResponse | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function explain() {
    if (!contextId || !source || segmentEnd <= segmentStart) return;
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
      <header>
        <div>
          <span>지금 듣는 문장</span>
          <time>{formatTime(currentTime)}</time>
        </div>
        <button className="quiet-action" type="button" onClick={onOpenTranscript}>
          전체 자막 보기
        </button>
      </header>

      <div className="sentence-copy">
        <small>{sourceLanguage ? `원문 ${sourceLanguage}` : "원문"}</small>
        <p lang={sourceLanguage || undefined}>
          {source || "자막을 준비하고 있어요."}
        </p>
      </div>
      <div className="sentence-copy translated">
        <small>한국어</small>
        <p lang="ko">{korean || "번역을 준비하고 있어요."}</p>
      </div>

      <p className="sentence-status" aria-live="polite">
        {status}
      </p>
      <div className="sentence-actions">
        <button type="button" onClick={onSave}>
          이 문장 저장
        </button>
        <button
          className="secondary-action"
          disabled={!source || loading}
          type="button"
          onClick={() => void explain()}
        >
          {loading ? "설명하는 중" : "이 문장 이해하기"}
        </button>
      </div>

      {explanation && (
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
      {message && <p className="sentence-status">{message}</p>}
    </section>
  );
}
