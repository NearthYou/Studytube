import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(resolve(testDirectory, '../src/App.tsx'), 'utf8');

test('loop range number inputs have explicit accessible labels', () => {
  assert.match(appSource, /aria-label="구간 반복 시작"/);
  assert.match(appSource, /aria-label="구간 반복 끝"/);
});

test('summary timestamps expose seek buttons wired to the parsed seconds', () => {
  assert.match(appSource, /className="summary-time-link label-time"/);
  assert.match(appSource, /className="summary-time-link"/);
  assert.match(appSource, /aria-label=\{`\$\{timestamp\.text\}[^`]+`\}/);
  assert.match(appSource, /onClick=\{\(\) => onSeek\(timestamp\.seconds\)\}/);
  assert.match(appSource, /onClick=\{\(\) => onSeek\(part\.seconds\)\}/);
});

test('youtube player has loading and failure fallbacks', () => {
  assert.match(appSource, /YOUTUBE_API_LOAD_TIMEOUT_MS/);
  assert.match(appSource, /YouTube iframe API load timed out/);
  assert.match(appSource, /playerLoadError/);
  assert.match(appSource, /className="youtube-unavailable youtube-loading"/);
});

test('translated captions are loaded through playback windows instead of the whole video', () => {
  assert.match(appSource, /const initialCaptionWindow = captionTranslationWindow\(/);
  assert.match(appSource, /\.\.\.initialCaptionWindow/);
  assert.match(appSource, /const captionWindow = captionTranslationWindow\(/);
  assert.match(appSource, /\.\.\.captionWindow/);
  assert.doesNotMatch(
    appSource,
    /fetchTranslatedCaptions\(\{\s*videoId:[\s\S]*?durationSeconds: DEFAULT_CAPTION_DURATION_SECONDS,\s*\}\)/,
  );
});
