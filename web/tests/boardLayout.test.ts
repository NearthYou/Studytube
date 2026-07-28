import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { BOARD_WORKFLOW_SECTIONS } from '../src/boardLayout.ts';

const testDirectory = dirname(fileURLToPath(import.meta.url));

test('orders board builder sections by the user workflow', () => {
  assert.deepEqual(BOARD_WORKFLOW_SECTIONS, [
    'editor-panel',
    'post-browser',
    'post-detail',
    'playlist-builder-panel',
  ]);
});

test('keeps board post detail thumbnails from collapsing', () => {
  const css = readFileSync(resolve(testDirectory, '../src/App.css'), 'utf8');

  assert.match(css, /\.post-detail-hero img\s*\{[\s\S]*?height:\s*clamp\(/);
});
