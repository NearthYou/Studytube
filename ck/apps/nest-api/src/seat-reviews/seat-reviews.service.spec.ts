import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { SeatReviewsService } from './seat-reviews.service';

describe('SeatReviewsService tags', () => {
  const now = new Date('2026-06-12T00:00:00.000Z');
  const user: AuthenticatedUser = { id: '7', email: 'user@example.com' };

  const makePrisma = () => ({
    performance: {
      findUnique: jest.fn(),
    },
    tag: {
      count: jest.fn(),
    },
    seatReview: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    seatReviewEmbedding: {
      deleteMany: jest.fn(),
    },
    seatReviewTag: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    comment: {
      deleteMany: jest.fn(),
    },
    reviewReport: {
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
  });

  const makeRagService = () => ({
    upsertReviewEmbedding: jest.fn().mockResolvedValue({ indexed: true }),
    deleteReviewEmbedding: jest.fn().mockResolvedValue(undefined),
  });

  const makeService = () => {
    const prisma = makePrisma();
    const ragService = makeRagService();
    const service = new SeatReviewsService(
      prisma as never,
      ragService as never,
    );

    return { prisma, ragService, service };
  };

  const reviewWithRelations = {
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
        tag: {
          id: 2n,
          name: 'good_view',
          type: 'seat_feature',
        },
      },
      {
        tag: {
          id: 4n,
          name: 'first_timer',
          type: 'viewing_purpose',
        },
      },
    ],
  };

  const createDto = {
    theaterId: '3',
    musicalId: '5',
    performanceId: '9',
    seatFloor: ' 1F ',
    seatRow: ' a ',
    seatNumber: ' 12 ',
    viewRating: 5,
    soundRating: 4,
    comfortRating: 3,
    expressionRating: 5,
    stageVisibilityRating: 4,
    content: ' Great view from this seat. ',
    tagIds: ['2', '4', '2'],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a review, connects unique tag ids, and schedules RAG indexing', async () => {
    const { prisma, ragService, service } = makeService();
    prisma.performance.findUnique.mockResolvedValue({
      id: 9n,
      theaterId: 3n,
      musicalId: 5n,
    });
    prisma.tag.count.mockResolvedValue(2);
    prisma.seatReview.create.mockResolvedValue(reviewWithRelations);

    await expect(service.create(user, createDto)).resolves.toMatchObject({
      id: '11',
      tags: [
        { id: '2', name: 'good_view', type: 'seat_feature' },
        { id: '4', name: 'first_timer', type: 'viewing_purpose' },
      ],
    });

    expect(prisma.seatReview.create).toHaveBeenCalledWith({
      data: {
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
        seatReviewTags: {
          createMany: {
            data: [{ tagId: 2n }, { tagId: 4n }],
            skipDuplicates: true,
          },
        },
      },
      include: {
        author: true,
        theater: true,
        musical: true,
        performance: true,
        seatReviewTags: {
          include: {
            tag: true,
          },
        },
      },
    });
    expect(ragService.upsertReviewEmbedding).toHaveBeenCalledWith(11n);
  });

  it('builds search filters, sorting, pagination, and hasNext metadata', async () => {
    const { prisma, service } = makeService();
    prisma.seatReview.findMany.mockResolvedValue([reviewWithRelations]);
    prisma.seatReview.count.mockResolvedValue(11);
    prisma.$transaction.mockImplementation((queries: unknown[]) =>
      Promise.all(queries),
    );

    await expect(
      service.findAll({
        q: 'phantom',
        theater: 'Dream',
        musical: 'Great',
        seasonLabel: '2026',
        seatFloor: '1F',
        seatSection: 'A',
        seatRow: 'A',
        seatNumber: '12',
        tag: 'view',
        hasObstruction: false,
        minViewRating: 4,
        minSoundRating: 3,
        sort: 'rating',
        page: 2,
        limit: 10,
      }),
    ).resolves.toMatchObject({
      items: [{ id: '11' }],
      total: 11,
      page: 2,
      limit: 10,
      hasNext: false,
    });

    expect(prisma.seatReview.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          moderationStatus: 'VISIBLE',
          deletedAt: null,
          theater: {
            name: {
              contains: 'Dream',
              mode: 'insensitive',
            },
          },
          musical: {
            title: {
              contains: 'Great',
              mode: 'insensitive',
            },
          },
          performance: {
            seasonLabel: {
              contains: '2026',
              mode: 'insensitive',
            },
          },
          seatFloor: { equals: '1F', mode: 'insensitive' },
          seatSection: { equals: 'A', mode: 'insensitive' },
          seatRow: { equals: 'A', mode: 'insensitive' },
          seatNumber: { equals: '12', mode: 'insensitive' },
          viewRating: { gte: 4 },
          soundRating: { gte: 3 },
          AND: [
            {
              OR: [
                {
                  content: {
                    contains: 'phantom',
                    mode: 'insensitive',
                  },
                },
                {
                  theater: {
                    name: {
                      contains: 'phantom',
                      mode: 'insensitive',
                    },
                  },
                },
                {
                  musical: {
                    title: {
                      contains: 'phantom',
                      mode: 'insensitive',
                    },
                  },
                },
                {
                  performance: {
                    seasonLabel: {
                      contains: 'phantom',
                      mode: 'insensitive',
                    },
                  },
                },
                {
                  seatReviewTags: {
                    some: {
                      tag: {
                        name: {
                          contains: 'phantom',
                          mode: 'insensitive',
                        },
                      },
                    },
                  },
                },
              ],
            },
            {
              seatReviewTags: {
                some: {
                  tag: {
                    name: {
                      contains: 'view',
                      mode: 'insensitive',
                    },
                  },
                },
              },
            },
            {
              seatReviewTags: {
                none: {
                  tag: {
                    name: '시야방해',
                  },
                },
              },
            },
          ],
        },
        orderBy: [
          { viewRating: 'desc' },
          { soundRating: 'desc' },
          { comfortRating: 'desc' },
          { expressionRating: 'desc' },
          { stageVisibilityRating: 'desc' },
          { createdAt: 'desc' },
        ],
        skip: 10,
        take: 10,
      }),
    );
  });

  it('builds seat row and number range filters for search', async () => {
    const { prisma, service } = makeService();
    prisma.seatReview.findMany.mockResolvedValue([reviewWithRelations]);
    prisma.seatReview.count.mockResolvedValue(1);
    prisma.$transaction.mockImplementation((queries: unknown[]) =>
      Promise.all(queries),
    );

    await service.findAll({
      theaterId: '3',
      seatFloor: '1F',
      seatSection: 'A',
      seatRowFrom: 10,
      seatRowTo: 12,
      seatNumberFrom: 1,
      seatNumberTo: 3,
      page: 1,
      limit: 10,
    });

    expect(prisma.seatReview.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          moderationStatus: 'VISIBLE',
          deletedAt: null,
          theaterId: 3n,
          seatFloor: { equals: '1F', mode: 'insensitive' },
          seatSection: { equals: 'A', mode: 'insensitive' },
          seatRow: { in: ['10', '11', '12'], mode: 'insensitive' },
          seatNumber: { in: ['1', '2', '3'], mode: 'insensitive' },
        },
      }),
    );
  });

  it('builds OR tag filters when multiple tag ids are provided', async () => {
    const { prisma, service } = makeService();
    prisma.seatReview.findMany.mockResolvedValue([reviewWithRelations]);
    prisma.seatReview.count.mockResolvedValue(1);
    prisma.$transaction.mockImplementation((queries: unknown[]) =>
      Promise.all(queries),
    );

    await service.findAll({
      tagIds: '2,4',
      page: 1,
      limit: 10,
    });

    expect(prisma.seatReview.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          moderationStatus: 'VISIBLE',
          deletedAt: null,
          seatReviewTags: {
            some: {
              tagId: {
                in: [2n, 4n],
              },
            },
          },
        },
      }),
    );
  });

  it('replaces review tags and schedules RAG reindexing when updating with tag ids', async () => {
    const { prisma, ragService, service } = makeService();
    prisma.seatReview.findUnique.mockResolvedValue({
      id: 11n,
      authorId: 7n,
    });
    prisma.tag.count.mockResolvedValue(1);
    prisma.seatReview.update.mockResolvedValue({
      ...reviewWithRelations,
      seatReviewTags: [reviewWithRelations.seatReviewTags[0]],
    });

    await expect(
      service.update('11', user, { tagIds: ['2', '2'] }),
    ).resolves.toMatchObject({
      tags: [{ id: '2', name: 'good_view', type: 'seat_feature' }],
    });

    expect(prisma.seatReview.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 11n },
        data: {
          seatReviewTags: {
            deleteMany: {},
            createMany: {
              data: [{ tagId: 2n }],
              skipDuplicates: true,
            },
          },
        },
      }),
    );
    expect(ragService.upsertReviewEmbedding).toHaveBeenCalledWith(11n);
  });

  it('includes tags when reading a review detail', async () => {
    const { prisma, service } = makeService();
    prisma.seatReview.findFirst.mockResolvedValue(reviewWithRelations);

    await expect(service.findOne('11')).resolves.toMatchObject({
      id: '11',
      tags: [
        { id: '2', name: 'good_view', type: 'seat_feature' },
        { id: '4', name: 'first_timer', type: 'viewing_purpose' },
      ],
    });
  });

  it('deletes related reports when removing a review', async () => {
    const { prisma, service } = makeService();
    prisma.seatReview.findUnique.mockResolvedValue({
      id: 11n,
      authorId: 7n,
    });
    prisma.seatReview.delete.mockResolvedValue({ id: 11n });
    prisma.$transaction.mockImplementation((queries: unknown[]) =>
      Promise.all(queries),
    );

    await expect(service.remove('11', user)).resolves.toEqual({
      delete: true,
    });

    expect(prisma.reviewReport.deleteMany).toHaveBeenCalledWith({
      where: { seatReviewId: 11n },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(5);
  });
});
