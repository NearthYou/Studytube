import { createHash } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';

const REASON_CODES = [
  'ACTIVE_VIDEO_UNIDENTIFIED',
  'ACTIVE_VIDEO_AMBIGUOUS',
  'CANONICAL_VIDEO_SHARED',
  'COURSE_STEP_VIDEO_MISMATCH',
  'POST_AUTHOR_MISSING',
  'COURSE_OWNER_MISSING',
  'COURSE_STEP_SOURCE_POST_MISSING',
  'COURSE_POST_OWNER_MISMATCH',
  'PROGRESS_CONTEXT_MISSING',
  'PROGRESS_USER_MISSING',
  'PROGRESS_USER_OWNER_MISMATCH',
  'QUIZ_ATTEMPT_CONTEXT_MISSING',
  'QUIZ_ATTEMPT_USER_MISSING',
  'QUIZ_ATTEMPT_USER_OWNER_MISMATCH',
] as const;

const BLOCKING_REASONS = new Set<MigrationSourceReasonCode>([
  'ACTIVE_VIDEO_UNIDENTIFIED',
  'ACTIVE_VIDEO_AMBIGUOUS',
  'COURSE_STEP_VIDEO_MISMATCH',
  'POST_AUTHOR_MISSING',
  'COURSE_OWNER_MISSING',
  'PROGRESS_CONTEXT_MISSING',
  'PROGRESS_USER_MISSING',
  'QUIZ_ATTEMPT_CONTEXT_MISSING',
  'QUIZ_ATTEMPT_USER_MISSING',
]);

const EXPLICIT_EXCEPTION_REASONS = new Set<MigrationSourceReasonCode>([
  'COURSE_STEP_SOURCE_POST_MISSING',
]);

type MigrationEntityKind =
  | 'post'
  | 'course'
  | 'courseStep'
  | 'progress'
  | 'quizAttempt';

export type MigrationSourceReasonCode = (typeof REASON_CODES)[number];

export interface PostSourceRow {
  id: string;
  authorId: string;
  authorExists: boolean;
  videoUrl: string;
  assetVideoId: string | null;
  assetVideoUrl: string | null;
}

export interface CourseStepSourceRow {
  id: string;
  courseId: string;
  courseOwnerId: string | null;
  courseOwnerExists: boolean;
  sourcePostId: string | null;
  sourcePostExists?: boolean;
  sourcePostAuthorId: string | null;
  sourcePostAuthorExists: boolean;
  videoUrl: string;
}

export interface CourseSourceRow {
  id: string;
  ownerId: string;
  ownerExists: boolean;
}

export interface ProgressSourceRow {
  id: string;
  userId: string;
  userExists: boolean;
  courseStepId: string;
  courseStepExists?: boolean;
  courseOwnerId: string | null;
  courseOwnerExists: boolean;
}

export interface QuizAttemptSourceRow {
  id: string;
  userId: string;
  userExists: boolean;
  courseStepId: string | null;
  courseStepExists?: boolean;
  courseOwnerId: string | null;
  courseOwnerExists: boolean;
}

export interface MigrationSourceSnapshot {
  posts: PostSourceRow[];
  courses: CourseSourceRow[];
  courseSteps: CourseStepSourceRow[];
  progress: ProgressSourceRow[];
  quizAttempts: QuizAttemptSourceRow[];
}

export interface MappingCount {
  total: number;
  mapped: number;
  explicitLegacyException: number;
  blocked: number;
}

export interface MigrationSourceAuditResult {
  startGatePassed: boolean;
  blockerCount: number;
  sourceFingerprint: string;
  canonicalVideos: {
    activeSources: number;
    identified: number;
    identificationPercent: number;
  };
  ownership: {
    learningBearingRows: number;
    mapped: number;
    mappingPercent: number;
  };
  mappingMatrix: Record<MigrationEntityKind, MappingCount>;
  reasonCounts: Record<MigrationSourceReasonCode, number>;
}

