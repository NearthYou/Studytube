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
});

test('tablet board panels reset explicit grid placement for one-column layout', () => {
  const tabletCss = mediaBlock(1020);

  assert.match(
    tabletCss,
    /\.board-grid > \.post-browser,[\s\S]*?\.board-grid > \.playlist-builder-panel,[\s\S]*?\.board-grid > \.post-detail\s*\{[\s\S]*?grid-column:\s*auto;/,
  );
});

test('narrow board layout keeps video registration first', () => {
  const tabletCss = mediaBlock(1020);

  assert.match(
    tabletCss,
    /\.editor-panel\s*\{[\s\S]*?order:\s*1;/,
  );
  assert.match(
    tabletCss,
    /\.board-grid > \.post-browser\s*\{[\s\S]*?order:\s*2;/,
  );
});
