import { useEffect } from "react";
import { formatTime } from "../../videoSummaryDetails.ts";
import {
  captionPairAt,
  captionPhaseMessage,
  type ProgressiveCaptionState,
} from "./captionState.ts";

export function TranscriptDrawer({
  captions,
  onClose,
  onSeek,
  open,
}: {
  captions: ProgressiveCaptionState;
  onClose: () => void;
  onSeek: (seconds: number) => void;
  open: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) return null;
  const starts = Array.from(
    new Set(
      [...captions.sourceSegments, ...captions.koreanSegments].map(
        (segment) => segment.start,
      ),
    ),
  ).sort((left, right) => left - right);

  return (
    <div className="transcript-backdrop" role="presentation" onMouseDown={onClose}>
      <aside
        aria-label="전체 자막"
        aria-modal="true"
        className="transcript-drawer"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>전체 자막</span>
            <p>시간을 누르면 해당 장면으로 이동합니다.</p>
          </div>
          <button aria-label="전체 자막 닫기" type="button" onClick={onClose}>
            닫기
          </button>
        </header>
        {starts.length === 0 ? (
          <p className="transcript-empty">{captionPhaseMessage(captions)}</p>
        ) : (
          <ol className="learning-transcript">
            {starts.map((start) => {
              const pair = captionPairAt(captions, start + 0.001);
              return (
                <li key={start}>
                  <button type="button" onClick={() => onSeek(start)}>
                    {formatTime(start)}
                  </button>
                  <div>
                    {pair.source && <p>{pair.source}</p>}
                    <p lang="ko">{pair.korean || "번역을 준비하고 있어요."}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </aside>
    </div>
  );
}
