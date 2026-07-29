import { CourseCutoverPolicy } from './course-cutover.policy';
import type { CourseRepository } from './course.repository';
import { CourseService } from './course.service';

describe('CourseService', () => {
  it('hashes an idempotency key and canonical payload before creating a private draft', async () => {
    const create: jest.MockedFunction<CourseRepository['create']> = jest.fn();
    create.mockResolvedValue(ownerCourse());
    const service = new CourseService(
      { create } as unknown as CourseRepository,
      new CourseCutoverPolicy('course'),
    );

    await expect(
      service.createCourse(7, 'browser-draft-1', {
        title: '  PostgreSQL Races  ',
        description: ' proof ',
        steps: [
          {
            snapshot: {
              title: 'Locking',
              videoUrl: 'https://video.example/locking',
              thumbnailUrl: '',
              channelName: 'DB Lab',
            },
          },
        ],
      }),
    ).resolves.toMatchObject({
      id: 41,
      title: 'PostgreSQL Races',
      status: 'draft',
      version: 1,
    });

    const command = create.mock.calls[0][0];
    expect(command.ownerId).toBe(7);
    expect(command.idempotencyKeyDigest).toBeInstanceOf(Buffer);
    expect(command.payloadHash).toBeInstanceOf(Buffer);
    expect(command.course).toMatchObject({
      title: 'PostgreSQL Races',
      description: 'proof',
    });
  });
});

function ownerCourse() {
  return {
    id: 41,
    ownerId: 7,
    title: 'PostgreSQL Races',
    description: 'proof',
    visibility: 'private' as const,
    status: 'draft' as const,
    version: 1,
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
    publishedAt: null,
    archivedAt: null,
    steps: [],
    feedback: [],
  };
}
