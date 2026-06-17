import { createHash } from 'node:crypto';
import type {
  Comment,
  LearningPreferences,
  PlaylistFeedback,
  User,
} from './study-board.types';
import type {
  VideoAsset,
  VideoAssetSegment,
  VideoAssetStatus,
  VideoAssetStepStatus,
  VideoAssetSummarySection,
} from './video-asset.types';

export type UserRow = {
  id: number;
  name: string;
  email: string;
  passwordHash: string;
  preferences: unknown;
  createdAt: Date | string;
};

export type PostRow = {
  id: number;
  authorId: number;
  authorName: string;
  title: string;
  videoUrl: string;
  thumbnailUrl: string;
  channelName: string;
  summary: string;
  translatedNotes: string;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type VideoAssetRow = {
  id: number;
  postId: number;
  videoId: string;
  videoUrl: string;
  language: string;
  sourceLanguage: string;
  status: VideoAssetStatus;
  sourceCaptionStatus: VideoAssetStepStatus;
  translationStatus: VideoAssetStepStatus;
  summaryStatus: VideoAssetStepStatus;
  sourceSegments: unknown;
  translatedSegments: unknown;
  summarySections: unknown;
  transcriptBody: string | null;
  errorMessage: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type RowWithTimestamp<T extends { createdAt: string }> = Omit<
  T,
  'createdAt'
> & {
  createdAt: Date | string;
};

export const DEFAULT_LEARNING_PREFERENCES: LearningPreferences = {
  interests: ['YouTube 학습', '프론트엔드'],
  pace: '하루 20분',
  goal: '짧은 영상으로 꾸준히 복습하기',
};

export const EMPTY_LEARNING_PREFERENCES: LearningPreferences = {
  interests: [],
  pace: '',
  goal: '',
};

export function vectorLiteral(content: string): string {
  const digest = createHash('sha256').update(content).digest();
  const values = Array.from({ length: 64 }, (_, index) => {
    const byte = digest[index % digest.length];
    return ((byte / 255) * 2 - 1).toFixed(5);
  });

  return `[${values.join(',')}]`;
}

export function publicUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    preferences: normalizePreferences(row.preferences),
    createdAt: iso(row.createdAt),
  };
}

export function normalizePreferences(value: unknown): LearningPreferences {
  const fallback = EMPTY_LEARNING_PREFERENCES;

  if (!value || typeof value !== 'object') {
    return fallback;
  }

  const candidate = value as Partial<LearningPreferences>;

  return {
    interests: Array.isArray(candidate.interests)
      ? candidate.interests
          .filter((item): item is string => typeof item === 'string')
          .slice(0, 8)
      : fallback.interests,
    pace: typeof candidate.pace === 'string' ? candidate.pace : fallback.pace,
    goal: typeof candidate.goal === 'string' ? candidate.goal : fallback.goal,
  };
}

export function normalizeComment(comment: RowWithTimestamp<Comment>): Comment {
  return {
    ...comment,
    createdAt: iso(comment.createdAt),
  };
}

export function normalizeFeedback(
  feedback: RowWithTimestamp<PlaylistFeedback>,
): PlaylistFeedback {
  return {
    ...feedback,
    createdAt: iso(feedback.createdAt),
  };
}

export function normalizeVideoAsset(row: VideoAssetRow): VideoAsset {
  return {
    id: row.id,
    postId: row.postId,
    videoId: row.videoId,
    videoUrl: row.videoUrl,
    language: row.language,
    sourceLanguage: row.sourceLanguage,
    status: row.status,
    sourceCaptionStatus: row.sourceCaptionStatus,
    translationStatus: row.translationStatus,
    summaryStatus: row.summaryStatus,
    sourceSegments: normalizeVideoAssetSegments(row.sourceSegments),
    translatedSegments: normalizeVideoAssetSegments(row.translatedSegments),
    summarySections: normalizeVideoAssetSummarySections(row.summarySections),
    transcriptBody: row.transcriptBody ?? '',
    errorMessage: row.errorMessage ?? '',
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function normalizeTagNames(tags: string[]): string[] {
  return [
    ...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)),
  ];
}

export function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function normalizeVideoAssetSegments(value: unknown): VideoAssetSegment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isVideoAssetSegment);
}

function normalizeVideoAssetSummarySections(
  value: unknown,
): VideoAssetSummarySection[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isVideoAssetSummarySection);
}

function isVideoAssetSegment(value: unknown): value is VideoAssetSegment {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as Partial<VideoAssetSegment>).start === 'number' &&
    typeof (value as Partial<VideoAssetSegment>).end === 'number' &&
    typeof (value as Partial<VideoAssetSegment>).text === 'string'
  );
}

function isVideoAssetSummarySection(
  value: unknown,
): value is VideoAssetSummarySection {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as Partial<VideoAssetSummarySection>).label === 'string' &&
    typeof (value as Partial<VideoAssetSummarySection>).body === 'string'
  );
}
