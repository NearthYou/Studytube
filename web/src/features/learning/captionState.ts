import { mergeCaptionSegments, selectActiveCaption } from "../../captions.ts";
import type { CaptionSegment } from "../../types.ts";

export type CaptionPhase =
  | "source_pending"
  | "transcription_pending"
  | "translation_pending"
  | "index_pending"
  | "partial"
  | "failed"
  | "complete";

export type ProgressiveCaptionState = {
  generation: number;
  phase: CaptionPhase;
  sourceLanguage: string;
  sourceSegments: CaptionSegment[];
  koreanSegments: CaptionSegment[];
  stale: boolean;
  errorMessage?: string;
  errorCode?: string;
};

export const EMPTY_CAPTION_STATE: ProgressiveCaptionState = {
  generation: 0,
  phase: "source_pending",
  sourceLanguage: "",
  sourceSegments: [],
  koreanSegments: [],
  stale: false,
};

export function mergeCaptionState(
  current: ProgressiveCaptionState,
  next: ProgressiveCaptionState,
): ProgressiveCaptionState {
  if (next.generation < current.generation) return current;

  const sameGeneration = next.generation === current.generation;
  return {
    ...next,
    sourceLanguage: next.sourceLanguage || current.sourceLanguage,
    sourceSegments: sameGeneration
      ? mergeCaptionSegments(current.sourceSegments, next.sourceSegments)
      : next.sourceSegments,
    koreanSegments: sameGeneration
      ? mergeCaptionSegments(current.koreanSegments, next.koreanSegments)
      : next.koreanSegments,
  };
}

export function captionPairAt(
  state: ProgressiveCaptionState,
  currentTime: number,
) {
  const common = {
    captionsEnabled: true,
    currentTime,
    holdLastCaption: false,
    videoDuration: 0,
  };
  return {
    source:
      selectActiveCaption({ ...common, segments: state.sourceSegments })
        ?.text ?? "",
    korean:
      selectActiveCaption({ ...common, segments: state.koreanSegments })
        ?.text ?? "",
  };
}

export function captionPhaseMessage(state: ProgressiveCaptionState) {
  const messages: Record<CaptionPhase, string> = {
    source_pending: "자막을 확인하고 있어요.",
    transcription_pending: "자막을 만들고 있어요. 잠시만 기다려 주세요.",
    translation_pending: "한국어로 옮기고 있어요.",
    index_pending: "자막을 학습에 연결하고 있어요.",
    partial: "준비된 자막부터 보여드리고 있어요.",
    failed:
      state.errorMessage ||
      captionFailureMessage(state.errorCode) ||
      "자막을 만들지 못했어요. 다시 시도해 주세요.",
    complete: "자막이 모두 준비됐어요.",
  };
  return state.stale
    ? `이전 자막을 보여드리고 있어요. ${messages[state.phase]}`
    : messages[state.phase];
}

export function quizPreparation(
  state: ProgressiveCaptionState,
  currentTime = Number.POSITIVE_INFINITY,
) {
  const requiredSentences = 5;
  const watchedSentences = state.sourceSegments.filter(
    (segment) => segment.end <= currentTime,
  ).length;
  const captionsUsable = [
    "translation_pending",
    "index_pending",
    "partial",
    "complete",
  ].includes(state.phase);

  if (state.sourceSegments.length === 0) {
    return {
      ready: false,
      needsCaptions: true,
      message: "학습 자막을 먼저 준비해주세요.",
    };
  }

  if (captionsUsable && watchedSentences >= requiredSentences) {
    return {
      ready: true,
      needsCaptions: false,
      message: "퀴즈를 시작할 수 있습니다.",
    };
  }

  const remaining = Math.max(0, requiredSentences - watchedSentences);
  return {
    ready: false,
    needsCaptions: false,
    message: `지금 ${Math.min(watchedSentences, requiredSentences)}/${requiredSentences}문장을 봤어요. ${remaining}문장 더 보면 퀴즈가 열려요.`,
  };
}

export function needsInitialCaptionRepair(state: ProgressiveCaptionState) {
  if (
    state.sourceSegments.length === 0 ||
    ["source_pending", "transcription_pending", "translation_pending", "failed"].includes(
      state.phase,
    )
  ) {
    return false;
  }
  return Math.min(...state.sourceSegments.map((segment) => segment.start)) > 5;
}

export function isTranslationUnavailable(state: ProgressiveCaptionState) {
  return state.errorCode === "TRANSLATION_PROVIDER_UNAVAILABLE";
}

export function canRetryCaptions(errorCode?: string) {
  return ![
    "CAPTION_PROVIDER_UNAVAILABLE",
    "STT_DISABLED",
    "STT_NOT_APPROVED",
    "VIDEO_LIVE_UNSUPPORTED",
    "VIDEO_RESTRICTED",
    "VIDEO_AUTH_REQUIRED",
    "VIDEO_TOO_LONG",
  ].includes(errorCode ?? "");
}

function captionFailureMessage(errorCode?: string) {
  const messages: Record<string, string> = {
    STT_NOT_APPROVED:
      "학습 자막을 자동으로 만들지 못했어요.",
    STT_DISABLED:
      "학습 자막을 자동으로 만들지 못했어요.",
    VIDEO_LIVE_UNSUPPORTED: "실시간 영상은 아직 자막을 만들 수 없어요.",
    VIDEO_RESTRICTED: "이 영상에서는 자막을 만들 수 없어요.",
    VIDEO_AUTH_REQUIRED: "로그인이 필요한 영상이라 자막을 만들 수 없어요.",
    VIDEO_TOO_LONG: "처리할 수 있는 길이를 넘은 영상입니다.",
    CAPTION_PROVIDER_UNAVAILABLE:
      "학습 자막을 자동으로 만들지 못했어요.",
    TRANSCRIPTION_PROVIDER_UNAVAILABLE: "학습 자막을 만들지 못했어요.",
    TRANSLATION_PROVIDER_UNAVAILABLE: "한국어로 옮기지 못했어요.",
  };
  return errorCode ? messages[errorCode] : undefined;
}
