import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cssPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../src/App.css',
);

function cssSource() {
  return readFileSync(cssPath, 'utf8');
}

function mediaBlock(maxWidth: number) {
  const css = cssSource();
  const start = css.indexOf(`@media (max-width: ${maxWidth}px)`);

  assert.notEqual(start, -1, `${maxWidth}px media query should exist`);

  let depth = 0;
  for (let index = start; index < css.length; index += 1) {
    const character = css[index];

    if (character === '{') {
      depth += 1;
    }

    if (character === '}') {
      depth -= 1;

      if (depth === 0) {
        return css.slice(start, index + 1);
      }
    }
  }

  assert.fail(`${maxWidth}px media query should close`);
}

function ruleBody(source: string, selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(
    new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`),
  );

  assert.ok(match?.groups?.body, `${selector} rule should exist`);

  return match.groups.body;
}

test('mobile navigation remains available as a tab row', () => {
  const mobileCss = mediaBlock(760);
  const navRule = ruleBody(mobileCss, '.site-nav nav');

  assert.match(navRule, /display:\s*flex;/);
  assert.doesNotMatch(navRule, /display:\s*none;/);
  assert.match(navRule, /background:\s*var\(--app-surface\);/);
  assert.match(navRule, /border:\s*1px solid var\(--app-line\);/);
  assert.match(navRule, /overflow-x:\s*visible;/);

  const navLinkRule = ruleBody(mobileCss, '.site-nav nav a');
  assert.match(navLinkRule, /min-height:\s*40px;/);
  assert.match(navLinkRule, /flex:\s*1 1 0;/);

  const activeRule = ruleBody(mobileCss, '.site-nav nav a.active');
  assert.match(activeRule, /background:\s*var\(--app-elevated\);/);
  assert.match(activeRule, /color:\s*var\(--app-accent\);/);
  assert.match(activeRule, /box-shadow:\s*none;/);
});

test('compact remove actions remain finger-friendly on mobile', () => {
  const css = cssSource();
  const playlistRemoveRule = ruleBody(css, '.playlist-item-remove');
  const queueRemoveRule = ruleBody(css, '.queue-remove');
  const navAccountLinkRule = ruleBody(css, '.nav-account a:not(.nav-cta)');
  const homeQueueLinkRule = ruleBody(css, '.home-queue-card .section-title a');

  assert.match(playlistRemoveRule, /min-height:\s*40px;/);
  assert.match(queueRemoveRule, /min-height:\s*40px;/);
  assert.match(navAccountLinkRule, /min-height:\s*40px;/);
  assert.match(homeQueueLinkRule, /min-height:\s*40px;/);
});

test('compact builder and study actions remain finger-friendly on mobile', () => {
  const css = cssSource();

  assert.match(css, /\.draft-actions button\s*\{[\s\S]*?min-height:\s*40px;/);
  assert.match(css, /\.quick-prompts button\s*\{[\s\S]*?min-height:\s*40px;/);
  assert.match(css, /\.caption-toggle\s*\{[\s\S]*?min-height:\s*40px;/);
  assert.match(
    css,
    /\.chip-grid button,[\s\S]*?\.secondary-action\s*\{[\s\S]*?min-height:\s*40px;/,
  );
  assert.match(
    css,
    /\.choice-row button,[\s\S]*?\.speed-grid button,[\s\S]*?\.loop-actions button\s*\{[\s\S]*?min-height:\s*40px;/,
  );
});

test('tablet board panels reset explicit grid placement for one-column layout', () => {
  const tabletCss = mediaBlock(1020);

  assert.match(
    tabletCss,
    /\.board-grid > \.post-browser,[\s\S]*?\.board-grid > \.post-detail,[\s\S]*?\.board-grid > \.playlist-builder-panel\s*\{[\s\S]*?grid-column:\s*auto;/,
  );
});

test('narrow board layout checks saved videos before playlist editing', () => {
  const tabletCss = mediaBlock(1020);

  assert.match(
    tabletCss,
    /\.editor-panel\s*\{[\s\S]*?order:\s*1;/,
  );
  assert.match(
    tabletCss,
    /\.board-grid > \.post-browser\s*\{[\s\S]*?order:\s*2;/,
  );
  assert.match(
    tabletCss,
    /\.board-grid > \.post-detail\s*\{[\s\S]*?order:\s*3;/,
  );
  assert.match(
    tabletCss,
    /\.board-grid > \.playlist-builder-panel\s*\{[\s\S]*?order:\s*4;/,
  );
  assert.match(
    tabletCss,
    /\.board-post-list\s*\{[\s\S]*?max-height:\s*none;[\s\S]*?overflow-y:\s*visible;/,
  );
});

test('playlist thumbnail stacks use proportional layers that stay inside cards', () => {
  const css = cssSource();

  assert.match(
    css,
    /\.thumbnail-layer\s*\{[\s\S]*?box-sizing:\s*border-box;/,
  );
  assert.match(
    css,
    /\.playlist-thumbnail-stack:not\(\.count-1\) \.thumbnail-layer\s*\{[\s\S]*?width:\s*74%;/,
  );
  assert.match(
    css,
    /\.thumbnail-layer\.layer-3\s*\{[\s\S]*?left:\s*22%;/,
  );
  assert.match(
    css,
    /\.playlist-choice-thumb img\s*\{[\s\S]*?box-sizing:\s*border-box;/,
  );
});

test('home support block spans the same product home container width', () => {
  const css = cssSource();
  const supportRule = ruleBody(css, '.home-support-grid');

  assert.match(supportRule, /width:\s*100%;/);
  assert.doesNotMatch(supportRule, /max-width:\s*760px;/);
});

test('explore detail keeps AI summary and course order in one readable panel', () => {
  const css = cssSource();

  assert.match(
    css,
    /\.explore-detail-content\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);/,
  );
  assert.match(
    css,
    /\.course-overview-panel\s*\{[\s\S]*?padding:\s*18px;/,
  );
  assert.match(
    css,
    /\.course-video-summary\.condensed\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);/,
  );
  assert.match(
    css,
    /\.course-video-strip \.playlist-step-list li\s*\{[\s\S]*?display:\s*block;/,
  );
  assert.match(
    css,
    /\.course-video-strip \.playlist-step-list li\.is-active\s*\{[\s\S]*?background:\s*#fff;/,
  );
  assert.match(
    css,
    /\.course-video-inline-detail\s*\{[\s\S]*?padding:\s*12px 14px 14px 50px;/,
  );
  assert.match(
    css,
    /\.selected-video-analysis\s*\{[\s\S]*?background:\s*#f8fafc;/,
  );
  assert.match(
    css,
    /\.course-video-strip \.playlist-step-list button span,[\s\S]*?\.course-video-strip \.playlist-step-list button small\s*\{[\s\S]*?white-space:\s*nowrap;/,
  );
});