interface ClassifiedRow {
  kind: MigrationEntityKind;
  id: string;
  canonicalVideoId: string | null;
  ownerMapped: boolean;
  reasons: MigrationSourceReasonCode[];
}

interface RelationsRow {
  courses: boolean;
  learningProgress: boolean;
  quizAttempts: boolean;
}

export async function auditLearningMigrationSource(
  pool: Pick<Pool, 'connect'>,
): Promise<MigrationSourceAuditResult> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');

    try {
      const snapshot = await readMigrationSourceSnapshot(client);
      const result = classifyLearningMigrationSource(snapshot);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    client.release();
  }
}

export function classifyLearningMigrationSource(
  snapshot: MigrationSourceSnapshot,
): MigrationSourceAuditResult {
  const rows: ClassifiedRow[] = [];
  const postsById = new Map<string, ClassifiedRow>();

  for (const post of snapshot.posts) {
    const video = resolveCanonicalVideo(
      [post.videoUrl, post.assetVideoUrl],
      [post.assetVideoId],
    );
    const reasons = videoReasons(video);

    if (!post.authorExists) reasons.push('POST_AUTHOR_MISSING');

    const classified: ClassifiedRow = {
      kind: 'post',
      id: post.id,
      canonicalVideoId: video.id,
      ownerMapped: post.authorExists,
      reasons,
    };
    postsById.set(post.id, classified);
    rows.push(classified);
  }

  for (const course of snapshot.courses) {
    const reasons: MigrationSourceReasonCode[] = [];
    if (!course.ownerExists) reasons.push('COURSE_OWNER_MISSING');

    rows.push({
      kind: 'course',
      id: course.id,
      canonicalVideoId: null,
      ownerMapped: course.ownerExists,
      reasons,
    });
  }

  for (const step of snapshot.courseSteps) {
    const video = resolveCanonicalVideo([step.videoUrl]);
    const reasons = videoReasons(video);
    const sourcePostExists =
      step.sourcePostExists ?? step.sourcePostId !== null;

    if (!step.courseOwnerExists) reasons.push('COURSE_OWNER_MISSING');

    if (step.sourcePostId === null || !sourcePostExists) {
      reasons.push('COURSE_STEP_SOURCE_POST_MISSING');
    } else {
      if (!step.sourcePostAuthorExists) reasons.push('POST_AUTHOR_MISSING');

      if (
        step.sourcePostAuthorId !== null &&
        step.sourcePostAuthorId !== step.courseOwnerId
      ) {
        reasons.push('COURSE_POST_OWNER_MISMATCH');
      }

      const sourcePost = postsById.get(step.sourcePostId);
      if (
        video.id !== null &&
        sourcePost?.canonicalVideoId !== null &&
        sourcePost?.canonicalVideoId !== undefined &&
        sourcePost.canonicalVideoId !== video.id
      ) {
        reasons.push('COURSE_STEP_VIDEO_MISMATCH');
      }
    }

    rows.push({
      kind: 'courseStep',
      id: step.id,
      canonicalVideoId: video.id,
      ownerMapped:
        step.courseOwnerExists &&
        (step.sourcePostId === null ||
          !sourcePostExists ||
          step.sourcePostAuthorExists),
      reasons,
    });
  }

  for (const progress of snapshot.progress) {
    const reasons: MigrationSourceReasonCode[] = [];
    const contextExists = progress.courseStepExists ?? true;

    if (!contextExists || !progress.courseOwnerExists) {
      reasons.push('PROGRESS_CONTEXT_MISSING');
    }
    if (!progress.userExists) reasons.push('PROGRESS_USER_MISSING');
    if (
      progress.userExists &&
      progress.courseOwnerExists &&
      progress.courseOwnerId !== progress.userId
    ) {
      reasons.push('PROGRESS_USER_OWNER_MISMATCH');
    }

    rows.push({
      kind: 'progress',
      id: progress.id,
      canonicalVideoId: null,
      ownerMapped:
        contextExists && progress.courseOwnerExists && progress.userExists,
      reasons,
    });
  }

  for (const attempt of snapshot.quizAttempts) {
    const reasons: MigrationSourceReasonCode[] = [];
    const contextExists = attempt.courseStepExists ?? true;

    if (!contextExists || !attempt.courseOwnerExists) {
      reasons.push('QUIZ_ATTEMPT_CONTEXT_MISSING');
    }
    if (!attempt.userExists) reasons.push('QUIZ_ATTEMPT_USER_MISSING');
    if (
      attempt.userExists &&
      attempt.courseOwnerExists &&
      attempt.courseOwnerId !== attempt.userId
    ) {
      reasons.push('QUIZ_ATTEMPT_USER_OWNER_MISMATCH');
    }

    rows.push({
      kind: 'quizAttempt',
      id: attempt.id,
      canonicalVideoId: null,
      ownerMapped:
        contextExists && attempt.courseOwnerExists && attempt.userExists,
      reasons,
    });
  }

  const reasonCounts = emptyReasonCounts();
  for (const row of rows) {
    for (const reason of row.reasons) reasonCounts[reason] += 1;
  }

  const sharedCanonicalVideos = countSharedCanonicalVideos(
    rows.filter((row) => row.kind === 'post'),
  );
  reasonCounts.CANONICAL_VIDEO_SHARED = sharedCanonicalVideos;

  const mappingMatrix = emptyMappingMatrix();
  for (const row of rows) {
    const counts = mappingMatrix[row.kind];
    counts.total += 1;

    if (row.reasons.some((reason) => BLOCKING_REASONS.has(reason))) {
      counts.blocked += 1;
    } else if (
      row.reasons.some((reason) => EXPLICIT_EXCEPTION_REASONS.has(reason))
    ) {
      counts.explicitLegacyException += 1;
    } else {
      counts.mapped += 1;
    }
  }

  const activeVideoRows = rows.filter(
    (row) => row.kind === 'post' || row.kind === 'courseStep',
  );
  const ownershipMapped = rows.filter((row) => row.ownerMapped).length;
  const blockerCount = Object.values(mappingMatrix).reduce(
    (sum, counts) => sum + counts.blocked,
    0,
  );

  return {
    startGatePassed: blockerCount === 0,
    blockerCount,
    sourceFingerprint: fingerprint(rows, sharedCanonicalVideos),
    canonicalVideos: {
      activeSources: activeVideoRows.length,
      identified: activeVideoRows.filter((row) => row.canonicalVideoId !== null)
        .length,
      identificationPercent: percentage(
        activeVideoRows.filter((row) => row.canonicalVideoId !== null).length,
        activeVideoRows.length,
      ),
    },
    ownership: {
      learningBearingRows: rows.length,
      mapped: ownershipMapped,
      mappingPercent: percentage(ownershipMapped, rows.length),
    },
    mappingMatrix,
    reasonCounts,
  };
}

