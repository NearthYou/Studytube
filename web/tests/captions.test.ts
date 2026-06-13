import assert from 'node:assert/strict';
import test from 'node:test';
import {
  captionStatusText,
  disableNativeYouTubeCaptions,
  hasDisplayableLiveCaptionResponse,
  nativeYouTubeCaptionLanguage,
  selectActiveCaption,
  shouldUseNativeYouTubeCaptions,
  syncNativeYouTubeCaptions,
  youtubeCaptionPlayerVars,
} from '../src/captions.ts';

test('keeps the final caption visible through the end of the video', () => {
  const caption = selectActiveCaption({
    captionsEnabled: true,
    currentTime: 119.4,
    holdLastCaption: false,
    videoDuration: 120,
    segments: [
      { start: 0, end: 4, text: 'intro' },
      { start: 115, end: 118, text: 'final point' },
    ],
  });

  assert.equal(caption?.text, 'final point');
});

test('does not pin the final caption across a long silent outro', () => {
  const caption = selectActiveCaption({
    captionsEnabled: true,
    currentTime: 119.4,
    holdLastCaption: false,
    videoDuration: 120,
    segments: [
      { start: 0, end: 4, text: 'intro' },
      { start: 80, end: 84, text: 'final point' },
    ],
  });

  assert.equal(caption, null);
});

test('splits long active captions into timed display chunks', () => {
  const originalText =
    'React hooks let components remember values, synchronize effects, reuse reducer logic, and keep references without rerendering the screen all at once.';

  const earlyCaption = selectActiveCaption({
    captionsEnabled: true,
    currentTime: 0.5,
    holdLastCaption: false,
    videoDuration: 20,
    segments: [{ start: 0, end: 9, text: originalText }],
  });
  const middleCaption = selectActiveCaption({
    captionsEnabled: true,
    currentTime: 5,
    holdLastCaption: false,
    videoDuration: 20,
    segments: [{ start: 0, end: 9, text: originalText }],
  });
  const lateCaption = selectActiveCaption({
    captionsEnabled: true,
    currentTime: 8.8,
    holdLastCaption: false,
    videoDuration: 20,
    segments: [{ start: 0, end: 9, text: originalText }],
  });

  assert.notEqual(earlyCaption?.text, originalText);
  assert.match(earlyCaption?.text ?? '', /^React hooks/);
  assert.notEqual(middleCaption?.text, earlyCaption?.text);
  assert.notEqual(lateCaption?.text, middleCaption?.text);
  assert.match(lateCaption?.text ?? '', /all at once\.$/);
  assert.ok((middleCaption?.text.length ?? 0) < originalText.length);
});

test('keeps translated captions on natural phrase boundaries when pacing chunks', () => {
  const originalText =
    '안녕하세요 여러분, 오늘은 리액트의 핵심에 내장된 모든 훅을 살펴보는 영상을 가져왔습니다. 공식 문서에 따르면 총 10개의 훅이 있습니다.';

  const earlyCaption = selectActiveCaption({
    captionsEnabled: true,
    currentTime: 0.5,
    holdLastCaption: false,
    videoDuration: 20,
    segments: [{ start: 0, end: 7, text: originalText }],
  });
  const middleCaption = selectActiveCaption({
    captionsEnabled: true,
    currentTime: 2.5,
    holdLastCaption: false,
    videoDuration: 20,
    segments: [{ start: 0, end: 7, text: originalText }],
  });
  const lateCaption = selectActiveCaption({
    captionsEnabled: true,
    currentTime: 5.8,
    holdLastCaption: false,
    videoDuration: 20,
    segments: [{ start: 0, end: 7, text: originalText }],
  });

  assert.equal(earlyCaption?.text, '안녕하세요 여러분,');
  assert.equal(
    middleCaption?.text,
    '오늘은 리액트의 핵심에 내장된 모든 훅을 살펴보는 영상을 가져왔습니다.',
  );
  assert.equal(lateCaption?.text, '공식 문서에 따르면 총 10개의 훅이 있습니다.');
  assert.ok(
    [earlyCaption, middleCaption, lateCaption].every(
      (caption) => (caption?.text.length ?? 0) <= 48,
    ),
  );
});

