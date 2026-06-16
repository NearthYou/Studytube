import type { CaptionResponse, CaptionSegment } from './types';

const FINAL_CAPTION_END_HOLD_SECONDS = 4;
const VIDEO_END_TOLERANCE_SECONDS = 0.75;
const MIN_CAPTION_DISPLAY_CHARS = 24;
const MAX_CAPTION_DISPLAY_CHARS = 48;
const CAPTION_DISPLAY_CHARS_PER_SECOND = 12;
const SOURCE_CAPTION_TRANSLATION_INITIAL_POLL_MS = 1200;
const SOURCE_CAPTION_TRANSLATION_POLL_MS = 2500;
export const CAPTION_TRANSLATION_WINDOW_SECONDS = 60;
const DANGLING_CAPTION_END_WORDS = new Set([
  'a',
  'an',
  'and',
  'for',
  'from',
  'in',
  'of',
  'or',
  'the',
  'to',
  'with',
  '그리고',
  '또는',
  '및',
]);

export function sourceCaptionTranslationPollDelay(attempts: number) {
  return attempts <= 0
    ? SOURCE_CAPTION_TRANSLATION_INITIAL_POLL_MS
    : SOURCE_CAPTION_TRANSLATION_POLL_MS;
}

export function captionTranslationWindow(
  currentTime: number,
  windowSeconds = CAPTION_TRANSLATION_WINDOW_SECONDS,
) {
  const safeWindowSeconds = Math.max(1, windowSeconds);
  const startSeconds =
    Math.floor(Math.max(0, currentTime) / safeWindowSeconds) *
    safeWindowSeconds;

  return {
    startSeconds,
    endSeconds: startSeconds + safeWindowSeconds,
  };
}

export function captionTranslationRequestKey({
  captionLanguage,
  videoId,
  window,
}: {
  captionLanguage: string;
  videoId: string;
  window: ReturnType<typeof captionTranslationWindow>;
}) {
  return [
    videoId,
    captionLanguage,
    window.startSeconds,
    window.endSeconds,
  ].join(':');
}

export function isSourceCaptionTranslationPending({
  captionLanguage,
  response,
}: {
  captionLanguage: string;
  response: CaptionResponse | null | undefined;
}) {
  return Boolean(
    response &&
      response.provider === 'youtube-source-captions' &&
      !response.translated &&
      response.language === captionLanguage &&
      response.sourceLanguage &&
      !['unavailable', 'youtube', captionLanguage].includes(
        response.sourceLanguage,
      ) &&
      response.segments.length > 0,
  );
}

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
    ['youtube-native-captions', 'youtube-source-captions'].includes(
      response?.provider ?? '',
    ) &&
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
    const sourceTranslationPending = isSourceCaptionTranslationPending({
      captionLanguage,
      response: captionResponse,
    });

    if (hasLiveCaptionResponse) {
      return `AI 번역 자막 · ${captionResponse.sourceLanguage} → ${captionResponse.language}`;
    }

    if (sourceTranslationPending) {
      return shouldUseNativeCaptionFallback
        ? 'YouTube 기본 자막 사용 중 · AI 번역 자막 생성 중'
        : 'AI 번역 자막 생성 중';
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

export function mergeTranslatedCaptionResponse(
  current: CaptionResponse | null,
  next: CaptionResponse,
): CaptionResponse {
  if (next.provider !== 'openai-caption-translation') {
    return current ?? next;
  }

  if (
    !current ||
    current.provider !== 'openai-caption-translation' ||
    current.videoId !== next.videoId ||
    current.language !== next.language
  ) {
    return next;
  }

  const segmentsByTime = new Map<string, CaptionSegment>();

  for (const segment of [...current.segments, ...next.segments]) {
    segmentsByTime.set(`${segment.start}:${segment.end}`, segment);
  }

  return {
    ...next,
    segments: Array.from(segmentsByTime.values()).sort(
      (left, right) => left.start - right.start || left.end - right.end,
    ),
  };
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
    return captionDisplayChunk(timedCaption, currentTime);
  }

  const lastCaption = segments[segments.length - 1];

  if (!lastCaption || currentTime < lastCaption.end) {
    return null;
  }

  if (holdLastCaption) {
    return captionDisplayChunk(lastCaption, currentTime);
  }

  if (
    videoDuration > 0 &&
    currentTime <= videoDuration + VIDEO_END_TOLERANCE_SECONDS &&
    videoDuration - lastCaption.end <= FINAL_CAPTION_END_HOLD_SECONDS
  ) {
    return captionDisplayChunk(lastCaption, currentTime);
  }

  return null;
}

function captionDisplayChunk(
  segment: CaptionSegment,
  currentTime: number,
): CaptionSegment {
  const duration = Math.max(0, segment.end - segment.start);
  const chunks = splitCaptionText(segment.text, duration);

  if (chunks.length <= 1) {
    return {
      ...segment,
      text: chunks[0] ?? segment.text,
    };
  }

  const weights = chunks.map(captionTextWeight);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const elapsed = Math.min(duration, Math.max(0, currentTime - segment.start));
  const progressWeight = duration > 0 ? (elapsed / duration) * totalWeight : 0;
  const chunkIndex = captionChunkIndex(weights, progressWeight);
  const weightBeforeChunk = weights
    .slice(0, chunkIndex)
    .reduce((sum, weight) => sum + weight, 0);
  const chunkStart =
    segment.start +
    (totalWeight > 0 ? (weightBeforeChunk / totalWeight) * duration : 0);
  const chunkEnd =
    chunkIndex === chunks.length - 1
      ? segment.end
      : segment.start +
        ((weightBeforeChunk + weights[chunkIndex]) / totalWeight) * duration;

  return {
    ...segment,
    start: Number(chunkStart.toFixed(3)),
    end: Number(chunkEnd.toFixed(3)),
    text: chunks[chunkIndex],
  };
}

