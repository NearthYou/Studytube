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
    index_pending: "자막이 준비됐어요. 퀴즈를 만들고 있어요.",
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

export function quizPreparation(state: ProgressiveCaptionState) {
  return state.phase === "complete"
    ? { ready: true, message: "퀴즈를 시작할 수 있습니다." }
    : { ready: false, message: "퀴즈를 준비하고 있어요." };
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
      "YouTube 자막이 없어 영상 설명과 공개 정보로 학습 자료를 준비했어요.",
    STT_DISABLED:
      "YouTube 자막이 없어 영상 설명과 공개 정보로 학습 자료를 준비했어요.",
    VIDEO_LIVE_UNSUPPORTED: "실시간 영상은 아직 자막을 만들 수 없어요.",
    VIDEO_RESTRICTED: "이 영상에서는 자막을 만들 수 없어요.",
    VIDEO_AUTH_REQUIRED: "로그인이 필요한 영상이라 자막을 만들 수 없어요.",
    VIDEO_TOO_LONG: "처리할 수 있는 길이를 넘은 영상입니다.",
    CAPTION_PROVIDER_UNAVAILABLE:
      "YouTube 자막이 없어 영상 설명과 공개 정보로 학습 자료를 준비했어요.",
    TRANSCRIPTION_PROVIDER_UNAVAILABLE: "자막을 만들지 못했어요.",
    TRANSLATION_PROVIDER_UNAVAILABLE: "한국어로 옮기지 못했어요.",
  };
  return errorCode ? messages[errorCode] : undefined;
}
