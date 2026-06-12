import type { CaptionResponse, CaptionSegment } from './types';

const FINAL_CAPTION_END_HOLD_SECONDS = 4;
const VIDEO_END_TOLERANCE_SECONDS = 0.75;

export type NativeYouTubeCaptionPlayer = {
  loadModule?: (module: string) => void;
  unloadModule?: (module: string) => void;
  setOption?: (module: string, option: string, value: unknown) => void;
};

export function disableNativeYouTubeCaptions(
  player: NativeYouTubeCaptionPlayer,
) {
  try {
    player.setOption?.('captions', 'track', {});
    player.setOption?.('captions', 'fontSize', -1);
    player.unloadModule?.('captions');
  } catch {
    // The custom overlay still follows the local caption toggle.
  }
}

function enableNativeYouTubeCaptions(
  player: NativeYouTubeCaptionPlayer,
  language: string,
) {
  try {
    player.loadModule?.('captions');
    player.setOption?.('captions', 'track', { languageCode: language });
    player.setOption?.('captions', 'fontSize', 0);
  } catch {
    // YouTube may not expose caption options until its iframe module is ready.
  }
}

export function syncNativeYouTubeCaptions({
  captionsEnabled,
  customCaptionsAvailable,
  language,
  player,
}: {
  captionsEnabled: boolean;
  customCaptionsAvailable: boolean;
  language: string;
  player: NativeYouTubeCaptionPlayer;
}) {
  if (
    !shouldUseNativeYouTubeCaptions({
      captionsEnabled,
      customCaptionsAvailable,
    })
  ) {
    disableNativeYouTubeCaptions(player);
    return;
  }

  enableNativeYouTubeCaptions(player, language);
}

export function shouldUseNativeYouTubeCaptions({
  captionsEnabled,
  customCaptionsAvailable,
  nativeFallbackAvailable = true,
}: {
  captionsEnabled: boolean;
  customCaptionsAvailable: boolean;
  nativeFallbackAvailable?: boolean;
}) {
  return captionsEnabled && nativeFallbackAvailable && !customCaptionsAvailable;
}

export function youtubeCaptionPlayerVars({
  captionsEnabled,
  customCaptionsAvailable,
  language,
}: {
  captionsEnabled: boolean;
  customCaptionsAvailable: boolean;
  language: string;
}): Record<string, string | number> {
  if (
    shouldUseNativeYouTubeCaptions({
      captionsEnabled,
      customCaptionsAvailable,
    })
  ) {
    return {
      cc_lang_pref: language,
      cc_load_policy: 1,
      hl: language,
    };
  }

  return {
    cc_load_policy: 0,
    hl: language,
  };
}

export function nativeYouTubeCaptionLanguage({
  fallbackLanguage,
  response,
}: {
  fallbackLanguage: string;
  response: CaptionResponse | null | undefined;
}) {
  const sourceLanguage = response?.sourceLanguage;

  if (
    response?.provider === 'youtube-native-captions' &&
    sourceLanguage &&
    !['unavailable', 'youtube'].includes(sourceLanguage)
  ) {
    return sourceLanguage;
  }

  return fallbackLanguage;
}

export function captionStatusText({
  captionError,
  captionLanguage,
  captionResponse,
  captionResponseMatchesVideo,
  captionsEnabled,
  hasCurrentVideo,
  hasLiveCaptionResponse,
  isCaptionLoading,
  shouldUseNativeCaptionFallback,
}: {
  captionError: string;
  captionLanguage: string;
  captionResponse: CaptionResponse | null | undefined;
  captionResponseMatchesVideo: boolean;
  captionsEnabled: boolean;
  hasCurrentVideo: boolean;
  hasLiveCaptionResponse: boolean;
  isCaptionLoading: boolean;
  shouldUseNativeCaptionFallback: boolean;
}) {
  if (!hasCurrentVideo) {
    return '';
  }

  if (!captionsEnabled) {
    return '자막 꺼짐';
  }

  if (isCaptionLoading) {
    return shouldUseNativeCaptionFallback
      ? 'YouTube 기본 자막 사용 중 · AI 번역 자막 생성 중'
      : 'AI 번역 자막 생성 중';
  }

  if (captionResponseMatchesVideo && captionResponse) {
    if (hasLiveCaptionResponse) {
      return `AI 번역 자막 · ${captionResponse.sourceLanguage} → ${captionResponse.language}`;
    }

    if (
      shouldUseNativeCaptionFallback &&
      ['youtube-native-captions', 'youtube-source-captions'].includes(
        captionResponse.provider,
      )
    ) {
      return `YouTube 기본 자막 사용 중 · ${captionResponse.sourceLanguage} 원문`;
    }

    if (shouldUseNativeCaptionFallback) {
      return 'YouTube 기본 자막 사용 중';
    }

    if (captionResponse.language !== captionLanguage) {
      return '선택한 언어 자막을 불러오는 중';
    }

    return captionError || captionUnavailableStatus(captionResponse.provider);
  }

  return (
    captionError ||
    (shouldUseNativeCaptionFallback
      ? 'YouTube 기본 자막 사용 중 · AI 번역 자막 불러오는 중'
      : '실시간 번역 자막 불러오는 중')
  );
}

function captionUnavailableStatus(provider: string) {
  if (provider === 'ai-service-unavailable') {
    return 'AI 자막 서비스 응답을 받지 못했습니다.';
  }

  if (provider === 'caption-source-unavailable') {
    return '실제 자막 데이터를 찾지 못했습니다.';
  }

  if (provider === 'caption-translation-unavailable') {
    return '원문 자막은 찾았지만 AI 번역 자막을 만들지 못했습니다.';
  }

  if (provider === 'youtube-caption-rate-limited') {
    return 'YouTube 자막 API가 429로 막혔습니다.';
  }

  if (provider === 'local-fallback') {
    return 'AI 번역 자막을 만들지 못했습니다.';
  }

  return 'YouTube 자막을 불러오지 못했습니다.';
}

export function hasDisplayableLiveCaptionResponse({
  captionLanguage,
  liveCaptionProviders,
  response,
}: {
  captionLanguage: string;
  liveCaptionProviders: ReadonlySet<string>;
  response: CaptionResponse | null | undefined;
}) {
  if (
    !response ||
    response.language !== captionLanguage ||
    response.segments.length === 0 ||
    !liveCaptionProviders.has(response.provider)
  ) {
    return false;
  }

  if (
    response.provider === 'youtube-source-captions' &&
    !response.translated &&
    response.sourceLanguage !== captionLanguage
  ) {
    return false;
  }

  return true;
}

export function selectActiveCaption({
  captionsEnabled,
  currentTime,
  holdLastCaption,
  segments,
  videoDuration,
}: {
  captionsEnabled: boolean;
  currentTime: number;
  holdLastCaption: boolean;
  segments: CaptionSegment[];
  videoDuration: number;
}) {
  if (!captionsEnabled || segments.length === 0) {
    return null;
  }

  const timedCaption =
    segments.findLast(
      (segment) => currentTime >= segment.start && currentTime < segment.end,
    ) ?? null;

  if (timedCaption) {
    return timedCaption;
  }

  const lastCaption = segments[segments.length - 1];

  if (!lastCaption || currentTime < lastCaption.end) {
    return null;
  }

  if (holdLastCaption) {
    return lastCaption;
  }

  if (
    videoDuration > 0 &&
    currentTime <= videoDuration + VIDEO_END_TOLERANCE_SECONDS &&
    videoDuration - lastCaption.end <= FINAL_CAPTION_END_HOLD_SECONDS
  ) {
    return lastCaption;
  }

  return null;
}
