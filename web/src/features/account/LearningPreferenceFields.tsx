import {
  LEARNING_TIME_LIMITS,
  learningTimeMinutes,
  normalizeLearningPace,
} from "../../courseDiscovery";
import "./LearningPreferences.css";

export type LearningPreferenceDraft = {
  interests: string;
  pace: string;
  goal: string;
};

export function LearningPreferenceFields({
  disabled,
  draft,
  name,
  onChange,
}: {
  disabled: boolean;
  draft: LearningPreferenceDraft;
  name: string;
  onChange: (draft: LearningPreferenceDraft) => void;
}) {
  const selectedMinutes = learningTimeMinutes(draft.pace);
  const directInput = /^\d{0,3}$/.test(draft.pace.trim())
    ? draft.pace.trim()
    : null;
  const timeInputValue = directInput ?? selectedMinutes?.toString() ?? "";
  const normalizedTime = normalizeLearningPace(draft.pace);
  const legacyTime =
    normalizedTime && selectedMinutes === null && directInput === null
      ? normalizedTime
      : "";

  return (
    <div className="learning-preference-fields">
      <label>
        <span>배우고 싶은 분야</span>
        <small>이 내용과 가까운 영상을 먼저 찾아요.</small>
        <input
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...draft, interests: event.target.value })
          }
          placeholder="예: React, 영어 회화"
          value={draft.interests}
        />
      </label>
      <label>
        <span>한 번에 볼 시간</span>
        <small>이 시간 안팎의 영상을 먼저 보여줘요.</small>
        <div className="learning-time-control">
          <input
            aria-label="한 번에 볼 시간"
            disabled={disabled}
            inputMode="numeric"
            max={LEARNING_TIME_LIMITS.max}
            min={LEARNING_TIME_LIMITS.min}
            name={name}
            onChange={(event) =>
              onChange({ ...draft, pace: event.target.value })
            }
            required={!legacyTime}
            step={LEARNING_TIME_LIMITS.step}
            type="number"
            value={timeInputValue}
          />
          <span aria-hidden="true">분</span>
        </div>
        {legacyTime && (
          <small className="legacy-learning-time">
            지금 설정: {legacyTime}
          </small>
        )}
      </label>
      <label>
        <span>어떻게 배우고 싶나요?</span>
        <small>입문, 실습, 복습 중 어떤 영상을 먼저 고를지 참고해요.</small>
        <textarea
          disabled={disabled}
          onChange={(event) => onChange({ ...draft, goal: event.target.value })}
          placeholder="예: 기초부터 따라 하며 작은 프로젝트 완성"
          value={draft.goal}
        />
      </label>
    </div>
  );
}