test('paces dense captions with shorter chunks for fast speech', () => {
  const originalText =
    'React hooks let components remember values synchronize effects reuse reducer logic keep references without rerendering the screen and coordinate state changes as the lesson moves quickly from one example to the next.';

  const captions = [0.5, 2.4, 4.4, 6.4].map((currentTime) =>
    selectActiveCaption({
      captionsEnabled: true,
      currentTime,
      holdLastCaption: false,
      videoDuration: 20,
      segments: [{ start: 0, end: 8, text: originalText }],
    }),
  );

  assert.ok(captions.every((caption) => caption));
  assert.ok(
    captions.every((caption) => (caption?.text.length ?? 0) <= 48),
    captions.map((caption) => caption?.text).join('\n'),
  );
  assert.ok(
    captions.every(
      (caption) => !/\b(?:and|or|to|from|the|a|an)$/i.test(caption?.text ?? ''),
    ),
    captions.map((caption) => caption?.text).join('\n'),
  );
});

test('does not display source captions as translated captions in another language', () => {
  const displayable = hasDisplayableLiveCaptionResponse({
    captionLanguage: 'en',
    liveCaptionProviders: new Set(['youtube-source-captions']),
    response: {
      mode: 'youtube-captions',
      provider: 'youtube-source-captions',
      videoId: 'korean-video',
      language: 'en',
      sourceLanguage: 'ko',
      translated: false,
      segments: [{ start: 0, end: 5, text: '안녕하세요' }],
      message: 'Source captions loaded while translation is unavailable.',
    },
  });

  assert.equal(displayable, false);
});

test('displays translated captions in the selected language', () => {
  const displayable = hasDisplayableLiveCaptionResponse({
    captionLanguage: 'en',
    liveCaptionProviders: new Set(['openai-caption-translation']),
    response: {
      mode: 'youtube-captions',
      provider: 'openai-caption-translation',
      videoId: 'korean-video',
      language: 'en',
      sourceLanguage: 'ko',
      translated: true,
      segments: [{ start: 0, end: 5, text: 'Hello' }],
      message: 'Translated captions loaded.',
    },
  });

  assert.equal(displayable, true);
});

test('disables native YouTube captions instead of leaving auto-translate active', () => {
  const calls: string[] = [];

  disableNativeYouTubeCaptions({
    unloadModule: (module) => calls.push(`unload:${module}`),
    setOption: (module, option, value) => {
      calls.push(`${module}:${option}:${JSON.stringify(value)}`);
    },
  });

  assert.deepEqual(calls, [
    'captions:track:{}',
    'captions:fontSize:-1',
    'unload:captions',
  ]);
});

test('enables native YouTube captions when custom live captions are unavailable', () => {
  const calls: string[] = [];

  syncNativeYouTubeCaptions({
    captionsEnabled: true,
    customCaptionsAvailable: false,
    language: 'ko',
    player: {
      loadModule: (module) => calls.push(`load:${module}`),
      unloadModule: (module) => calls.push(`unload:${module}`),
      setOption: (module, option, value) => {
        calls.push(`${module}:${option}:${JSON.stringify(value)}`);
      },
    },
  });

  assert.deepEqual(calls, [
    'load:captions',
    'captions:track:{"languageCode":"ko"}',
    'captions:fontSize:0',
  ]);
});

test('keeps native YouTube captions disabled when custom captions are available', () => {
  const calls: string[] = [];

  syncNativeYouTubeCaptions({
    captionsEnabled: true,
    customCaptionsAvailable: true,
    language: 'ko',
    player: {
      loadModule: (module) => calls.push(`load:${module}`),
      unloadModule: (module) => calls.push(`unload:${module}`),
      setOption: (module, option, value) => {
        calls.push(`${module}:${option}:${JSON.stringify(value)}`);
      },
    },
  });

  assert.deepEqual(calls, [
    'captions:track:{}',
    'captions:fontSize:-1',
    'unload:captions',
  ]);
});

