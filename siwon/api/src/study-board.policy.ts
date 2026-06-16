import { BadRequestException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { CreatePostInput, LearningPreferences } from './study-board.types';

export type Credentials = {
  email: string;
  password: string;
};

export function normalizeBearerToken(token?: string): string | undefined {
  if (!token) {
    return undefined;
  }

  return token.replace(/^Bearer\s+/i, '').trim();
}

export function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex');
}

export function createSessionToken(): string {
  return randomBytes(24).toString('hex');
}

export function assertPostInput(input: Omit<CreatePostInput, 'authorId'>) {
  assertText(input.title, 'title');
  assertText(input.videoUrl, 'videoUrl');
  assertText(input.summary, 'summary');
  assertText(input.translatedNotes, 'translatedNotes');
  assertVideoTags(input.tags);
}

export function assertVideoTags(tags: string[] | undefined) {
  if ((tags ?? []).filter((tag) => tag.trim()).length > 3) {
    throw new BadRequestException('tags must contain at most 3 items');
  }
}

export function normalizePreferences(
  input: LearningPreferences,
): LearningPreferences {
  const interests = [
    ...new Set(
      (input.interests ?? [])
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .slice(0, 8),
    ),
  ];
  const pace = input.pace?.trim();
  const goal = input.goal?.trim();

  if (interests.length === 0) {
    throw new BadRequestException('preferences.interests is required');
  }

  assertText(pace, 'preferences.pace');
  assertText(goal, 'preferences.goal');

  return {
    interests,
    pace,
    goal,
  };
}

export function assertEmail(email: string) {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException('email must be valid');
  }
}

export function assertPassword(password: string) {
  if (!password || password.length < 6) {
    throw new BadRequestException('password must be at least 6 characters');
  }
}

export function assertText(value: string | undefined, field: string) {
  if (!value?.trim()) {
    throw new BadRequestException(`${field} is required`);
  }
}

export function toPositiveInteger(
  value: number | undefined,
  fallback: number,
): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
}
