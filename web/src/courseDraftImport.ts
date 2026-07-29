import {
  removePlaylistDraft,
  type PlaylistDraft,
  type PlaylistDraftState,
} from './playlistDrafts.ts';
import type {
  Course,
  CourseLearningMark,
  CourseLearningState,
  CreateCourseInput,
  NewCourseStep,
} from './types.ts';
import {
  DEFAULT_LEARNING_STATE,
  PLAYBACK_RATES,
  getVideoLearningState,
  type QueueVideo,
} from './watchQueue.ts';

const PENDING_IMPORT_STORAGE_PREFIX = 'studytube.courseImport';

export type CourseImportEnvelope = {
  userId: number;
  draftId: string;
  revision: number;
  idempotencyKey: string;
  canonicalPayload: string;
  payload: CreateCourseInput;
  savedCourse?: Course;
};

export class CourseImportSupersededError extends Error {
  constructor() {
    super('Course import belongs to a different user or draft revision');
    this.name = 'CourseImportSupersededError';
  }
}

export function buildCourseImportEnvelope(
  userId: number,
  draft: PlaylistDraft<QueueVideo>,
): CourseImportEnvelope {
  const payload: CreateCourseInput = {
    title: draft.title.trim() || '학습 코스',
    description: draft.description.trim(),
    steps: draft.videos.map(courseStepFromQueueVideo),
  };
  const canonicalPayload = canonicalJson(payload);
  const revision = draft.revision;
  const draftDigest = stableHash(draft.id);

  return {
    userId,
    draftId: draft.id,
    revision,
    idempotencyKey: `course-import:v1:u${userId}:d${draftDigest}:r${revision}`,
    canonicalPayload,
    payload,
  };
}

export function savePendingCourseImport(
  envelope: CourseImportEnvelope,
  storage: Storage = window.localStorage,
) {
  const baseKey = pendingImportStorageKey(envelope.userId, envelope.draftId);
  storage.setItem(
    pendingImportRevisionStorageKey(baseKey, envelope.revision),
    JSON.stringify(envelope),
  );
  storage.setItem(baseKey, String(envelope.revision));
}

export function readPendingCourseImport(
  userId: number,
  draftId: string,
  storage: Storage = window.localStorage,
  revision?: number,
): CourseImportEnvelope | null {
  try {
    const baseKey = pendingImportStorageKey(userId, draftId);
    const pointer = storage.getItem(baseKey);
    const selectedRevision = revision ?? Number(pointer);
    const raw = Number.isSafeInteger(selectedRevision) && selectedRevision > 0
      ? storage.getItem(pendingImportRevisionStorageKey(baseKey, selectedRevision))
      : pointer;
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as CourseImportEnvelope;
    return isPendingEnvelope(parsed, userId, draftId) ? parsed : null;
  } catch {
    return null;
  }
}

export async function importCourseDraft({
  userId,
  draft,
  storage = window.localStorage,
  activeUserId,
  create,
  publish,
  complete,
}: {
  userId: number;
  draft: PlaylistDraft<QueueVideo>;
  storage?: Storage;
  activeUserId: () => number | null;
  create: (
    input: CreateCourseInput,
    idempotencyKey: string,
  ) => Promise<Course>;
  publish: (courseId: number, expectedVersion: number) => Promise<Course>;
  complete: (envelope: CourseImportEnvelope, course: Course) => void;
}): Promise<Course> {
  const candidate = buildCourseImportEnvelope(userId, draft);
  let envelope = readPendingCourseImport(
    userId,
    draft.id,
    storage,
    draft.revision,
  );

  if (!envelope || envelope.revision !== draft.revision) {
    envelope = candidate;
    savePendingCourseImport(envelope, storage);
  }

  assertActiveImport(envelope, activeUserId());

  let result = envelope.savedCourse;
  if (!result) {
    result = await create(envelope.payload, envelope.idempotencyKey);
    const savedEnvelope: CourseImportEnvelope = {
      ...envelope,
      savedCourse: result,
    };
    replacePendingEnvelope(envelope, savedEnvelope, storage);
    envelope = savedEnvelope;
  }

  if (result.status === 'draft') {
    result = await publish(result.id, result.version);
    const publishedEnvelope: CourseImportEnvelope = {
      ...envelope,
      savedCourse: result,
    };
    replacePendingEnvelope(envelope, publishedEnvelope, storage);
    envelope = publishedEnvelope;
  }

  if (result.status !== 'published') {
    throw new Error('Course import was acknowledged without publication');
  }

  assertActiveImport(envelope, activeUserId());
  const current = readPendingCourseImport(
    userId,
    draft.id,
    storage,
    envelope.revision,
  );
  if (!current || !sameEnvelopeIdentity(current, envelope)) {
    throw new CourseImportSupersededError();
  }

  complete(envelope, result);
  clearPendingCourseImport(envelope, storage);
  return result;
}

export function completeImportedPlaylistDraft<TVideo>(
  state: PlaylistDraftState<TVideo>,
  envelope: Pick<CourseImportEnvelope, 'userId' | 'draftId' | 'revision'>,
  activeUserId: number,
  replacementDraft: PlaylistDraft<TVideo>,
) {
  const matchingDraft = state.drafts.find(
    (draft) => draft.id === envelope.draftId,
  );
  if (
    activeUserId !== envelope.userId ||
    !matchingDraft ||
    matchingDraft.revision !== envelope.revision
  ) {
    return state;
  }
  return removePlaylistDraft(state, envelope.draftId, replacementDraft);
}

