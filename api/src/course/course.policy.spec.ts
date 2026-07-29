import { CourseValidationError } from './course.errors';
import {
  COURSE_LIMITS,
  decodeCourseCursor,
  encodeCourseCursor,
  toOwnerCourseProjection,
  toPublicCourseProjection,
  validateCourseStepSnapshot,
  validateCourseStepInputs,
  validateCourseTitle,
  validateOwnerLearningState,
} from './course.policy';
import type { CourseAggregate } from './course.types';

describe('Course domain policy', () => {
  it('rejects a blank title with a stable domain error', () => {
    expect(() => validateCourseTitle('   ')).toThrow(
      expect.objectContaining<Partial<CourseValidationError>>({
        code: 'COURSE_INVALID_INPUT',
        field: 'title',
      }),
    );
  });

  it('builds an owner projection with learning state and a public projection without private identity fields', () => {
    const legacySnapshotTitle = 'L'.repeat(COURSE_LIMITS.snapshotTitle + 1);
    const course: CourseAggregate = {
      id: 41,
      ownerId: 7,
      title: 'PostgreSQL concurrency',
      description: 'Locking and optimistic versioning',
      visibility: 'public',
      status: 'published',
      version: 3,
      createdAt: '2026-07-29T00:00:00.000Z',
      updatedAt: '2026-07-29T00:10:00.000Z',
      publishedAt: '2026-07-29T00:05:00.000Z',
      archivedAt: null,
      steps: [
        {
          id: '91',
          courseId: 41,
          sourcePostId: 13,
          position: 1,
          snapshot: {
            title: legacySnapshotTitle,
            videoUrl: 'https://www.youtube.com/watch?v=abc123',
            thumbnailUrl: 'https://img.example/abc123.jpg',
            channelName: 'Database School',
          },
          ownerLearningState: {
            captionLanguage: 'ko',
            captionsEnabled: true,
            playbackRate: 1.25,
            loop: { enabled: true, manual: true, start: 10, end: 30 },
            marks: [
              {
                id: 'mark-1',
                start: 12,
                end: 16,
                note: 'Compare-and-set',
                caption: 'Only one writer wins',
                createdAt: '2026-07-29T00:02:00.000Z',
              },
            ],
          },
        },
      ],
      feedback: [
        {
          id: 71,
          courseId: 41,
          authorId: 8,
          authorName: 'Grace',
          rating: 5,
          body: 'Useful ordering',
          createdAt: '2026-07-29T00:06:00.000Z',
        },
      ],
    };

    const owner = toOwnerCourseProjection(course);
    const publicCourse = toPublicCourseProjection(course);

    expect(owner.ownerId).toBe(7);
    expect(owner.steps[0].ownerLearningState.marks[0].note).toBe(
      'Compare-and-set',
    );
    expect(owner.feedback[0].authorId).toBe(8);

    const publicJson = JSON.stringify(publicCourse);
    expect(publicCourse.steps[0]).toEqual({
      id: '91',
      position: 1,
      snapshot: course.steps[0].snapshot,
    });
    expect(publicCourse.feedback[0]).toEqual({
      id: 71,
      authorName: 'Grace',
      rating: 5,
      body: 'Useful ordering',
      createdAt: '2026-07-29T00:06:00.000Z',
    });
    expect(publicJson).not.toContain('ownerId');
    expect(publicJson).not.toContain('sourcePostId');
    expect(publicJson).not.toContain('ownerLearningState');
    expect(publicJson).not.toContain('authorId');
    expect(publicJson).not.toContain('Compare-and-set');
  });

  it('rejects a learning state with an unsupported playback rate', () => {
    expect(() =>
      validateOwnerLearningState({
        captionLanguage: 'ko',
        captionsEnabled: true,
        playbackRate: 3,
        loop: { enabled: false, manual: false, start: 0, end: 15 },
        marks: [],
      }),
    ).toThrow(
      expect.objectContaining<Partial<CourseValidationError>>({
        code: 'COURSE_INVALID_INPUT',
        field: 'ownerLearningState.playbackRate',
      }),
    );
  });

  it('rejects an enabled loop whose end does not follow its start', () => {
    expect(() =>
      validateOwnerLearningState({
        captionLanguage: 'en',
        captionsEnabled: false,
        playbackRate: 1,
        loop: { enabled: true, manual: true, start: 30, end: 30 },
        marks: [],
      }),
    ).toThrow(
      expect.objectContaining<Partial<CourseValidationError>>({
        field: 'ownerLearningState.loop',
      }),
    );
  });

  it('rejects malformed learning marks instead of persisting arbitrary JSON', () => {
    expect(() =>
      validateOwnerLearningState({
        captionLanguage: 'ko',
        captionsEnabled: true,
        playbackRate: 1,
        loop: { enabled: false, manual: false, start: 0, end: 15 },
        marks: [
          {
            id: 'mark-1',
            start: 20,
            end: 10,
            note: 'backwards range',
            caption: '',
            createdAt: 'not-a-timestamp',
          },
        ],
      }),
    ).toThrow(
      expect.objectContaining<Partial<CourseValidationError>>({
        field: 'ownerLearningState.marks[0]',
      }),
    );
  });

  it('rejects a local snapshot with a non-HTTP video URL', () => {
    expect(() =>
      validateCourseStepSnapshot({
        title: 'Unsafe video',
        videoUrl: 'javascript:alert(1)',
        thumbnailUrl: '',
        channelName: 'Channel',
      }),
    ).toThrow(
      expect.objectContaining<Partial<CourseValidationError>>({
        field: 'snapshot.videoUrl',
      }),
    );
  });

  it('rejects duplicate source-post entries in an ordered step request', () => {
    expect(() =>
      validateCourseStepInputs(
        [{ sourcePostId: 13 }, { sourcePostId: 13 }],
        'create',
      ),
    ).toThrow(
      expect.objectContaining<Partial<CourseValidationError>>({
        field: 'steps[1].sourcePostId',
      }),
    );
  });

  it('accepts existing BIGINT step identifiers only as canonical positive decimal strings', () => {
    expect(() => validateCourseStepInputs([{ stepId: 91 }], 'replace')).toThrow(
      expect.objectContaining<Partial<CourseValidationError>>({
        field: 'steps[0].stepId',
      }),
    );
  });

  it('round trips the route kind, immutable timestamp, and tie-breaker ID in a v1 cursor', () => {
    const encoded = encodeCourseCursor({
      kind: 'owner',
      timestamp: '2026-07-29T01:02:03.456789Z',
      id: 41,
    });

    expect(decodeCourseCursor(encoded, 'owner')).toEqual({
      version: 1,
      kind: 'owner',
      timestamp: '2026-07-29T01:02:03.456789Z',
      id: 41,
    });
  });

  it('rejects an otherwise valid cursor payload with trailing decoded bytes', () => {
    const withTrailingBytes = Buffer.from(
      `${JSON.stringify({
        v: 1,
        k: 'owner',
        t: '2026-07-29T01:02:03.456Z',
        i: 41,
      })}garbage`,
      'utf8',
    ).toString('base64url');

    expect(() => decodeCourseCursor(withTrailingBytes, 'owner')).toThrow(
      expect.objectContaining<Partial<CourseValidationError>>({
        code: 'COURSE_INVALID_INPUT',
        field: 'cursor',
      }),
    );
  });

  it('rejects cursors from another route kind or protocol version', () => {
    const ownerCursor = encodeCourseCursor({
      kind: 'owner',
      timestamp: '2026-07-29T01:02:03.456Z',
      id: 41,
    });
    const v2Cursor = Buffer.from(
      JSON.stringify({
        v: 2,
        k: 'owner',
        t: '2026-07-29T01:02:03.456Z',
        i: 41,
      }),
      'utf8',
    ).toString('base64url');

    expect(() => decodeCourseCursor(ownerCursor, 'public')).toThrow(
      CourseValidationError,
    );
    expect(() => decodeCourseCursor(v2Cursor, 'owner')).toThrow(
      CourseValidationError,
    );
  });
});
