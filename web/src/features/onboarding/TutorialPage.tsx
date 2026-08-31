import { useState } from "react";
import type { FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { updateMe } from "../../api";
import {
  hasLearningPreferences,
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
  const nextLabel = "가던 곳으로 계속";
  const [preferenceDraft, setPreferenceDraft] = useState(() => ({
    interests: session.user.preferences.interests.join(", "),
    pace: paceForPreferenceSave(session.user.preferences.pace),
    goal: session.user.preferences.goal,
  }));
  const [preferenceStatus, setPreferenceStatus] = useState(
    hasLearningPreferences(session.user.preferences)
      ? "저장한 설정으로 코스를 추천해요."
      : "원하는 방식에 맞춰 코스를 추천해드릴게요.",
  );
  const [isSavingPreferences, setIsSavingPreferences] = useState(false);
  const tutorialSteps = [
    {
      number: "01",
      title: "유튜브 링크 하나로 시작해요",
      body: "링크를 넣으면 제목과 채널을 확인하고 바로 학습 화면을 열어요.",
    },
    {
      number: "02",
      title: "다음에 볼 영상을 골라드려요",
      body: "관심 주제를 적으면 관련 영상 2~4개를 순서대로 모아드려요.",
    },
    {
      number: "03",
      title: "자막과 메모를 영상 옆에서 바로 써요",
      body: "중요한 순간을 저장하고 자막, 재생 속도, 반복 구간을 한곳에서 조절해요.",
    },
  ];
  const tutorialHighlights = [
    "영상 하나로 시작해도 괜찮아요.",
    "본 영상은 기록에 남아 언제든 이어볼 수 있어요.",
    "코스 추천 설정을 바꾸면 다음 코스부터 달라져요.",
  ];
  const tutorialPreviewItems = [
    {
      label: "등록",
      title: "링크 분석",
      meta: "요약 / 태그 / 노트",
    },
    {
      label: "코스",
      title: "학습 추천",
      meta: "관심사 기반 큐",
    },
    {
      label: "학습",
      title: "마킹 메모",
      meta: "자막 / 반복 구간",
    },
  ];

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
      setPreferenceStatus("배우고 싶은 분야와 방식을 적어 주세요.");
      return;
    }

    setIsSavingPreferences(true);
    setPreferenceStatus("저장하고 있어요.");

    try {
      const nextUser = await updateMe({
        preferences: nextPreferences,
      });

      onSessionUpdate(nextUser);
      setPreferenceDraft({
        interests: nextUser.preferences.interests.join(", "),
        pace: paceForPreferenceSave(nextUser.preferences.pace),
        goal: nextUser.preferences.goal,
      });
      setPreferenceStatus("저장했어요.");
    } catch (error) {
      setPreferenceStatus(
        error instanceof Error
          ? error.message
          : "추천 설정을 저장하지 못했어요.",
      );
    } finally {
      setIsSavingPreferences(false);
    }
  }

  return (
    <main className="page-shell tutorial-page">
      <section className="tutorial-hero">
        <div className="tutorial-copy">
          <p className="eyebrow">첫 시작</p>
          <h1>{session.user.name}님, 영상 하나로 공부를 시작해 보세요</h1>
          <p>
            놓친 문장은 바로 확인하고, 기억할 내용은 저장하고, 다음 영상까지
            이어서 볼 수 있어요.
          </p>
          <div className="tutorial-actions">
            <button type="button" onClick={() => finishTutorial("/")}>
              첫 영상 등록
            </button>
            <button type="button" onClick={() => finishTutorial("/courses/new")}>
              추천 영상 보기
            </button>
            <button
              className="quiet-button"
              type="button"
              onClick={() => finishTutorial(nextPath)}
            >
              {nextLabel}
            </button>
          </div>
        </div>

        <aside
          className="tutorial-preview"
          aria-label="StudyTube 핵심 흐름 미리보기"
        >
          <div className="tutorial-preview-topbar">
            <span>StudyTube</span>
            <strong>01</strong>
          </div>
          <div className="tutorial-preview-main">
            <div className="tutorial-preview-card">
              <small>현재 흐름</small>
              <strong>영상 하나가 학습 코스로 바뀝니다</strong>
              <div className="tutorial-preview-bars" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            </div>
            <nav className="tutorial-preview-menu" aria-label="튜토리얼 단계">
              {tutorialPreviewItems.map((item) => (
                <span key={item.label}>
                  <b>{item.label}</b>
                  <strong>{item.title}</strong>
                  <small>{item.meta}</small>
                </span>
              ))}
            </nav>
          </div>
        </aside>
      </section>

      <form
        className="profile-form tutorial-preference-form"
        onSubmit={saveTutorialPreferences}
      >
        <section className="profile-form-section preference-section tutorial-preferences">
          <div>
            <strong>코스 추천 맞추기</strong>
            <p>분야와 시간, 배우는 방식에 맞춰 영상을 골라요.</p>
          </div>
          <LearningPreferenceFields
            disabled={isSavingPreferences}
            draft={preferenceDraft}
            name="tutorial-daily-learning-time"
            onChange={setPreferenceDraft}
          />
          <div className="section-title compact-title">
            <span>{preferenceStatus}</span>
            <button type="submit" disabled={isSavingPreferences}>
              {isSavingPreferences ? "저장 중" : "저장"}
            </button>
          </div>
        </section>
      </form>

      <section className="tutorial-flow" aria-label="서비스 이용 흐름">
        {tutorialSteps.map((step) => (
          <article key={step.number}>
            <span>{step.number}</span>
            <h2>{step.title}</h2>
            <p>{step.body}</p>
          </article>
        ))}
      </section>

      <section className="tutorial-note">
        <div>
          <p className="eyebrow">오늘의 시작점</p>
          <h2>영상 하나를 등록하면 나머지는 이어집니다</h2>
        </div>
        <ul>
          {tutorialHighlights.map((highlight) => (
            <li key={highlight}>{highlight}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
