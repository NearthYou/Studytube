import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchAdaptiveQuiz,
  requestAdaptiveQuiz,
  submitAdaptiveQuiz,
  type AdaptiveQuizLoop,
  type AdaptiveQuizSubmission,
} from "../../api.ts";
import {
  quizStateFromApi,
  shouldAutoRequestQuiz,
  transitionQuizState,
  type QuizUiState,
} from "./adaptiveQuizFlow.ts";

const MAX_QUIZ_POLLS = 10;

export function useAdaptiveQuiz({
  active,
  contextId,
  currentTime,
  evidenceMessage,
  evidenceReady,
}: {
  active: boolean;
  contextId: string;
  currentTime: number;
  evidenceMessage: string;
  evidenceReady: boolean;
}) {
  const [loop, setLoop] = useState<AdaptiveQuizLoop | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submission, setSubmission] = useState<AdaptiveQuizSubmission | null>(
    null,
  );
  const [state, setState] = useState<QuizUiState>(() => {
    const initial = quizStateFromApi(null, evidenceReady);
    return evidenceReady ? initial : { ...initial, message: evidenceMessage };
  });
  const statusRef = useRef<HTMLDivElement>(null);
  const evidenceReadyRef = useRef(evidenceReady);
  const currentTimeRef = useRef(currentTime);
  const autoRequestedContextRef = useRef("");
  const loopId = loop?.id;
  const loopState = loop?.state;

  useEffect(() => {
    evidenceReadyRef.current = evidenceReady;
  }, [evidenceReady]);

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  const request = useCallback(async () => {
    if (!contextId || !evidenceReadyRef.current) return;
    setSubmission(null);
    setAnswers({});
    setState((current) => transitionQuizState(current, { type: "requested" }));
    try {
      const next = await requestAdaptiveQuiz({
        contextId,
        startSeconds: 0,
        endSeconds: Math.max(1, Math.floor(currentTimeRef.current)),
        idempotencyKey: crypto.randomUUID(),
      });
      setLoop(next);
      setState(quizStateFromApi(next, true));
    } catch (error) {
      setState((current) => ({
        ...current,
        phase: "failed",
        message:
          error instanceof Error
            ? error.message
            : "퀴즈를 만들지 못했습니다. 다시 시도해주세요.",
      }));
    }
  }, [contextId]);

  useEffect(() => {
    if (!loop) {
      const initial = quizStateFromApi(null, evidenceReady);
      setState(
        evidenceReady ? initial : { ...initial, message: evidenceMessage },
      );
    }
  }, [evidenceMessage, evidenceReady, loop]);

  useEffect(() => {
    if (
      !shouldAutoRequestQuiz({
        active,
        contextId,
        evidenceReady,
        hasLoop: Boolean(loop),
        phase: state.phase,
        requestedContextId: autoRequestedContextRef.current,
      })
    ) {
      return;
    }
    autoRequestedContextRef.current = contextId;
    void request();
  }, [active, contextId, evidenceReady, loop, request, state.phase]);

  useEffect(() => {
    if (!loopId || loopState !== "generating") return;
    const activeLoopId = loopId;
    const controller = new AbortController();
    const { signal } = controller;

    async function pollQuiz() {
      if (!(await waitForPoll(500, signal))) return;
      for (let attempts = 0; attempts < MAX_QUIZ_POLLS; attempts += 1) {
        try {
          const next = await fetchAdaptiveQuiz(activeLoopId, { signal });
          if (signal.aborted) return;
          setLoop(next);
          setState(quizStateFromApi(next, evidenceReadyRef.current));
          if (next.state !== "generating") return;
          if (attempts + 1 >= MAX_QUIZ_POLLS) return;
          if (!(await waitForPoll(1_500, signal))) return;
        } catch {
          if (!signal.aborted) {
            setState((current) => ({
              ...current,
              phase: "failed",
              message: "퀴즈 상태를 확인하지 못했습니다. 다시 시도해주세요.",
            }));
          }
          return;
        }
      }
    }
    void pollQuiz();
    return () => controller.abort();
  }, [loopId, loopState]);

  useEffect(() => {
    if (["failed", "stale", "evaluated"].includes(state.phase)) {
      statusRef.current?.focus();
    }
  }, [state.phase]);

  function chooseAnswer(questionId: string, choiceIndex: number) {
    setAnswers((current) => ({ ...current, [questionId]: choiceIndex }));
    setState((current) =>
      transitionQuizState(current, { type: "answer_changed" }),
    );
  }

  async function submit() {
    if (!loop || loop.questions.length !== 5) return;
    const selectedAnswers = loop.questions.map((question) => ({
      questionId: question.id,
      selectedChoiceIndex: answers[question.id],
    }));
    if (
      selectedAnswers.some((answer) => answer.selectedChoiceIndex === undefined)
    ) {
      setState((current) => ({
        ...current,
        message: "모든 문제에 답해주세요.",
      }));
      return;
    }
    setState((current) =>
      transitionQuizState(current, { type: "submit_started" }),
    );
    try {
      const result = await submitAdaptiveQuiz({
        loopId: loop.id,
        idempotencyKey: crypto.randomUUID(),
        answers: selectedAnswers as Array<{
          questionId: string;
          selectedChoiceIndex: number;
        }>,
      });
      setSubmission(result);
      setState((current) =>
        transitionQuizState(current, {
          type: "submit_succeeded",
          result: { score: result.attempt.score },
        }),
      );
    } catch (error) {
      try {
        const latest = await fetchAdaptiveQuiz(loop.id);
        setLoop(latest);
        setState(quizStateFromApi(latest, evidenceReady));
      } catch {
        setState((current) => ({
          ...current,
          phase: "failed",
          message:
            error instanceof Error
              ? error.message
              : "답을 확인하지 못했습니다. 다시 시도해주세요.",
        }));
      }
    }
  }

  return {
    answers,
    chooseAnswer,
    loop,
    request,
    state,
    statusRef,
    submission,
    submit,
  };
}

function waitForPoll(delayMs: number, signal: AbortSignal) {
  return new Promise<boolean>((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve(true);
    }, delayMs);
    function stop() {
      window.clearTimeout(timeout);
      resolve(false);
    }
    signal.addEventListener("abort", stop, { once: true });
  });
}