function captionDisplayCharLimit(duration: number) {
  return Math.min(
    MAX_CAPTION_DISPLAY_CHARS,
    Math.max(
      MIN_CAPTION_DISPLAY_CHARS,
      Math.round(duration * CAPTION_DISPLAY_CHARS_PER_SECOND),
    ),
  );
}

function captionChunkIndex(weights: number[], progressWeight: number) {
  let cumulativeWeight = 0;

  for (let index = 0; index < weights.length; index += 1) {
    cumulativeWeight += weights[index];

    if (progressWeight < cumulativeWeight || index === weights.length - 1) {
      return index;
    }
  }

  return 0;
}

function captionTextWeight(text: string) {
  return Math.max(1, text.replace(/\s+/g, '').length);
}

function splitCaptionText(text: string, duration: number) {
  const normalizedText = text.replace(/\s+/g, ' ').trim();
  const displayLimit = captionDisplayCharLimit(duration);
  const hardLimit = Math.round(displayLimit * 1.25);

  if (!normalizedText || normalizedText.length <= displayLimit) {
    return normalizedText ? [normalizedText] : [];
  }

  const sentenceUnits = splitCaptionByBoundary(
    normalizedText,
    /[.!?。！？]+(?:["'”’)}\]]+)?/g,
  );
  const naturalUnits = sentenceUnits.flatMap((unit) =>
    unit.length > displayLimit
      ? splitOversizedCaptionUnit(unit, displayLimit, hardLimit)
      : [unit],
  );
  const chunks = mergeCaptionUnits(naturalUnits, displayLimit);

  return chunks.length > 0 ? chunks : [normalizedText];
}

function splitCaptionByBoundary(text: string, boundaryPattern: RegExp) {
  const units: string[] = [];
  let start = 0;

  for (const match of text.matchAll(boundaryPattern)) {
    const end = (match.index ?? 0) + match[0].length;
    const unit = text.slice(start, end).trim();

    if (unit) {
      units.push(unit);
    }

    start = end;
  }

  const tail = text.slice(start).trim();

  if (tail) {
    units.push(tail);
  }

  return units.length > 0 ? units : [text];
}

function splitOversizedCaptionUnit(
  text: string,
  displayLimit: number,
  hardLimit: number,
) {
  const phraseUnits = splitCaptionByBoundary(text, /[,;:，、]+/g);

  if (phraseUnits.length > 1) {
    return mergeCaptionUnits(phraseUnits, displayLimit).flatMap((chunk) =>
      chunk.length > hardLimit ? splitCaptionByWords(chunk, displayLimit) : [chunk],
    );
  }

  return splitCaptionByWords(text, displayLimit);
}

function mergeCaptionUnits(units: string[], displayLimit: number) {
  const chunks: string[] = [];
  let currentChunk = '';

  for (const unit of units) {
    const nextChunk = currentChunk ? `${currentChunk} ${unit}` : unit;

    if (!currentChunk || nextChunk.length <= displayLimit) {
      currentChunk = nextChunk;
      continue;
    }

    chunks.push(currentChunk);
    currentChunk = unit;
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

function splitCaptionByWords(text: string, displayLimit: number) {
  const chunks: string[] = [];
  let currentChunk = '';

  for (const word of text.split(' ')) {
    if (!word) {
      continue;
    }

    if (word.length > displayLimit) {
      if (currentChunk) {
        chunks.push(currentChunk);
        currentChunk = '';
      }

      for (let index = 0; index < word.length; index += displayLimit) {
        chunks.push(word.slice(index, index + displayLimit));
      }
      continue;
    }

    const nextChunk = currentChunk ? `${currentChunk} ${word}` : word;

    if (nextChunk.length <= displayLimit) {
      currentChunk = nextChunk;
      continue;
    }

    if (currentChunk) {
      const balanced = moveDanglingCaptionEndWord(currentChunk);

      if (balanced.chunk) {
        chunks.push(balanced.chunk);
      }

      currentChunk = balanced.danglingWord
        ? `${balanced.danglingWord} ${word}`
        : word;
      continue;
    }

    currentChunk = word;
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks.length > 0 ? chunks : [text];
}

function moveDanglingCaptionEndWord(text: string) {
  const words = text.split(' ');
  const lastWord = words.at(-1) ?? '';
  const normalizedLastWord = lastWord
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .toLowerCase();

  if (
    words.length <= 1 ||
    !DANGLING_CAPTION_END_WORDS.has(normalizedLastWord)
  ) {
    return { chunk: text, danglingWord: '' };
  }

  return {
    chunk: words.slice(0, -1).join(' '),
    danglingWord: lastWord,
  };
}
