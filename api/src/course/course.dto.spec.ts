import { ValidationPipe, type ArgumentMetadata } from '@nestjs/common';
import { CreateCourseDto, ReplaceCourseStepsDto, UpdateCourseDto } from './dto';

const validationPipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  forbidUnknownValues: true,
});

async function validateBody<T>(metatype: new () => T, value: unknown) {
  const metadata: ArgumentMetadata = { type: 'body', metatype };
  const transformed: unknown = await validationPipe.transform(value, metadata);
  return transformed as T;
}

describe('Course transport DTOs', () => {
  it('rejects an owner identity supplied by the client', async () => {
    await expect(
      validateBody(CreateCourseDto, {
        ownerId: 7,
        title: 'PostgreSQL concurrency',
        description: 'Locking and optimistic versioning',
        steps: [],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects a create step that mixes source-post and existing-step identity', async () => {
    await expect(
      validateBody(CreateCourseDto, {
        title: 'PostgreSQL concurrency',
        description: 'Locking and optimistic versioning',
        steps: [{ sourcePostId: 13, stepId: '91' }],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects non-integer optimistic versions and oversized metadata', async () => {
    await expect(
      validateBody(UpdateCourseDto, {
        expectedVersion: 1.5,
        title: 'x'.repeat(201),
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects malformed nested owner learning state', async () => {
    await expect(
      validateBody(ReplaceCourseStepsDto, {
        expectedVersion: 1,
        steps: [
          {
            snapshot: {
              title: 'Row locks',
              videoUrl: 'https://www.youtube.com/watch?v=abc123',
              thumbnailUrl: '',
              channelName: 'Database School',
            },
            ownerLearningState: {
              captionLanguage: 'ko',
              captionsEnabled: true,
              playbackRate: 3,
              loop: { enabled: true, manual: true, start: 30, end: 10 },
              marks: [],
            },
          },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
