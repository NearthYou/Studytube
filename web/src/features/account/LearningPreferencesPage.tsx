import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { updateMe } from "../../api";
import {
  learningPreferencesFromDraft,
  paceForPreferenceSave,
} from "../../courseDiscovery";
import type { Session, User } from "../../types";
import { clearCourseRecommendation } from "../course/courseRecommendationStorage";
import {
  LearningPreferenceFields,
  type LearningPreferenceDraft,
} from "./LearningPreferenceFields";

export function LearningPreferencesPage({
  session,
  onSessionUpdate,
}: {
  session: Session;
  onSessionUpdate: (user: User) => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const returnTo = safeReturnPath(location.state);
  const [draft, setDraft] = useState<LearningPreferenceDraft>(() => ({
    interests: session.user.preferences.interests.join(", "),
    pace: paceForPreferenceSave(session.user.preferences.pace),
    goal: session.user.preferences.goal,
  }));
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (isSaving) return;

    const preferences = learningPreferencesFromDraft(draft);
    if (preferences.interests.length === 0) {
      setStatus("배우고 싶은 분야를 하나 이상 입력해주세요.");
      return;
    }
    if (!preferences.goal) {
      setStatus("원하는 학습 결과를 입력해주세요.");
      return;
    }

    setIsSaving(true);
    setStatus("저장하고 있어요.");
    try {
      const nextUser = await updateMe({
        preferences,
      });
      clearCourseRecommendation();
      onSessionUpdate(nextUser);
      navigate(returnTo, { replace: true });
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "추천 기준을 저장하지 못했어요.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="page-shell profile-page learning-preferences-page">
      <header className="learning-preferences-heading">
        <div>
          <h1>추천 기준 수정</h1>
          <p>코스의 주제와 하루 학습량을 고를 때 반영합니다.</p>
        </div>
        <Link to={returnTo}>취소</Link>
      </header>
      <form className="profile-form learning-preferences-form" onSubmit={submit}>
        <LearningPreferenceFields
          disabled={isSaving}
          draft={draft}
          name="daily-learning-time"
          onChange={setDraft}
        />
        <div className="learning-preference-actions">
          <p aria-live="polite">{status}</p>
          <button disabled={isSaving} type="submit">
            {isSaving ? "저장 중" : "저장하고 돌아가기"}
          </button>
        </div>
      </form>
    </main>
  );
}

function safeReturnPath(state: unknown) {
  if (
    state &&
    typeof state === "object" &&
    "returnTo" in state &&
    (state.returnTo === "/courses/new" || state.returnTo === "/me")
  ) {
    return state.returnTo;
  }
  return "/me";
}
