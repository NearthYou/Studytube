import assert from 'node:assert/strict';
import test from 'node:test';
import type { CourseStep, StudyPost } from '../src/types.ts';
import {
  DEFAULT_LEARNING_STATE,
  extractPostIds,
  findPostIdForQueueVideo,
  getVideoLearningState,
  mergeVideosIntoQueue,
  postPayloadFromQueueVideo,
  queueVideoFromCourseStep,
  queueVideoFromMcpVideo,
  queueVideoFromPost,
  queueVideoKey,
  replaceVideoInQueueIfPresent,
  uniqueVideos,
  type QueueVideo,
} from '../src/watchQueue.ts';

function post(id: number, videoId = `video-${id}`): StudyPost {
  return {
    id,
    authorId: 1,
    authorName: 'Demo',
    title: `Video ${id}`,
    videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
    thumbnailUrl: `thumb-${id}.jpg`,
    channelName: 'Channel',
    summary: `Summary ${id}`,
    translatedNotes: `Notes ${id}`,
    tags: ['react'],
    comments: [],
    createdAt: '2026-06-13T00:00:00.000Z',
    updatedAt: '2026-06-13T00:00:00.000Z',
  };
}

function video(input: Partial<QueueVideo> = {}): QueueVideo {
  return {
    id: 'post-1',
    title: 'React Hooks',
    videoId: 'abc123',
    videoUrl: 'https://www.youtube.com/watch?v=abc123',
    thumbnailUrl: 'thumb.jpg',
    channelName: 'React Channel',
    summary: 'Hooks summary',
    translatedNotes: 'Hooks notes',
    source: 'board',
    ...input,
  };
}

test('converts saved posts into queue videos with stable video keys', () => {
  const queueVideo = queueVideoFromPost(post(7, 'yt-777'));

  assert.equal(queueVideo.id, 'post-7');
  assert.equal(queueVideo.videoId, 'yt-777');
  assert.equal(queueVideoKey(queueVideo), 'yt-777');
});

test('plays a Course snapshot with a null source while retaining its step id', () => {
  const step: CourseStep = {
    id: '9001',
    position: 1,
    sourcePostId: null,
    snapshot: {
      title: 'Deleted source survives',
      videoUrl: 'https://www.youtube.com/watch?v=snapshot1',
      thumbnailUrl: 'snapshot.jpg',
      channelName: 'Archive Channel',
    },
    ownerLearningState: {
      captionLanguage: 'en',
      captionsEnabled: false,
      playbackRate: 1.25,
      loop: { enabled: true, manual: true, start: 4, end: 9 },
      marks: [],
    },
  };

  const queueVideo = queueVideoFromCourseStep(step);

  assert.equal(queueVideo.id, 'course-step-9001');
  assert.equal(queueVideo.videoId, 'snapshot1');
  assert.equal(queueVideo.learning?.captionLanguage, 'en');
  assert.equal(queueVideo.learning?.loop.end, 9);
});

test('deduplicates queue videos by video key instead of source id', () => {
  const videos = uniqueVideos([
    video({ id: 'post-1', videoId: 'same-video' }),
    video({ id: 'rag-1', videoId: 'same-video' }),
    video({ id: 'agent-other', videoId: 'other-video' }),
  ]);

  assert.deepEqual(
    videos.map((item) => item.id),
    ['post-1', 'agent-other'],
  );
});

test('merges selected videos first while preserving existing learning state', () => {
  const existingLearning = {
    captionLanguage: 'en' as const,
    captionsEnabled: false,
    playbackRate: 1.5,
    loop: { enabled: true, manual: true, start: 12, end: 24 },
    marks: [],
  };
  const selected = video({ id: 'post-1', title: 'Fresh title' });
  const merged = mergeVideosIntoQueue(
    [video({ id: 'post-1', title: 'Old title', learning: existingLearning })],
    [selected, video({ id: 'post-2', videoId: 'def456' })],
    selected,
  );

  assert.equal(merged[0].title, 'Fresh title');
  assert.equal(merged[0].learning?.captionLanguage, 'en');
  assert.equal(merged[0].learning?.playbackRate, 1.5);
  assert.equal(merged[1].id, 'post-2');
});

test('updates saved video details only when the video is already in the learning playlist', () => {
  const existingLearning = {
    captionLanguage: 'en' as const,
    captionsEnabled: false,
    playbackRate: 1.5,
    loop: { enabled: true, manual: true, start: 12, end: 24 },
    marks: [],
  };
  const existingQueue = [
    video({
      id: 'post-1',
      title: 'Old title',
      videoId: 'same-video',
      learning: existingLearning,
    }),
  ];

  const missingResult = replaceVideoInQueueIfPresent(
    existingQueue,
    video({ id: 'post-2', videoId: 'new-video', title: 'New saved video' }),
  );

  assert.equal(missingResult.replaced, false);
  assert.deepEqual(missingResult.queue, existingQueue);

  const updatedResult = replaceVideoInQueueIfPresent(
    existingQueue,
    video({ id: 'post-9', videoId: 'same-video', title: 'Updated title' }),
  );

  assert.equal(updatedResult.replaced, true);
  assert.equal(updatedResult.queue.length, 1);
  assert.equal(updatedResult.queue[0].title, 'Updated title');
  assert.equal(updatedResult.queue[0].learning?.captionLanguage, 'en');
  assert.equal(updatedResult.queue[0].learning?.playbackRate, 1.5);
});

test('normalizes invalid learning preferences to supported defaults', () => {
  const learning = getVideoLearningState(
    video({
      learning: {
        captionLanguage: 'fr' as never,
        captionsEnabled: true,
        playbackRate: 3,
        loop: { enabled: true, start: 4, end: 8 },
        marks: [{ id: '', start: 1, end: 1, note: 'review', caption: '', createdAt: '' }],
      },
    }),
  );

  assert.equal(learning.captionLanguage, DEFAULT_LEARNING_STATE.captionLanguage);
  assert.equal(learning.playbackRate, DEFAULT_LEARNING_STATE.playbackRate);
  assert.equal(learning.loop.enabled, false);
  assert.equal(learning.loop.start, 4);
  assert.equal(learning.marks[0].end, 2);
});

test('resolves generated videos back to saved posts by post id or video id', () => {
  const posts = [post(1, 'first'), post(2, 'second')];

  assert.equal(findPostIdForQueueVideo(video({ id: 'rag-2' }), posts), 2);
  assert.equal(
    findPostIdForQueueVideo(video({ id: 'agent-x', videoId: 'first' }), posts),
    1,
  );
  assert.deepEqual(
    extractPostIds([video({ id: 'post-1' }), video({ id: 'rag-2' })]),
    [1, 2],
  );
});

test('builds safe post payloads from generated queue videos', () => {
  const payload = postPayloadFromQueueVideo(
    video({
      title: '',
      channelName: '',
      summary: '',
      translatedNotes: '',
      source: 'agent',
    }),
  );

  assert.equal(payload.title, '추천 학습 영상');
  assert.equal(payload.channelName, 'agent');
  assert.ok(payload.summary.length > 0);
  assert.ok(payload.translatedNotes.includes(payload.summary));
  assert.deepEqual(payload.tags, ['추천', '영상입니다']);
});

test('rejects MCP videos without a usable video id', () => {
  const queueVideo = queueVideoFromMcpVideo({
    provider: 'mcp',
    title: 'No id',
    channel: 'Channel',
    thumbnailUrl: '',
    sourceUrl: 'https://example.com/not-youtube',
    durationLabel: '',
    summary: '',
  });

  assert.equal(queueVideo, null);
});
