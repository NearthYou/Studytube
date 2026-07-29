import { BadRequestException } from '@nestjs/common';
import { assertPostInput, toPositiveInteger } from './study-board.policy';

describe('study board policy helpers', () => {
  it('rejects empty post fields consistently', () => {
    expect(() =>
      assertPostInput({
        title: 'React',
        videoUrl: '',
        summary: 'Summary',
        translatedNotes: 'Notes',
        tags: [],
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
