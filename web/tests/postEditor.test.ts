import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fallbackPostEditorFromVideoUrl,
  hasPostEditorVideoUrl,
  isPostEditorReadyToSave,
  koreanVideoDescription,
  postRegistrationRefreshSearch,
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
    '분석 후 저장',
  );
});

test('keeps registration disabled until a YouTube URL is present', () => {
  assert.equal(hasPostEditorVideoUrl({ videoUrl: '   ' }), false);
});

test('uses the direct save label once title and summary are ready', () => {
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
    '영상 저장',
  );
});

test('uses compact progress labels while analysis and saving are running', () => {
  assert.equal(
    videoRegistrationSubmitLabel({
      isEditing: false,
      isFetchingMetadata: true,
      isSaving: false,
      readyToSave: false,
    }),
    '분석 중',
  );
  assert.equal(
    videoRegistrationSubmitLabel({
      isEditing: false,
      isFetchingMetadata: false,
      isSaving: true,
      readyToSave: false,
    }),
    '저장 중',
  );
});

test('refreshes the saved-video list without the stale search after registration', () => {
  assert.equal(postRegistrationRefreshSearch('react hooks'), '');
  assert.equal(postRegistrationRefreshSearch('   '), '');
});

test('builds a saveable fallback editor when metadata analysis is unavailable', () => {
  const editor = fallbackPostEditorFromVideoUrl(
    ' https://www.youtube.com/watch?v=dQw4w9WgXcQ ',
    {
      title: '',
      videoUrl: '',
      thumbnailUrl: '',
      channelName: '',
      summary: '',
      translatedNotes: '',
      tags: '',
    },
  );

  assert.ok(editor);
  assert.equal(editor.videoUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(
    editor.thumbnailUrl,
    'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  );
  assert.equal(editor.channelName, 'YouTube');
  assert.equal(isPostEditorReadyToSave(editor), true);
});

test('fallback video descriptions are Korean and keep at most three tags', () => {
  const editor = fallbackPostEditorFromVideoUrl(
    'https://www.youtube.com/watch?v=abc123',
    {
      title: 'React Hooks Full Course',
      videoUrl: '',
      thumbnailUrl: '',
      channelName: 'freeCodeCamp.org',
      summary: '',
      translatedNotes: '',
      tags: '',
    },
  );

  assert.ok(editor);
  assert.match(editor.summary, /[가-힣]/);
  assert.match(editor.translatedNotes, /[가-힣]/);
  assert.ok(editor.summary.length > 20);
  assert.ok(editor.tags.split(',').map((tag) => tag.trim()).length <= 3);
});

test('replaces non-Korean metadata summaries with a Korean video description', () => {
  const description = koreanVideoDescription({
    channelName: 'freeCodeCamp.org',
    summary: 'A beginner friendly Python course covering syntax and functions.',
    title: 'Learn Python Full Course',
  });

  assert.match(description, /[가-힣]/);
  assert.doesNotMatch(description, /^A beginner friendly/);
  assert.match(description, /Learn Python Full Course/);
});
