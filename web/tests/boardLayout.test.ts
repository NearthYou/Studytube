import assert from 'node:assert/strict';
import test from 'node:test';
import { BOARD_WORKFLOW_SECTIONS } from '../src/boardLayout.ts';

test('orders board builder sections by the user workflow', () => {
  assert.deepEqual(BOARD_WORKFLOW_SECTIONS, [
    'editor-panel',
    'playlist-builder-panel',
    'post-browser',
    'post-detail',
  ]);
});
