import type { QuizUiState } from "./adaptiveQuizFlow.ts";
import type { CaptionPhase } from "./captionState.ts";

export type CaptionPanelAction = "capture" | "retry" | "stop" | null;

export type CaptionlessPanelPresentation = {
  title: string;
  description: string;
  action: CaptionPanelAction;
  actionLabel: string;
  actionDisabled: boolean;
};

export type PanelPresentation = {
  title: string;
  description: string;
  actionLabel: string;
};

export function captionlessPanelPresentation({
  contextReady,
  liveActive,
  phase,
  retrying,
  retryable,
}: {
  contextReady: boolean;
  liveActive: boolean;
  phase: CaptionPhase;
  retrying: boolean;
  retryable: boolean;
}): CaptionlessPanelPresentation {
  if (liveActive) {
    return {
      title: "학습 자막을 만들고 있어요",
      description: "준비된 문장부터 이곳에 바로 보여드릴게요.",
      action: "stop",
      actionLabel: "그만 만들기",
      actionDisabled: false,
    };
  }

  if (!contextReady || phase !== "failed") {
    return {
      title: "학습 자막을 준비하고 있어요",
      description: "준비된 문장부터 이곳에 바로 보여드릴게요.",
      action: null,
      actionLabel: "",
      actionDisabled: false,
    };
  }

  if (retryable) {
    return {
      title: retrying
        ? "학습 자막을 다시 준비하고 있어요"
        : "학습 자막을 불러오지 못했어요",
      description: "잠시 후 다시 시도해 주세요.",
      action: "retry",
      actionLabel: retrying ? "다시 준비하는 중" : "다시 시도",
      actionDisabled: retrying,
    };
  }

  return {
    title: "학습 자막이 필요해요",
    description:
      "영상은 바로 볼 수 있어요. 문장 저장과 퀴즈를 쓰려면 학습 자막을 만들어 주세요.",
    action: "capture",
    actionLabel: "학습 자막 만들기",
    actionDisabled: false,
  };
}

export function quizPanelPresentation(state: QuizUiState): PanelPresentation {
  if (state.phase === "generating") {
    return {
      title: "퀴즈를 만들고 있어요",
      description: "준비되면 이 화면에 바로 보여드릴게요.",
      actionLabel: "",
    };
  }

  if (state.phase === "failed") {
    return {
      title: "퀴즈를 만들지 못했어요",
      description: "잠시 후 다시 시도해 주세요.",
      actionLabel: "다시 만들기",
    };
  }

  if (state.phase === "stale") {
    return {
      title: "자막이 바뀌어 퀴즈를 새로 만들어야 해요",
      description: "새 자막에 맞춰 문제를 다시 준비할게요.",
      actionLabel: "새로 만들기",
    };
  }

  if (state.evidenceReady) {
    return {
      title: "지금까지 본 내용을 확인해 볼까요?",
      description: "짧은 퀴즈로 놓친 부분을 확인할 수 있어요.",
      actionLabel: "퀴즈 만들기",
    };
  }

  return {
    title: "퀴즈는 자막이 준비되면 열려요",
    description:
      "학습 자막을 만든 뒤 지금까지 본 내용으로 문제를 만들 수 있어요.",
    actionLabel: "",
  };
}
