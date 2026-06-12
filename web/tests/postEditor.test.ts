import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasPostEditorVideoUrl,
  isPostEditorReadyToSave,
  videoRegistrationSubmitLabel,
} from '../src/postEditor.ts';

test('allows submitting a URL-only video draft so registration can analyze first', () => {
  const editor = {
    title: '',
    videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    summary: '',
  };

  assert.equal(hasPostEditorVideoUrl(editor), true);
  assert.equal(isPostEditorReadyToSave(editor), false);
  assert.equal(
    videoRegistrationSubmitLabel({
      isEditing: false,
      isFetchingMetadata: false,
      isSaving: false,
      readyToSave: isPostEditorReadyToSave(editor),
    }),
    '분석하고 영상 추가하기',
  );
});

test('keeps registration disabled until a YouTube URL is present', () => {
  assert.equal(hasPostEditorVideoUrl({ videoUrl: '   ' }), false);
});

test('uses the direct add label once title and summary are ready', () => {
  const editor = {
    title: 'React Hooks Course',
    videoUrl: 'https://www.youtube.com/watch?v=abc123',
    summary: 'React hooks summary',
  };

  assert.equal(isPostEditorReadyToSave(editor), true);
  assert.equal(
    videoRegistrationSubmitLabel({
      isEditing: false,
      isFetchingMetadata: false,
      isSaving: false,
      readyToSave: true,
    }),
    '영상 추가하기',
  );
});
