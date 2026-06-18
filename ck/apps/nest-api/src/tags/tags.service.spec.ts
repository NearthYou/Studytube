import { TagsService } from './tags.service';

describe('TagsService', () => {
  const now = new Date('2026-06-12T00:00:00.000Z');

  const makePrisma = () => ({
    tag: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    seatReview: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  });

  const tag = {
    id: 2n,
    name: '시야좋음',
    type: 'seat_feature',
    createdAt: now,
  };

  const review = {
    id: 11n,
    authorId: 7n,
    theaterId: 3n,
    musicalId: 5n,
    performanceId: 9n,
    seatFloor: '1F',
    seatSection: null,
    seatRow: 'A',
    seatNumber: '12',
    viewRating: 5,
    soundRating: 4,
    comfortRating: 3,
    expressionRating: 5,
    stageVisibilityRating: 4,
    content: 'Great view from this seat.',
    createdAt: now,
    updatedAt: now,
    author: {
      id: 7n,
      nickname: 'musical-fan',
    },
    theater: {
      id: 3n,
      name: 'Dream Theater',
    },
    musical: {
      id: 5n,
      title: 'Great Musical',
    },
    performance: {
      id: 9n,
      seasonLabel: '2026 Seoul',
    },
    seatReviewTags: [
      {
        tag,
      },
    ],
  };

  it('lists selectable tags ordered by type and name', async () => {
    const prisma = makePrisma();
    prisma.tag.findMany.mockResolvedValue([tag]);

    const service = new TagsService(prisma as never);

    await expect(service.findAll()).resolves.toEqual([
      {
        id: '2',
        name: '시야좋음',
        type: 'seat_feature',
      },
    ]);

    expect(prisma.tag.findMany).toHaveBeenCalledWith({
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
  });

  it('lists seat reviews that are connected to a tag', async () => {
    const prisma = makePrisma();
    prisma.tag.findUnique.mockResolvedValue({ id: 2n });
    prisma.seatReview.findMany.mockResolvedValue([review]);
    prisma.seatReview.count.mockResolvedValue(1);
    prisma.$transaction.mockImplementation((queries: unknown[]) =>
      Promise.all(queries),
    );

    const service = new TagsService(prisma as never);

    await expect(service.findSeatReviews('2', {})).resolves.toMatchObject({
      items: [
        {
          id: '11',
          tags: [{ id: '2', name: '시야좋음', type: 'seat_feature' }],
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
    });

    expect(prisma.seatReview.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          seatReviewTags: {
            some: { tagId: 2n },
          },
        },
      }),
    );
  });
});
