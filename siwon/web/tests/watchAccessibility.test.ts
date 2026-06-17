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

test('watch page loads prepared video assets through the saved post id', () => {
  assert.match(appSource, /fetchVideoAsset\(\s*currentPostId,\s*session\.token\s*\)/);
  assert.match(appSource, /prepareVideoAsset\(\s*retryTarget\.postId,\s*session\.token\s*\)/);
  assert.match(appSource, /captionResponseFromVideoAsset\(/);
  assert.match(appSource, /videoAssetCoversTime\(/);
  assert.match(appSource, /videoAssetCoversRange\(/);
  assert.doesNotMatch(appSource, /fetchVideoAsset\(\s*currentVideo\?\.videoId/);
  assert.doesNotMatch(appSource, /prepareVideoAsset\(\s*currentVideo\?\.videoId/);
});

test('watch page prepares missing saved video assets before falling back to live captions', () => {
  assert.match(appSource, /isNotFoundRequest\(error\)/);
  assert.match(appSource, /const preparedAsset = await prepareVideoAsset\(\s*postId,\s*session\.token,\s*\)/);
  assert.match(appSource, /applyVideoAsset\(preparedAsset, expectedTarget\)/);
  assert.doesNotMatch(
    appSource,
    /catch\s*\{\s*if \(!cancelled\) \{\s*setVideoAsset\(null\);\s*setAssetLookup\(\{ postId, status: "error" \}\);/,
  );
});

test('watch page skips on-demand caption calls for prepared asset coverage', () => {
  assert.match(appSource, /const currentPostId = currentVideo\s*\?\s*findPostIdForQueueVideo\(currentVideo, libraryPosts\)\s*:\s*null/);
  assert.match(appSource, /const assetCaptionResponse = captionResponseFromVideoAsset\(videoAsset\)/);
  assert.match(appSource, /const assetCaptionLanguageMatchesSelection =\s*assetCaptionResponse\?\.language === captionLanguage/);
  assert.match(appSource, /assetCaptionLanguageMatchesSelection[\s\S]*videoAssetCoversRange\(\s*videoAsset,\s*initialCaptionWindow\.startSeconds,\s*initialCaptionWindow\.endSeconds,\s*\)/);
  assert.match(appSource, /assetCaptionLanguageMatchesSelection[\s\S]*videoAssetCoversRange\(\s*videoAsset,\s*captionWindow\.startSeconds,\s*captionWindow\.endSeconds,\s*\)/);
  assert.match(appSource, /assetCaptionLanguageMatchesSelection[\s\S]*videoAssetCoversTime\(videoAsset, currentTime\)/);
  assert.doesNotMatch(appSource, /current\?\.provider === "prepared-video-asset"[\s\S]{0,80}\? response/);
});

test('watch page keeps prepared captions while fallback caption windows load', () => {
  assert.match(appSource, /const preparedCaptionResponse = assetCaptionResponseMatchesVideo\s*\?\s*captionResponseFromVideoAsset\(videoAsset\)\s*:\s*null/);
  assert.match(appSource, /setCaptionResponse\(preparedCaptionResponse\)/);
  assert.match(appSource, /setTranslatedCaptionResponse\(preparedCaptionResponse\)/);
  assert.match(appSource, /mergeTranslatedCaptionResponse\(\s*preparedCaptionResponse \?\? current,\s*response,\s*\)/);
  assert.doesNotMatch(
    appSource,
    /async function loadCaptions\(\)[\s\S]*?setCaptionResponse\(null\);\s*setTranslatedCaptionResponse\(null\);[\s\S]*?fetchTranslatedCaptions/,
  );
  assert.doesNotMatch(
    appSource,
    /setTranslatedCaptionResponse\(response\);/,
  );
});

test('watch page asset and caption fetch effects use stable video primitives', () => {
  assert.match(appSource, /const currentVideoId = currentVideo\?\.videoId \?\? ""/);
  assert.match(appSource, /const currentVideoUrl = currentVideo\?\.videoUrl \?\? ""/);
  assert.doesNotMatch(
    appSource,
    /\}, \[applyVideoAsset, currentPostId, currentVideo, session\.token\]\)/,
  );
  assert.doesNotMatch(
    appSource,
    /captionLanguage,\s*currentVideo,\s*assetCaptionLanguageMatchesSelection/,
  );
  assert.match(
    appSource,
    /\}, \[\s*applyVideoAsset,\s*currentPostId,\s*currentVideoId,\s*session\.token,\s*\]\)/,
  );
});

test('watch page ignores stale prepared asset retry responses', () => {
  assert.match(appSource, /const currentAssetTargetRef = useRef/);
  assert.match(appSource, /function isCurrentAssetTarget\(/);
  assert.match(appSource, /const retryTarget = \{\s*postId: currentPostId,\s*videoId: currentVideoId,\s*\}/);
  assert.match(appSource, /if \(!isCurrentAssetTarget\(retryTarget\)\) \{\s*return;\s*\}/);
  assert.match(appSource, /applyVideoAsset\(asset, retryTarget\)/);
});
