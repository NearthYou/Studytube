import { useState, type RefObject } from "react";
import type {
  AdaptiveQuizLoop,
  AdaptiveQuizSubmission,
} from "../../api.ts";
import { formatTime } from "../../videoSummaryDetails.ts";
import type { QuizUiState } from "./adaptiveQuizFlow.ts";
import { quizPanelPresentation } from "./learningPanelPresentation.ts";
import { LearningPanelState } from "./LearningPanelState.tsx";
import { quizPage } from "./quizPresentation.ts";

export function AdaptiveQuizPanel({
  answers,
  canPrepareCaptions,
  loop,
  onAnswer,
  onPrepareCaptions,
  onRequest,
  onSeek,
  onSubmit,
  state,
  statusRef,
  submission,
}: {
  answers: Record<string, number>;
  canPrepareCaptions: boolean;
  loop: AdaptiveQuizLoop | null;
  onAnswer: (questionId: string, choiceIndex: number) => void;
  onPrepareCaptions: () => void;
  onRequest: () => void;
  onSeek: (seconds: number) => void;
  onSubmit: () => void;
  state: QuizUiState;
  statusRef: RefObject<HTMLDivElement | null>;
  submission: AdaptiveQuizSubmission | null;
}) {
  const [questionIndex, setQuestionIndex] = useState(0);

  if (["request", "generating", "failed", "stale"].includes(state.phase)) {
    const presentation = quizPanelPresentation(state, canPrepareCaptions);
    const action =
      state.phase === "request" && !state.evidenceReady && canPrepareCaptions
        ? onPrepareCaptions
        : onRequest;
    return (
      <LearningPanelState
        actionLabel={presentation.actionLabel}
        description={presentation.description}
        onAction={presentation.actionLabel ? action : undefined}
        statusRef={statusRef}
        title={presentation.title}
      />
    );
  }

  const page = quizPage(loop?.questions ?? [], questionIndex);
  const question = page.question;
  if (!question) {
    return (
      <LearningPanelState
        actionLabel="다시 만들기"
        description="문제를 불러오지 못했어요. 잠시 후 다시 만들어 주세요."
        onAction={onRequest}
        statusRef={statusRef}
        title="퀴즈를 열지 못했어요"
      />
    );
  }

  const evaluated = submission?.attempt.answers.find(
    (answer) => answer.questionId === question.id,
  );
  const selectedChoice = answers[question.id];
  const locked = state.phase === "submitting" || state.phase === "evaluated";

  function moveNext() {
    if (page.isLast) {
      onSubmit();
      return;
    }
    setQuestionIndex((current) => current + 1);
  }

  return (
    <section className="adaptive-quiz-panel">
      <header className="quiz-header">
        <div>
          <span>이번 학습 확인</span>
          <h2>내용을 얼마나 이해했나요?</h2>
        </div>
        <span className="quiz-progress" aria-label={`${page.total}문제 중 ${page.position}번째`}>
          {page.position} / {page.total}
        </span>
      </header>

      {state.phase === "evaluated" && submission && (
        <div className="quiz-score" ref={statusRef} tabIndex={-1}>
          <span>결과</span>
          <strong>{submission.attempt.score}점</strong>
        </div>
      )}

      <fieldset className="quiz-question-card">
        <legend>{question.prompt}</legend>
        <div className="quiz-choice-list">
          {question.choices.map((choice, index) => {
            const selected = selectedChoice === index;
            const correct = evaluated?.correctChoiceIndex === index;
            const incorrect = Boolean(evaluated && selected && !correct);
            return (
              <label
                className={[
                  "quiz-choice",
                  selected ? "is-selected" : "",
                  correct ? "is-correct" : "",
                  incorrect ? "is-incorrect" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                key={`${question.id}-${index}`}
              >
                <input
                  className="quiz-choice-input"
                  checked={selected}
                  disabled={locked}
                  name={question.id}
                  onChange={() => onAnswer(question.id, index)}
                  type="radio"
                />
                <span className="quiz-choice-indicator" aria-hidden="true">
                  {String.fromCharCode(65 + index)}
                </span>
                <span>{choice}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {evaluated && (
        <div className={`quiz-feedback ${evaluated.correct ? "is-correct" : "is-incorrect"}`}>
          <strong>{evaluated.correct ? "잘 이해했어요" : "이 부분은 다시 확인해 보세요"}</strong>
          <p>{evaluated.explanation}</p>
          <button type="button" onClick={() => onSeek(evaluated.citation.startSeconds)}>
            관련 장면 {formatTime(evaluated.citation.startSeconds)}
          </button>
        </div>
      )}

      <footer className="quiz-actions">
        <button
          className="quiet-button"
          disabled={page.isFirst}
          type="button"
          onClick={() => setQuestionIndex((current) => Math.max(0, current - 1))}
        >
          이전
        </button>
        {state.phase !== "evaluated" && (
          <button
            disabled={selectedChoice === undefined || state.phase === "submitting"}
            type="button"
            onClick={moveNext}
          >
            {state.phase === "submitting"
              ? "답을 확인하는 중"
              : page.isLast
                ? "답 확인하기"
                : "다음 문제"}
          </button>
        )}
        {state.phase === "evaluated" && !page.isLast && (
          <button type="button" onClick={() => setQuestionIndex((current) => current + 1)}>
            다음 문제
          </button>
        )}
      </footer>
    </section>
  );
}