function courseStepFromQueueVideo(video: QueueVideo): NewCourseStep {
  const postId = video.id.match(/^(?:post|rag)-([1-9]\d*)$/)?.[1];
  const ownerLearningState = sanitizeLearningState(video);

  if (postId && Number.isSafeInteger(Number(postId))) {
    return { sourcePostId: Number(postId), ownerLearningState };
  }

  return {
    snapshot: {
      title: video.title.trim() || '학습 영상',
      videoUrl: video.videoUrl,
      thumbnailUrl: video.thumbnailUrl || '',
      channelName: video.channelName.trim(),
    },
    ownerLearningState,
  };
}

function sanitizeLearningState(video: QueueVideo): CourseLearningState {
  const normalized = getVideoLearningState(video);
  const start = finiteNonNegative(normalized.loop.start)
    ? normalized.loop.start
    : DEFAULT_LEARNING_STATE.loop.start;
  const end =
    finiteNonNegative(normalized.loop.end) && normalized.loop.end > start
      ? normalized.loop.end
      : Math.max(start + 1, DEFAULT_LEARNING_STATE.loop.end);
  const playbackRate = PLAYBACK_RATES.includes(normalized.playbackRate)
    ? normalized.playbackRate
    : DEFAULT_LEARNING_STATE.playbackRate;

  return {
    captionLanguage:
      normalized.captionLanguage === 'en' ? 'en' : DEFAULT_LEARNING_STATE.captionLanguage,
    captionsEnabled: normalized.captionsEnabled,
    playbackRate: playbackRate as CourseLearningState['playbackRate'],
    loop: {
      enabled: Boolean(normalized.loop.enabled),
      manual: Boolean(normalized.loop.manual),
      start,
      end,
    },
    marks: normalized.marks.map(sanitizeMark).filter(isCourseLearningMark),
  };
}

function sanitizeMark(mark: CourseLearningMark): CourseLearningMark | null {
  const id = typeof mark.id === 'string' ? mark.id.trim() : '';
  const note = typeof mark.note === 'string' ? mark.note.trim() : '';
  const caption = typeof mark.caption === 'string' ? mark.caption : '';
  if (
    !id ||
    id.length > 128 ||
    !note ||
    note.length > 2_000 ||
    caption.length > 2_000 ||
    !finiteNonNegative(mark.start) ||
    !finiteNonNegative(mark.end) ||
    mark.end <= mark.start ||
    typeof mark.createdAt !== 'string' ||
    Number.isNaN(Date.parse(mark.createdAt))
  ) {
    return null;
  }
  return { ...mark, id, note, caption };
}

function isCourseLearningMark(
  mark: CourseLearningMark | null,
): mark is CourseLearningMark {
  return mark !== null;
}

function finiteNonNegative(value: number) {
  return Number.isFinite(value) && value >= 0;
}

function replacePendingEnvelope(
  previous: CourseImportEnvelope,
  next: CourseImportEnvelope,
  storage: Storage,
) {
  const current = readPendingCourseImport(
    previous.userId,
    previous.draftId,
    storage,
    previous.revision,
  );
  if (!current || !sameEnvelopeIdentity(current, previous)) {
    throw new CourseImportSupersededError();
  }
  savePendingCourseImport(next, storage);
}

function assertActiveImport(
  envelope: CourseImportEnvelope,
  activeUserId: number | null,
) {
  if (activeUserId !== envelope.userId) {
    throw new CourseImportSupersededError();
  }
}

function sameEnvelopeIdentity(
  left: CourseImportEnvelope,
  right: CourseImportEnvelope,
) {
  return (
    left.userId === right.userId &&
    left.draftId === right.draftId &&
    left.revision === right.revision &&
    left.idempotencyKey === right.idempotencyKey &&
    left.canonicalPayload === right.canonicalPayload
  );
}

function isPendingEnvelope(
  value: CourseImportEnvelope,
  userId: number,
  draftId: string,
) {
  return (
    Boolean(value) &&
    value.userId === userId &&
    value.draftId === draftId &&
    Number.isSafeInteger(value.revision) &&
    value.revision > 0 &&
    typeof value.idempotencyKey === 'string' &&
    typeof value.canonicalPayload === 'string' &&
    Boolean(value.payload)
  );
}

function pendingImportStorageKey(userId: number, draftId: string) {
  return `${PENDING_IMPORT_STORAGE_PREFIX}:user-${userId}:draft-${encodeURIComponent(draftId)}`;
}

function pendingImportRevisionStorageKey(baseKey: string, revision: number) {
  return `${baseKey}:revision-${revision}`;
}

function clearPendingCourseImport(
  envelope: CourseImportEnvelope,
  storage: Storage,
) {
  const baseKey = pendingImportStorageKey(envelope.userId, envelope.draftId);
  storage.removeItem(pendingImportRevisionStorageKey(baseKey, envelope.revision));
  if (storage.getItem(baseKey) === String(envelope.revision)) {
    storage.removeItem(baseKey);
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
