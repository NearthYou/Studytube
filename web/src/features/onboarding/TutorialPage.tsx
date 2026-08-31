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
      ? "저장된 추천 기준을 사용합니다."
      : "추천 기준을 정하면 다음 코스부터 반영됩니다.",
  );
  const [isSavingPreferences, setIsSavingPreferences] = useState(false);
  const tutorialSteps = [
    {
      number: "01",
      title: "유튜브 링크를 학습 자료로 바꿉니다",
      body: "등록 화면에 영상 링크를 넣으면 제목, 채널, 태그, 요약 노트가 자동으로 정리됩니다.",
    },
    {
      number: "02",
      title: "학습 순서를 이어서 제안합니다",
      body: "관심 주제를 입력하면 관련 영상을 묶어 작은 플레이리스트로 시작할 수 있습니다.",
    },
    {
      number: "03",
      title: "학습 화면에서 자막, 메모, 반복 구간을 조절합니다",
      body: "영상을 보며 중요한 지점을 마킹해 메모하고, 한국어/영어 자막과 재생 속도, 반복 구간을 함께 조절할 수 있습니다.",
    },
  ];
  const tutorialHighlights = [
    "처음에는 영상 하나만 등록해도 충분합니다.",
    "보드에 쌓인 영상은 코스와 학습 큐로 다시 이어집니다.",
    "내 정보에서 추천 기준을 바꾸면 다음 코스부터 반영됩니다.",
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
      setPreferenceStatus("배우고 싶은 분야와 원하는 결과를 입력해주세요.");
      return;
    }

    setIsSavingPreferences(true);
    setPreferenceStatus("추천 기준을 저장하는 중이에요.");

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
      setPreferenceStatus("추천 기준을 저장했어요.");
    } catch (error) {
      setPreferenceStatus(
        error instanceof Error
          ? error.message
          : "추천 기준을 저장하지 못했어요.",
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
          <h1>
            {session.user.name}님,
            <br />
            StudyTube는 영상을 공부 흐름으로 바꿉니다
          </h1>
          <p>
            링크를 모으는 곳에서 끝나지 않고, 요약과 코스 추천, 자막 기반
            학습까지 한 번에 이어가는 개인 학습 보드입니다.
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
            <strong>추천 기준 정하기</strong>
            <p>배우고 싶은 분야와 하루 학습량을 정합니다.</p>
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
              {isSavingPreferences ? "저장 중" : "기준 저장"}
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
