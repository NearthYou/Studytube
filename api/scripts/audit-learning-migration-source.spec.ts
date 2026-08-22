import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool } from 'pg';
import {
  auditLearningMigrationSource,
  classifyLearningMigrationSource,
  type MigrationSourceSnapshot,
} from './audit-learning-migration-source';

const PRIVATE_QUERY = 'private-query-must-not-leak';
const PRIVATE_NOTE = 'private-note-must-not-leak';
const PRIVATE_EMAIL = 'legacy-owner@example.test';
const PRIVATE_CAPTION = 'private-caption-must-not-leak';
const VIDEO_A = 'dQw4w9WgXcQ';
const VIDEO_B = 'LlvBzyy-558';
const VIDEO_C = 'novnyCaa7To';

describe('learning migration source audit', () => {
  it('maps a valid legacy fixture with complete canonical video and owner coverage', () => {
    const first = classifyLearningMigrationSource(validSnapshot());
    const reordered = classifyLearningMigrationSource({
      ...validSnapshot(),
      posts: [...validSnapshot().posts].reverse(),
      courseSteps: [...validSnapshot().courseSteps].reverse(),
    });

    expect(first.startGatePassed).toBe(true);
    expect(first.blockerCount).toBe(0);
    expect(first.canonicalVideos).toEqual({
      activeSources: 2,
      identified: 2,
      identificationPercent: 100,
    });
    expect(first.ownership).toEqual({
      learningBearingRows: 5,
      mapped: 5,
      mappingPercent: 100,
    });
    expect(first.mappingMatrix).toEqual({
      post: { total: 1, mapped: 1, explicitLegacyException: 0, blocked: 0 },
      course: {
        total: 1,
        mapped: 1,
        explicitLegacyException: 0,
        blocked: 0,
      },
      courseStep: {
        total: 1,
        mapped: 1,
        explicitLegacyException: 0,
        blocked: 0,
      },
      progress: {
        total: 1,
        mapped: 1,
        explicitLegacyException: 0,
        blocked: 0,
      },
      quizAttempt: {
        total: 1,
        mapped: 1,
        explicitLegacyException: 0,
        blocked: 0,
      },
    });
    expect(reordered.sourceFingerprint).toBe(first.sourceFingerprint);
  });

  it('uses separate low-cardinality reasons for video and ownership mapping cases', () => {
    const snapshot = validSnapshot();
    snapshot.posts.push(
      {
        id: '52',
        authorId: '41',
        authorExists: true,
        videoUrl: 'not-a-youtube-url',
        assetVideoId: null,
        assetVideoUrl: null,
      },
      {
        id: '53',
        authorId: '42',
        authorExists: true,
        videoUrl: `https://youtu.be/${VIDEO_A}`,
        assetVideoId: VIDEO_A,
        assetVideoUrl: `https://www.youtube.com/watch?v=${VIDEO_A}`,
      },
      {
        id: '54',
        authorId: '42',
        authorExists: true,
        videoUrl: `https://www.youtube.com/watch?v=${VIDEO_B}`,
        assetVideoId: VIDEO_C,
        assetVideoUrl: `https://youtu.be/${VIDEO_C}`,
      },
    );
    snapshot.courseSteps.push(
      {
        id: '202',
        courseId: '91',
        courseOwnerId: '41',
        courseOwnerExists: true,
        sourcePostId: null,
        sourcePostAuthorId: null,
        sourcePostAuthorExists: false,
        videoUrl: `https://youtu.be/${VIDEO_B}`,
      },
      {
        id: '203',
        courseId: '92',
        courseOwnerId: '42',
        courseOwnerExists: true,
        sourcePostId: '51',
        sourcePostAuthorId: '41',
        sourcePostAuthorExists: true,
        videoUrl: `https://youtu.be/${VIDEO_A}`,
      },
    );
    snapshot.progress.push({
      id: '302',
      userId: '42',
      userExists: true,
      courseStepId: '201',
      courseOwnerId: '41',
      courseOwnerExists: true,
    });
    snapshot.quizAttempts.push({
      id: '402',
      userId: '404',
      userExists: false,
      courseStepId: '201',
      courseOwnerId: '41',
      courseOwnerExists: true,
    });

    const result = classifyLearningMigrationSource(snapshot);

    expect(result.startGatePassed).toBe(false);
    expect(result.reasonCounts).toMatchObject({
      ACTIVE_VIDEO_UNIDENTIFIED: 1,
      ACTIVE_VIDEO_AMBIGUOUS: 1,
      CANONICAL_VIDEO_SHARED: 1,
      COURSE_STEP_SOURCE_POST_MISSING: 1,
      COURSE_POST_OWNER_MISMATCH: 1,
      PROGRESS_USER_OWNER_MISMATCH: 1,
      QUIZ_ATTEMPT_USER_MISSING: 1,
    });
    expect(result.mappingMatrix.courseStep.explicitLegacyException).toBe(1);
    expect(result.mappingMatrix.quizAttempt.blocked).toBe(1);
  });

  it('serializes only counts, fingerprints, and bounded reason codes', () => {
    const snapshot = validSnapshot() as MigrationSourceSnapshot & {
      email: string;
      note: string;
      captionText: string;
    };
    snapshot.email = PRIVATE_EMAIL;
    snapshot.note = PRIVATE_NOTE;
    snapshot.captionText = PRIVATE_CAPTION;

    const serialized = JSON.stringify(
      classifyLearningMigrationSource(snapshot),
    );

    for (const privateValue of [
      PRIVATE_QUERY,
      PRIVATE_NOTE,
      PRIVATE_EMAIL,
      PRIVATE_CAPTION,
      `https://www.youtube.com/watch?v=${VIDEO_A}`,
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it('rejects credentialed, nonstandard-port, and invalid-length video identifiers', () => {
    const snapshot = validSnapshot();
    snapshot.posts = [
      {
        id: '61',
        authorId: '41',
        authorExists: true,
        videoUrl: `https://user@youtube.com/watch?v=${VIDEO_A}`,
        assetVideoId: null,
        assetVideoUrl: null,
      },
      {
        id: '62',
        authorId: '41',
        authorExists: true,
        videoUrl: `https://youtube.com:444/watch?v=${VIDEO_B}`,
        assetVideoId: null,
        assetVideoUrl: null,
      },
      {
        id: '63',
        authorId: '41',
        authorExists: true,
        videoUrl: 'https://www.youtube.com/watch?v=short',
        assetVideoId: 'short',
        assetVideoUrl: null,
      },
    ];
    snapshot.courseSteps = [];
    snapshot.progress = [];
    snapshot.quizAttempts = [];

    const result = classifyLearningMigrationSource(snapshot);

    expect(result.startGatePassed).toBe(false);
    expect(result.reasonCounts.ACTIVE_VIDEO_UNIDENTIFIED).toBe(3);
  });

  it('reads one repeatable snapshot without issuing mutation statements', async () => {
    const snapshot = validSnapshot();
    const statements: string[] = [];
    const query = jest.fn((statement: string) => {
      statements.push(statement);

      if (statement.includes('migration-source:relations')) {
        return {
          rows: [
            {
              courses: true,
              learningProgress: true,
              quizAttempts: true,
            },
          ],
        };
      }
      if (statement.includes('migration-source:posts')) {
        return { rows: snapshot.posts };
      }
      if (statement.includes('migration-source:course-steps')) {
        return { rows: snapshot.courseSteps };
      }
      if (statement.includes('migration-source:courses')) {
        return { rows: snapshot.courses };
      }
      if (statement.includes('migration-source:progress')) {
        return { rows: snapshot.progress };
      }
      if (statement.includes('migration-source:quiz-attempts')) {
        return { rows: snapshot.quizAttempts };
      }
      return { rows: [] };
    });
    const release = jest.fn();
    const pool = {
      connect: jest.fn(() => ({ query, release })),
    } as unknown as Pool;

    const result = await auditLearningMigrationSource(pool);

    expect(result.startGatePassed).toBe(true);
    expect(statements[0]).toBe(
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
    );
    expect(statements.at(-1)).toBe('COMMIT');
    const auditSql = statements.join('\n');
    expect(auditSql).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE)\b/iu,
    );
    expect(auditSql).not.toMatch(
      /\b(?:email|translated_notes|source_segments|translated_segments|transcript_body)\b/iu,
    );
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('keeps the deterministic legacy SQL fixture canonical and privacy-bearing', async () => {
    const fixture = await readFile(
      join(__dirname, '..', 'test', 'fixtures', 'legacy-runtime-schema.sql'),
      'utf8',
    );

    expect(fixture).toContain(
      `https://www.youtube.com/watch?v=${VIDEO_A}&si=${PRIVATE_QUERY}`,
    );
    expect(fixture).toContain(PRIVATE_NOTE);
    expect(fixture).toContain(PRIVATE_EMAIL);
    expect(fixture).toContain(PRIVATE_CAPTION);
  });
});

function validSnapshot(): MigrationSourceSnapshot {
  const videoUrl = `https://www.youtube.com/watch?v=${VIDEO_A}&si=${PRIVATE_QUERY}`;

  return {
    posts: [
      {
        id: '51',
        authorId: '41',
        authorExists: true,
        videoUrl,
        assetVideoId: VIDEO_A,
        assetVideoUrl: `https://youtu.be/${VIDEO_A}`,
      },
    ],
    courses: [{ id: '91', ownerId: '41', ownerExists: true }],
    courseSteps: [
      {
        id: '201',
        courseId: '91',
        courseOwnerId: '41',
        courseOwnerExists: true,
        sourcePostId: '51',
        sourcePostAuthorId: '41',
        sourcePostAuthorExists: true,
        videoUrl,
      },
    ],
    progress: [
      {
        id: '301',
        userId: '41',
        userExists: true,
        courseStepId: '201',
        courseOwnerId: '41',
        courseOwnerExists: true,
      },
    ],
    quizAttempts: [
      {
        id: '401',
        userId: '41',
        userExists: true,
        courseStepId: '201',
        courseOwnerId: '41',
        courseOwnerExists: true,
      },
    ],
  };
}
