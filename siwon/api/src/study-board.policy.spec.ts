import { BadRequestException } from '@nestjs/common';
import {
  assertPostInput,
  createSessionToken,
  hashPassword,
  normalizeBearerToken,
  normalizePreferences,
  toPositiveInteger,
} from './study-board.policy';

describe('study board policy helpers', () => {
  it('normalizes bearer tokens for session lookup', () => {
    expect(normalizeBearerToken('Bearer abc123')).toBe('abc123');
    expect(normalizeBearerToken('abc123')).toBe('abc123');
    expect(normalizeBearerToken(undefined)).toBeUndefined();
  });

  it('keeps password hashing and token generation in one place', () => {
    expect(hashPassword('learn-fast')).toBe(hashPassword('learn-fast'));
    expect(hashPassword('learn-fast')).toHaveLength(64);
    expect(createSessionToken()).toHaveLength(48);
  });

  it('normalizes learning preferences before profile updates', () => {
    expect(
      normalizePreferences({
        interests: [' React ', 'React', 'AI', ''],
        pace: ' 20 minutes ',
        goal: ' Build daily study habits ',
      }),
    ).toEqual({
      interests: ['React', 'AI'],
      pace: '20 minutes',
      goal: 'Build daily study habits',
    });
  });

  it('rejects empty post and preference fields consistently', () => {
    expect(() =>
      assertPostInput({
        title: 'React',
        videoUrl: '',
        summary: 'Summary',
        translatedNotes: 'Notes',
        tags: [],
      }),
    ).toThrow(BadRequestException);

    expect(() =>
      normalizePreferences({
        interests: [],
        pace: '20 minutes',
        goal: 'Build',
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects video posts with more than three tags', () => {
    expect(() =>
      assertPostInput({
        title: 'React',
        videoUrl: 'https://www.youtube.com/watch?v=abc123',
        summary: '리액트 훅을 설명하는 한글 요약입니다.',
        translatedNotes: '리액트 훅 복습 포인트입니다.',
        tags: ['react', 'hooks', 'frontend', 'javascript'],
      }),
    ).toThrow(BadRequestException);
  });

  it('coerces pagination inputs with a safe fallback', () => {
    expect(toPositiveInteger(3, 1)).toBe(3);
    expect(toPositiveInteger(0, 1)).toBe(1);
    expect(toPositiveInteger(undefined, 2)).toBe(2);
  });
});
