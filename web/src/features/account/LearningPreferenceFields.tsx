import {
  DAILY_LEARNING_TIME_OPTIONS,
  learningTimeSelection,
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
  const selectedTime = learningTimeSelection(draft.pace);
  const normalizedTime = normalizeLearningPace(draft.pace);
  const legacyTime = normalizedTime && !selectedTime ? normalizedTime : "";

  return (
    <div className="learning-preference-fields">
      <label>
        <span>배우고 싶은 분야</span>
        <input
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...draft, interests: event.target.value })
          }
          placeholder="예: React, 영어 회화"
          value={draft.interests}
        />
      </label>
      <fieldset>
        <legend>하루 학습 시간</legend>
        {legacyTime && (
          <p className="legacy-learning-time">현재 입력: {legacyTime}</p>
        )}
        <div className="learning-time-options">
          {DAILY_LEARNING_TIME_OPTIONS.map((option) => (
            <label key={option.value}>
              <input
                checked={selectedTime === option.value}
                disabled={disabled}
                name={name}
                onChange={() => onChange({ ...draft, pace: option.value })}
                type="radio"
                value={option.value}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label>
        <span>원하는 학습 결과</span>
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
