export type QuizApiState =
  | "generating"
  | "ready"
  | "evaluated"
  | "failed"
  | "stale";

export type QuizApiSnapshot = {
  id: string;
  state: QuizApiState;
  questions: Array<{ id: string }>;
};

export type QuizUiPhase =
  | "request"
  | "generating"
  | "ready"
  | "answering"
  | "submitting"
  | "evaluated"
  | "failed"
  | "stale";

export type QuizUiState = {
  phase: QuizUiPhase;
  evidenceReady: boolean;
  loopId: string;
  result?: { score: number };
  message: string;
};

export type QuizUiEvent =
  | { type: "requested" }
  | { type: "answer_changed" }
  | { type: "submit_started" }
  | { type: "submit_succeeded"; result: { score: number } };

export function quizStateFromApi(
  snapshot: QuizApiSnapshot | null,
  evidenceReady: boolean,
): QuizUiState {
  if (!snapshot) {
    return {
      phase: "request",
      evidenceReady,
      loopId: "",
      message: evidenceReady
        ? "지금까지 본 구간으로 퀴즈를 만들 수 있습니다."
        : "퀴즈를 준비하고 있어요.",
    };
  }
  return {
    phase: snapshot.state,
    evidenceReady,
    loopId: snapshot.id,
    message: messageFor(snapshot.state),
  };
}

export function transitionQuizState(
  state: QuizUiState,
  event: QuizUiEvent,
): QuizUiState {
  if (event.type === "requested" && state.phase === "request") {
    return { ...state, phase: "generating", message: messageFor("generating") };
  }
  if (
    event.type === "answer_changed" &&
    ["ready", "answering"].includes(state.phase)
  ) {
    return { ...state, phase: "answering" };
  }
  if (event.type === "submit_started" && state.phase === "answering") {
    return {
      ...state,
      phase: "submitting",
      message: "답을 확인하고 있습니다.",
    };
  }
  if (event.type === "submit_succeeded" && state.phase === "submitting") {
    return {
      ...state,
      phase: "evaluated",
      result: event.result,
      message: messageFor("evaluated"),
    };
  }
  return state;
}

export function quizControls(state: QuizUiState) {
  return {
    request: state.phase === "request" && state.evidenceReady,
    answer: state.phase === "ready" || state.phase === "answering",
    submit: state.phase === "answering",
    retry: state.phase === "failed",
    regenerate: state.phase === "stale",
  };
}

export function shouldAutoRequestQuiz({
  active,
  contextId,
  evidenceReady,
  hasLoop,
  phase,
  requestedContextId,
}: {
  active: boolean;
  contextId: string;
  evidenceReady: boolean;
  hasLoop: boolean;
  phase: QuizUiPhase;
  requestedContextId: string;
}) {
  return (
    active &&
    Boolean(contextId) &&
    evidenceReady &&
    !hasLoop &&
    phase === "request" &&
    requestedContextId !== contextId
  );
}

function messageFor(state: QuizApiState): string {
  const messages: Record<QuizApiState, string> = {
    generating: "영상 전체 내용에서 문제를 만들고 있습니다.",
    ready: "문제가 준비되었습니다.",
    evaluated: "정답과 해설을 확인해보세요.",
    failed: "문제를 만들지 못했습니다. 다시 시도해주세요.",
    stale: "자막이 바뀌었습니다. 새 퀴즈를 만들어주세요.",
  };
  return messages[state];
}
