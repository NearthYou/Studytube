import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateQueueMinutes } from '../src/watchMetrics.ts';

test('estimates zero minutes for an empty watch queue', () => {
  assert.equal(estimateQueueMinutes([]), 0);
});

test('estimates queued video minutes from summary and translated notes', () => {
  assert.equal(
    estimateQueueMinutes([
      {
        summary: 'x'.repeat(181),
        translatedNotes: '',
      },
    ]),
    14,
  );
});