async function readMigrationSourceSnapshot(
  client: PoolClient,
): Promise<MigrationSourceSnapshot> {
  const relations = await client.query<RelationsRow>(`
    /* migration-source:relations */
    SELECT to_regclass('public.courses') IS NOT NULL AS courses,
           to_regclass('public.learning_progress') IS NOT NULL
             AS "learningProgress",
           to_regclass('public.quiz_attempts') IS NOT NULL AS "quizAttempts"
  `);
  const availability = relations.rows[0] ?? {
    courses: false,
    learningProgress: false,
    quizAttempts: false,
  };
  const posts = await client.query<PostSourceRow>(`
    /* migration-source:posts */
    SELECT post.id::text AS id,
           post.author_id::text AS "authorId",
           owner.id IS NOT NULL AS "authorExists",
           post.video_url AS "videoUrl",
           asset.video_id AS "assetVideoId",
           asset.video_url AS "assetVideoUrl"
    FROM posts AS post
    LEFT JOIN users AS owner ON owner.id = post.author_id
    LEFT JOIN video_assets AS asset ON asset.post_id = post.id
    ORDER BY post.id
  `);
  const courseSteps = availability.courses
    ? await client.query<CourseStepSourceRow>(`
        /* migration-source:course-steps */
        SELECT step.id::text AS id,
               step.course_id::text AS "courseId",
               course.owner_id::text AS "courseOwnerId",
               course_owner.id IS NOT NULL AS "courseOwnerExists",
               step.source_post_id::text AS "sourcePostId",
               source_post.id IS NOT NULL AS "sourcePostExists",
               source_post.author_id::text AS "sourcePostAuthorId",
               post_author.id IS NOT NULL AS "sourcePostAuthorExists",
               step.video_url_snapshot AS "videoUrl"
        FROM course_steps AS step
        LEFT JOIN courses AS course ON course.id = step.course_id
        LEFT JOIN users AS course_owner ON course_owner.id = course.owner_id
        LEFT JOIN posts AS source_post ON source_post.id = step.source_post_id
        LEFT JOIN users AS post_author ON post_author.id = source_post.author_id
        ORDER BY step.id
      `)
    : { rows: [] as CourseStepSourceRow[] };
  const courses = availability.courses
    ? await client.query<CourseSourceRow>(`
        /* migration-source:courses */
        SELECT course.id::text AS id,
               course.owner_id::text AS "ownerId",
               owner.id IS NOT NULL AS "ownerExists"
        FROM courses AS course
        LEFT JOIN users AS owner ON owner.id = course.owner_id
        ORDER BY course.id
      `)
    : { rows: [] as CourseSourceRow[] };
  const progress = availability.learningProgress
    ? await client.query<ProgressSourceRow>(`
        /* migration-source:progress */
        SELECT progress.id::text AS id,
               progress.user_id::text AS "userId",
               progress_owner.id IS NOT NULL AS "userExists",
               progress.course_step_id::text AS "courseStepId",
               step.id IS NOT NULL AS "courseStepExists",
               course.owner_id::text AS "courseOwnerId",
               course_owner.id IS NOT NULL AS "courseOwnerExists"
        FROM (
          SELECT 'aggregate:' || id::text AS id, user_id, course_step_id
          FROM learning_progress
          UNION ALL
          SELECT 'event:' || id::text AS id, user_id, course_step_id
          FROM learning_progress_events
        ) AS progress
        LEFT JOIN users AS progress_owner ON progress_owner.id = progress.user_id
        LEFT JOIN course_steps AS step ON step.id = progress.course_step_id
        LEFT JOIN courses AS course ON course.id = step.course_id
        LEFT JOIN users AS course_owner ON course_owner.id = course.owner_id
        ORDER BY progress.id
      `)
    : { rows: [] as ProgressSourceRow[] };
  const quizAttempts = availability.quizAttempts
    ? await client.query<QuizAttemptSourceRow>(`
        /* migration-source:quiz-attempts */
        SELECT attempt.id::text AS id,
               attempt.user_id::text AS "userId",
               attempt_owner.id IS NOT NULL AS "userExists",
               quiz.course_step_id::text AS "courseStepId",
               step.id IS NOT NULL AS "courseStepExists",
               course.owner_id::text AS "courseOwnerId",
               course_owner.id IS NOT NULL AS "courseOwnerExists"
        FROM quiz_attempts AS attempt
        LEFT JOIN users AS attempt_owner ON attempt_owner.id = attempt.user_id
        LEFT JOIN quizzes AS quiz ON quiz.id = attempt.quiz_id
        LEFT JOIN course_steps AS step ON step.id = quiz.course_step_id
        LEFT JOIN courses AS course ON course.id = step.course_id
        LEFT JOIN users AS course_owner ON course_owner.id = course.owner_id
        ORDER BY attempt.id
      `)
    : { rows: [] as QuizAttemptSourceRow[] };

  return {
    posts: posts.rows,
    courses: courses.rows,
    courseSteps: courseSteps.rows,
    progress: progress.rows,
    quizAttempts: quizAttempts.rows,
  };
}

