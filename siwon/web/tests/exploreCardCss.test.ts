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

function ruleBody(source: string, selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(
    new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`),
  );

  assert.ok(match?.groups?.body, `${selector} rule should exist`);

  return match.groups.body;
}

test('explore playlist cards stretch their grid content instead of inheriting centered button alignment', () => {
  const cardRule = ruleBody(cssSource(), '.explore-card');

  assert.match(cardRule, /align-items:\s*stretch;/);
  assert.match(cardRule, /justify-content:\s*stretch;/);
  assert.match(cardRule, /justify-items:\s*stretch;/);
});
