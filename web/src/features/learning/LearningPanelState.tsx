import type { RefObject } from "react";

export function LearningPanelState({
  actionDisabled = false,
  actionLabel = "",
  description,
  onAction,
  statusRef,
  title,
}: {
  actionDisabled?: boolean;
  actionLabel?: string;
  description: string;
  onAction?: () => void;
  statusRef?: RefObject<HTMLDivElement | null>;
  title: string;
}) {
  return (
    <div
      aria-live="polite"
      className="learning-panel-state"
      ref={statusRef}
      tabIndex={statusRef ? -1 : undefined}
    >
      <strong>{title}</strong>
      <p>{description}</p>
      {actionLabel && onAction && (
        <button disabled={actionDisabled} type="button" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
