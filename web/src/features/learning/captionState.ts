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
    source_pending: "원문 자막 확인 중",
    transcription_pending: "원문 자막을 준비하고 있습니다.",
    translation_pending: "한국어 자막을 준비하고 있습니다.",
    index_pending: "자막은 준비됐고 문제 근거를 정리하고 있습니다.",
    partial: "준비된 구간부터 보여드리고 있습니다.",
    failed:
      state.errorMessage ||
      captionFailureMessage(state.errorCode) ||
      "자막을 준비하지 못했습니다. 잠시 후 다시 시도해주세요.",
    complete: "원문과 한국어 자막이 준비되었습니다.",
  };
  return state.stale
    ? `이전 자막 표시 중. ${messages[state.phase]}`
    : messages[state.phase];
}

export function quizPreparation(state: ProgressiveCaptionState) {
  return state.phase === "complete"
    ? { ready: true, message: "퀴즈를 시작할 수 있습니다." }
    : { ready: false, message: "문제 근거를 준비하고 있습니다." };
}

function captionFailureMessage(errorCode?: string) {
  const messages: Record<string, string> = {
    STT_NOT_APPROVED: "음성 자막 기능을 아직 사용할 수 없습니다.",
    STT_DISABLED: "음성 자막 기능이 잠시 중단되었습니다.",
    VIDEO_LIVE_UNSUPPORTED: "실시간 영상은 아직 자막을 준비할 수 없습니다.",
    VIDEO_RESTRICTED: "제한된 영상이라 자막을 준비할 수 없습니다.",
    VIDEO_AUTH_REQUIRED: "로그인이 필요한 영상이라 자막을 준비할 수 없습니다.",
    VIDEO_TOO_LONG: "처리할 수 있는 길이를 넘은 영상입니다.",
    CAPTION_PROVIDER_UNAVAILABLE: "원문 자막을 가져오지 못했습니다.",
    TRANSCRIPTION_PROVIDER_UNAVAILABLE: "음성에서 자막을 만들지 못했습니다.",
  };
  return errorCode ? messages[errorCode] : undefined;
}
