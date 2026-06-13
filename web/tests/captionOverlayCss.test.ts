import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cssPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../src/App.css',
);

function captionOverlayDeclarations() {
  const css = readFileSync(cssPath, 'utf8');
  const match = css.match(/\.caption-overlay\s*\{(?<body>[^}]*)\}/);

  assert.ok(match?.groups?.body, 'caption overlay CSS rule should exist');

  return match.groups.body;
}

function raisedCaptionOverlayDeclarations() {
  const css = readFileSync(cssPath, 'utf8');
  const match = css.match(/\.caption-overlay\.raised\s*\{(?<body>[^}]*)\}/);

  assert.ok(match?.groups?.body, 'raised caption overlay CSS rule should exist');

  return match.groups.body;
}

function hoveredShellCaptionOverlayDeclarations() {
  const css = readFileSync(cssPath, 'utf8');
  const match = css.match(
    /\.youtube-shell:hover\s+\.caption-overlay\s*\{(?<body>[^}]*)\}/,
  );

  assert.ok(
    match?.groups?.body,
    'hovered player shell caption overlay CSS rule should exist',
  );

  return match.groups.body;
}

test('caption overlay does not block YouTube player controls', () => {
  const declarations = captionOverlayDeclarations();

  assert.match(declarations, /pointer-events:\s*none;/);
  assert.match(declarations, /bottom:\s*clamp\(64px,\s*9%,\s*80px\);/);
  assert.match(declarations, /transition:\s*bottom 160ms ease/);
});

test('caption overlay rises when player controls are active', () => {
  const declarations = raisedCaptionOverlayDeclarations();

  assert.match(declarations, /bottom:\s*clamp\(104px,\s*16%,\s*132px\);/);
});

test('caption overlay also rises from CSS hover over the player shell', () => {
  const declarations = hoveredShellCaptionOverlayDeclarations();

  assert.match(declarations, /bottom:\s*clamp\(104px,\s*16%,\s*132px\);/);
});
