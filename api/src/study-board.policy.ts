import { BadRequestException } from '@nestjs/common';
import type { CreatePostInput } from './study-board.types';

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
