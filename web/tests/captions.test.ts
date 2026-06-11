import assert from 'node:assert/strict';
import test from 'node:test';
import { selectActiveCaption } from '../src/captions.ts';

test('keeps the final caption visible through the end of the video', () => {
  const caption = selectActiveCaption({
    captionsEnabled: true,
    currentTime: 119.4,
    holdLastCaption: false,
    videoDuration: 120,
    segments: [
      { start: 0, end: 4, text: 'intro' },
      { start: 115, end: 118, text: 'final point' },
    ],
  });

  assert.equal(caption?.text, 'final point');
});

test('does not pin the final caption across a long silent outro', () => {
  const caption = selectActiveCaption({
    captionsEnabled: true,
    currentTime: 119.4,
    holdLastCaption: false,
    videoDuration: 120,
    segments: [
      { start: 0, end: 4, text: 'intro' },
      { start: 80, end: 84, text: 'final point' },
    ],
  });

  assert.equal(caption, null);
});
