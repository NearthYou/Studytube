import { createHash } from 'node:crypto';
import type {
  Comment,
  LearningPreferences,
  PlaylistFeedback,
  User,
} from './study-board.types';

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
  const fallback = DEFAULT_LEARNING_PREFERENCES;

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

export function normalizeTagNames(tags: string[]): string[] {
  return [
    ...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)),
  ];
}

export function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