test('keeps native YouTube captions disabled when captions are toggled off', () => {
  const calls: string[] = [];

  syncNativeYouTubeCaptions({
    captionsEnabled: false,
    customCaptionsAvailable: false,
    language: 'ko',
    player: {
      loadModule: (module) => calls.push(`load:${module}`),
      unloadModule: (module) => calls.push(`unload:${module}`),
      setOption: (module, option, value) => {
        calls.push(`${module}:${option}:${JSON.stringify(value)}`);
      },
    },
  });

  assert.deepEqual(calls, [
    'captions:track:{}',
    'captions:fontSize:-1',
    'unload:captions',
  ]);
});

test('uses native YouTube captions only while captions are enabled and custom captions are missing', () => {
  assert.equal(
    shouldUseNativeYouTubeCaptions({
      captionsEnabled: true,
      customCaptionsAvailable: false,
    }),
    true,
  );
  assert.equal(
    shouldUseNativeYouTubeCaptions({
      captionsEnabled: true,
      customCaptionsAvailable: true,
    }),
    false,
  );
  assert.equal(
    shouldUseNativeYouTubeCaptions({
      captionsEnabled: false,
      customCaptionsAvailable: false,
    }),
    false,
  );
  assert.equal(
    shouldUseNativeYouTubeCaptions({
      captionsEnabled: true,
      customCaptionsAvailable: false,
      nativeFallbackAvailable: false,
    }),
    false,
  );
});

test('asks YouTube iframe to load captions immediately when native fallback is needed', () => {
  assert.deepEqual(
    youtubeCaptionPlayerVars({
      captionsEnabled: true,
      customCaptionsAvailable: false,
      language: 'ko',
    }),
    {
      cc_lang_pref: 'ko',
      cc_load_policy: 1,
      hl: 'ko',
    },
  );
});

test('keeps YouTube iframe captions off when custom captions will render', () => {
  assert.deepEqual(
    youtubeCaptionPlayerVars({
      captionsEnabled: true,
      customCaptionsAvailable: true,
      language: 'en',
    }),
    {
      cc_load_policy: 0,
      hl: 'en',
    },
  );
});

test('uses the available source language for native YouTube captions', () => {
  assert.equal(
    nativeYouTubeCaptionLanguage({
      fallbackLanguage: 'ko',
      response: {
        mode: 'youtube-captions',
        provider: 'youtube-native-captions',
        videoId: 'native123',
        language: 'ko',
        sourceLanguage: 'en',
        translated: false,
        segments: [],
        message: 'Use native captions.',
      },
    }),
    'en',
  );
});

test('falls back to the selected language when native source language is unknown', () => {
  assert.equal(
    nativeYouTubeCaptionLanguage({
      fallbackLanguage: 'ko',
      response: {
        mode: 'youtube-captions',
        provider: 'youtube-native-captions',
        videoId: 'native123',
        language: 'ko',
        sourceLanguage: 'youtube',
        translated: false,
        segments: [],
        message: 'Use native captions.',
      },
    }),
    'ko',
  );
});

test('shows captions off instead of an unavailable error when native fallback is cached', () => {
  assert.equal(
    captionStatusText({
      captionError: '',
      captionLanguage: 'ko',
      captionResponse: {
        mode: 'youtube-captions',
        provider: 'youtube-native-captions',
        videoId: 'native123',
        language: 'ko',
        sourceLanguage: 'en',
        translated: false,
        segments: [],
        message: 'Use native captions.',
      },
      captionResponseMatchesVideo: true,
      captionsEnabled: false,
      hasCurrentVideo: true,
      hasLiveCaptionResponse: false,
      isCaptionLoading: false,
      shouldUseNativeCaptionFallback: false,
    }),
    '자막 꺼짐',
  );
});

test('shows a rate limit status when YouTube blocks timed-text downloads', () => {
  assert.equal(
    captionStatusText({
      captionError: '',
      captionLanguage: 'ko',
      captionResponse: {
        mode: 'youtube-captions',
        provider: 'youtube-caption-rate-limited',
        videoId: 'limited123',
        language: 'ko',
        sourceLanguage: 'en',
        translated: false,
        segments: [],
        message: 'HTTP Error 429: Too Many Requests',
      },
      captionResponseMatchesVideo: true,
      captionsEnabled: true,
      hasCurrentVideo: true,
      hasLiveCaptionResponse: false,
      isCaptionLoading: false,
      shouldUseNativeCaptionFallback: false,
    }),
    'YouTube 자막 API가 429로 막혔습니다.',
  );
});
