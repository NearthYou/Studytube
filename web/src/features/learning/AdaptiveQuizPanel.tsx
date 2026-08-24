import type { RefObject } from "react";
import type {
  AdaptiveQuizLoop,
  AdaptiveQuizSubmission,
} from "../../api.ts";
import { formatTime } from "../../videoSummaryDetails.ts";
import type { QuizUiState } from "./adaptiveQuizFlow.ts";

export function AdaptiveQuizPanel({
  answers,
  loop,
  onAnswer,
  onRequest,
  onSeek,
  onSubmit,
  state,
  statusRef,
  submission,
}: {
  answers: Record<string, number>;
  loop: AdaptiveQuizLoop | null;
  onAnswer: (questionId: string, choiceIndex: number) => void;
  onRequest: () => void;
  onSeek: (seconds: number) => void;
  onSubmit: () => void;
  state: QuizUiState;
  statusRef: RefObject<HTMLDivElement | null>;
  submission: AdaptiveQuizSubmission | null;
}) {
  if (["request", "generating", "failed", "stale"].includes(state.phase)) {
    return (
      <section className="learning-preparing-state">
        <h2>지금까지 퀴즈</h2>
        <div aria-live="polite" ref={statusRef} tabIndex={-1}>
          {state.message}
        </div>
        {state.phase === "generating" && (
          <span>완료되면 이 화면에 바로 표시됩니다.</span>
        )}
        {state.phase === "request" && state.evidenceReady && (
          <button type="button" onClick={onRequest}>
            퀴즈 시작
          </button>
        )}
        {state.phase === "request" && !state.evidenceReady && (
          <span>자막이 준비되면 퀴즈를 풀 수 있어요.</span>
        )}
        {(state.phase === "failed" || state.phase === "stale") && (
          <button type="button" onClick={onRequest}>
            새 퀴즈 준비하기
          </button>
        )}
      </section>
    );
  }

  return (
    <section className="adaptive-quiz-panel">
      <h2>지금까지 퀴즈</h2>
      {loop?.questions.map((question) => {
        const evaluated = submission?.attempt.answers.find(
          (answer) => answer.questionId === question.id,
        );
        return (
          <fieldset key={question.id}>
            <legend>{question.prompt}</legend>
            {question.choices.map((choice, index) => (
              <label key={choice}>
                <input
                  checked={answers[question.id] === index}
                  disabled={state.phase === "submitting" || state.phase === "evaluated"}
                  name={question.id}
                  onChange={() => onAnswer(question.id, index)}
                  type="radio"
                />
                {choice}
              </label>
            ))}
            {evaluated && (
              <div>
                <p>{evaluated.correct ? "정답입니다." : "이 부분을 다시 볼까요?"}</p>
                <p>{evaluated.explanation}</p>
                <button type="button" onClick={() => onSeek(evaluated.citation.startSeconds)}>
                  {formatTime(evaluated.citation.startSeconds)} 다시 보기
                </button>
              </div>
            )}
          </fieldset>
        );
      })}
      {(state.phase === "ready" || state.phase === "answering") && (
        <button disabled={state.phase !== "answering"} type="button" onClick={onSubmit}>
          답 확인하기
        </button>
      )}
      {state.phase === "submitting" && <p>답을 확인하고 있어요.</p>}
      {state.phase === "evaluated" && submission && (
        <div ref={statusRef} tabIndex={-1}>
          <p>점수 {submission.attempt.score}점</p>
          {submission.reviewProposal && (
            <button
              type="button"
              onClick={() => onSeek(submission.reviewProposal!.citation.startSeconds)}
            >
              복습할 장면 보기
            </button>
          )}
        </div>
      )}
    </section>
  );
}