function resolveCanonicalVideo(
  urls: Array<string | null>,
  directIds: Array<string | null> = [],
): { id: string | null; ambiguous: boolean } {
  const candidates = new Set<string>();

  for (const url of urls) {
    if (url === null) continue;

    for (const candidate of canonicalVideoIds(url)) {
      candidates.add(candidate);
    }
  }

  for (const directId of directIds) {
    const candidate = canonicalVideoId(directId);
    if (candidate !== null) candidates.add(candidate);
  }

  return {
    id: candidates.size === 1 ? [...candidates][0] : null,
    ambiguous: candidates.size > 1,
  };
}

function canonicalVideoIds(value: string): string[] {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      (url.port !== '' && url.port !== '443')
    ) {
      return [];
    }

    const host = url.hostname.toLowerCase().replace(/^www\./u, '');
    const path = url.pathname.split('/').filter(Boolean);

    if (host === 'youtu.be') {
      const id = canonicalVideoId(path[0] ?? null);
      return id === null ? [] : [id];
    }

    if (
      host !== 'youtube.com' &&
      host !== 'm.youtube.com' &&
      host !== 'youtube-nocookie.com'
    ) {
      return [];
    }

    const values =
      url.pathname === '/watch'
        ? url.searchParams.getAll('v')
        : ['embed', 'shorts', 'live'].includes(path[0] ?? '')
          ? [path[1]]
          : [];

    return [
      ...new Set(
        values
          .map((candidate) => canonicalVideoId(candidate))
          .filter((candidate): candidate is string => candidate !== null),
      ),
    ];
  } catch {
    return [];
  }
}

