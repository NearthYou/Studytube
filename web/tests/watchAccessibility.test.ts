import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync('web/src/App.tsx', 'utf8');

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

test('main learning navigator opens the course finder before the watch player', () => {
  assert.match(appSource, /<GuardedNavLink to="\/search">학습<\/GuardedNavLink>/);
  assert.match(appSource, /<GuardedNavLink to="\/watch">시청<\/GuardedNavLink>/);
  assert.doesNotMatch(appSource, /<GuardedNavLink to="\/watch">학습<\/GuardedNavLink>/);
});
