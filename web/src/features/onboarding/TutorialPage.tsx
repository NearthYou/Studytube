import { useState } from "react";
import type { FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { updateMe } from "../../api";
import {
  learningPreferencesFromDraft,
  paceForPreferenceSave,
} from "../../courseDiscovery";
import { tutorialNextDestination } from "../../onboarding";
import type { Session, User } from "../../types";
import { LearningPreferenceFields } from "../account/LearningPreferenceFields";

export function TutorialPage({
  session,
  onSessionUpdate,
}: {
  session: Session;
  onSessionUpdate: (user: User) => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const nextPath = tutorialNextDestination(
    typeof location.state === "object" &&
      location.state &&
      "next" in location.state
      ? location.state.next
      : undefined,
  );
  const [preferenceDraft, setPreferenceDraft] = useState(() => ({
    interests: session.user.preferences.interests.join(", "),
    pace: paceForPreferenceSave(session.user.preferences.pace),
    goal: session.user.preferences.goal,
  }));
  const [preferenceStatus, setPreferenceStatus] = useState("");
  const [isSavingPreferences, setIsSavingPreferences] = useState(false);

  function finishTutorial(destination: string) {
    navigate(destination, { replace: true });
  }

  async function saveTutorialPreferences(event: FormEvent) {
    event.preventDefault();

    if (isSavingPreferences) {
      return;
    }

    const nextPreferences = learningPreferencesFromDraft(preferenceDraft);

    if (
      nextPreferences.interests.length === 0 ||
      !nextPreferences.pace ||
      !nextPreferences.goal
    ) {
      setPreferenceStatus("세 항목을 모두 적어 주세요.");
      return;
    }

    setIsSavingPreferences(true);
    setPreferenceStatus("저장하고 있어요.");

    try {
      const nextUser = await updateMe({
        preferences: nextPreferences,
      });

      onSessionUpdate(nextUser);
      finishTutorial(nextPath);
    } catch {
      setPreferenceStatus("설정을 저장하지 못했어요. 다시 해 주세요.");
    } finally {
      setIsSavingPreferences(false);
    }
  }

  return (
    <main className="page-shell tutorial-page tutorial-simple">
      <section className="tutorial-setup">
        <header className="tutorial-heading">
          <h1>{session.user.name}님, 어떤 공부를 하고 싶나요?</h1>
          <p>배울 내용과 영상 길이를 알려주면 다음 영상을 고를 때 참고해요.</p>
        </header>

        <form
          className="tutorial-preference-form"
          onSubmit={saveTutorialPreferences}
        >
          <LearningPreferenceFields
            disabled={isSavingPreferences}
            draft={preferenceDraft}
            name="tutorial-daily-learning-time"
            onChange={setPreferenceDraft}
          />
          <p className="tutorial-status" aria-live="polite">
            {preferenceStatus}
          </p>
          <div className="tutorial-actions">
            <button type="submit" disabled={isSavingPreferences}>
              {isSavingPreferences ? "저장 중" : "저장하고 시작"}
            </button>
            <button
              className="quiet-button"
              type="button"
              disabled={isSavingPreferences}
              onClick={() => finishTutorial(nextPath)}
            >
              건너뛰기
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