function canonicalVideoId(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return /^[A-Za-z0-9_-]{11}$/u.test(normalized) ? normalized : null;
}

function videoReasons(video: {
  id: string | null;
  ambiguous: boolean;
}): MigrationSourceReasonCode[] {
  if (video.ambiguous) return ['ACTIVE_VIDEO_AMBIGUOUS'];
  return video.id === null ? ['ACTIVE_VIDEO_UNIDENTIFIED'] : [];
}

function countSharedCanonicalVideos(rows: ClassifiedRow[]): number {
  const postsByVideo = new Map<string, number>();

  for (const row of rows) {
    if (row.canonicalVideoId === null) continue;
    postsByVideo.set(
      row.canonicalVideoId,
      (postsByVideo.get(row.canonicalVideoId) ?? 0) + 1,
    );
  }

  return [...postsByVideo.values()].filter((count) => count > 1).length;
}

function emptyReasonCounts(): Record<MigrationSourceReasonCode, number> {
  return Object.fromEntries(REASON_CODES.map((code) => [code, 0])) as Record<
    MigrationSourceReasonCode,
    number
  >;
}

function emptyMappingMatrix(): Record<MigrationEntityKind, MappingCount> {
  return {
    post: emptyMappingCount(),
    course: emptyMappingCount(),
    courseStep: emptyMappingCount(),
    progress: emptyMappingCount(),
    quizAttempt: emptyMappingCount(),
  };
}

function emptyMappingCount(): MappingCount {
  return { total: 0, mapped: 0, explicitLegacyException: 0, blocked: 0 };
}

function percentage(numerator: number, denominator: number): number {
  return denominator === 0
    ? 100
    : Math.round((numerator / denominator) * 10_000) / 100;
}

function fingerprint(rows: ClassifiedRow[], sharedVideos: number): string {
  const normalized = rows
    .map((row) => ({
      kind: row.kind,
      id: row.id,
      canonicalVideoId: row.canonicalVideoId,
      ownerMapped: row.ownerMapped,
      reasons: [...row.reasons].sort(),
    }))
    .sort((left, right) =>
      `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`),
    );

  return createHash('sha256')
    .update(JSON.stringify({ rows: normalized, sharedVideos }), 'utf8')
    .digest('hex');
}

function requiredDatabaseUrl(environment: NodeJS.ProcessEnv = process.env) {
  const value = environment.DATABASE_URL?.trim();
  if (!value) throw new Error('DATABASE_URL must be set');
  return value;
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: requiredDatabaseUrl() });

  try {
    const result = await auditLearningMigrationSource(pool);
    console.log(JSON.stringify(result));
    if (!result.startGatePassed) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
