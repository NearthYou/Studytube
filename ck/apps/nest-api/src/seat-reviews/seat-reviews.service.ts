import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { PrismaService } from 'src/database/prisma.service';
import { RagService } from 'src/rag/rag.service';
import { CreateSeatReviewDto } from './dto/create-seat-review.dto';
import { SeatReviewQueryDto } from './dto/seat-review-query.dto';
import { UpdateSeatReviewDto } from './dto/update-seat-review.dto';

// 리뷰 조회 시 같이 가져올 관계 정의
const seatReviewInclude = {
  author: true,
  theater: true,
  musical: true,
  performance: true,
  seatReviewTags: {
    include: {
      tag: true,
    },
  },
} satisfies Prisma.SeatReviewInclude;

const insensitive = 'insensitive' as const;
const obstructionTagName = '시야방해';

type SeatReviewWithRelations = Prisma.SeatReviewGetPayload<{
  include: typeof seatReviewInclude;
}>;

@Injectable()
export class SeatReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ragService: RagService,
  ) {}

  // 좌석 리뷰 생성
  async create(user: AuthenticatedUser, dto: CreateSeatReviewDto) {
    const authorId = this.parseId(user.id, 'userId');
    const theaterId = this.parseId(dto.theaterId, 'theaterId');
    const musicalId = this.parseId(dto.musicalId, 'musicalId');
    const performanceId = this.parseId(dto.performanceId, 'performanceId');
    const tagIds = this.parseUniqueIds(dto.tagIds ?? [], 'tagIds');

    await this.assertPerformanceMatches({
      performanceId,
      theaterId,
      musicalId,
    });
    await this.assertTagsExist(tagIds);

    const review = await this.prisma.seatReview.create({
      data: {
        authorId,
        theaterId,
        musicalId,
        performanceId,
        seatFloor: dto.seatFloor.trim(),
        seatSection: this.normalizeOptionalText(dto.seatSection),
        seatRow: dto.seatRow.trim().toUpperCase(),
        seatNumber: dto.seatNumber.trim(),
        viewRating: dto.viewRating,
        soundRating: dto.soundRating,
        comfortRating: dto.comfortRating,
        expressionRating: dto.expressionRating,
        stageVisibilityRating: dto.stageVisibilityRating,
        content: dto.content.trim(),
        ...(tagIds.length > 0
          ? {
              seatReviewTags: {
                createMany: {
                  data: tagIds.map((tagId) => ({ tagId })),
                  skipDuplicates: true,
                },
              },
            }
          : {}),
      },
      include: seatReviewInclude,
    });

    void this.ragService.upsertReviewEmbedding(review.id).catch((error) => {
      console.error('Failed to index seat review embedding', error);
    });

    return this.toPublicReview(review);
  }

  // 좌석 리뷰 목록 조회
  async findAll(query: SeatReviewQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const where = this.buildFindAllWhere(query);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.seatReview.findMany({
        where,
        include: seatReviewInclude,
        orderBy: this.buildFindAllOrderBy(query.sort),
        skip,
        take: limit,
      }),
      this.prisma.seatReview.count({ where }),
    ]);

    return {
      items: items.map((review) => this.toPublicReview(review)),
      total,
      page,
      limit,
      hasNext: page * limit < total,
    };
  }

  // 상세 조회
  async findOne(id: string) {
    const review = await this.prisma.seatReview.findFirst({
      where: {
        id: this.parseId(id, 'id'),
        moderationStatus: 'VISIBLE',
        deletedAt: null,
      },
      include: seatReviewInclude,
    });

    if (!review) {
      throw new NotFoundException('Seat review not found');
    }

    return this.toPublicReview(review);
  }

  // 좌석 리뷰 수정
  async update(id: string, user: AuthenticatedUser, dto: UpdateSeatReviewDto) {
    const reviewId = this.parseId(id, 'id');
    const existingReview = await this.prisma.seatReview.findUnique({
      where: { id: reviewId },
    });

    if (!existingReview) {
      throw new NotFoundException('Seat review not found');
    }

    this.assertAuthor(existingReview.authorId, user.id);

    const tagIds =
      dto.tagIds !== undefined
        ? this.parseUniqueIds(dto.tagIds, 'tagIds')
        : undefined;

    if (tagIds !== undefined) {
      await this.assertTagsExist(tagIds);
    }

    const updateReview = await this.prisma.seatReview.update({
      where: { id: reviewId },
      data: {
        ...(dto.seatFloor !== undefined
          ? { seatFloor: dto.seatFloor.trim() }
          : {}),
        ...(dto.seatSection !== undefined
          ? { seatSection: this.normalizeOptionalText(dto.seatSection) }
          : {}),
        ...(dto.seatRow !== undefined
          ? { seatRow: dto.seatRow.trim().toUpperCase() }
          : {}),
        ...(dto.seatNumber !== undefined
          ? { seatNumber: dto.seatNumber.trim() }
          : {}),
        ...(dto.viewRating !== undefined ? { viewRating: dto.viewRating } : {}),
        ...(dto.soundRating !== undefined
          ? { soundRating: dto.soundRating }
          : {}),
        ...(dto.comfortRating !== undefined
          ? { comfortRating: dto.comfortRating }
          : {}),
        ...(dto.expressionRating !== undefined
          ? { expressionRating: dto.expressionRating }
          : {}),
        ...(dto.stageVisibilityRating !== undefined
          ? { stageVisibilityRating: dto.stageVisibilityRating }
          : {}),
        ...(dto.content !== undefined ? { content: dto.content.trim() } : {}),
        ...(tagIds !== undefined
          ? {
              seatReviewTags: {
                deleteMany: {},
                ...(tagIds.length > 0
                  ? {
                      createMany: {
                        data: tagIds.map((tagId) => ({ tagId })),
                        skipDuplicates: true,
                      },
                    }
                  : {}),
              },
            }
          : {}),
      },
      include: seatReviewInclude,
    });

    void this.ragService
      .upsertReviewEmbedding(updateReview.id)
      .catch((error) => {
        console.error('Failed to reindex seat review embedding', error);
      });

    return this.toPublicReview(updateReview);
  }

  // 좌석 리뷰 삭제
  async remove(id: string, user: AuthenticatedUser) {
    const reviewId = this.parseId(id, 'id');
    const existingReview = await this.prisma.seatReview.findUnique({
      where: { id: reviewId },
    });

    if (!existingReview) {
      throw new NotFoundException('Seat review not found');
    }

    this.assertAuthor(existingReview.authorId, user.id);

    await this.prisma.$transaction([
      this.prisma.seatReviewEmbedding.deleteMany({
        where: { seatReviewId: reviewId },
      }),
      this.prisma.seatReviewTag.deleteMany({
        where: { seatReviewId: reviewId },
      }),
      this.prisma.comment.deleteMany({ where: { seatReviewId: reviewId } }),
      this.prisma.reviewReport.deleteMany({
        where: { seatReviewId: reviewId },
      }),
      this.prisma.seatReview.delete({ where: { id: reviewId } }),
    ]);

    return { delete: true };
  }

  // 문자열 ID를 `bigint`로 변환
  private parseId(value: string, fieldName: string) {
    try {
      const parsed = BigInt(value);

      if (parsed <= 0n) {
        throw new Error('ID must be positive');
      }

      return parsed;
    } catch {
      throw new BadRequestException(
        `${fieldName} must be a positive integer string`,
      );
    }
  }

  private parseUniqueIds(values: string[], fieldName: string) {
    return [...new Set(values.map((value) => this.parseId(value, fieldName)))];
  }

  private async assertTagsExist(tagIds: bigint[]) {
    if (tagIds.length === 0) {
      return;
    }

    const tagCount = await this.prisma.tag.count({
      where: {
        id: {
          in: tagIds,
        },
      },
    });

    if (tagCount !== tagIds.length) {
      throw new BadRequestException('One or more tags were not found');
    }
  }

  // 사용자가 보낸 `performanceId`, `theaterId`, `musicalId`가 맞는 조합인지 확인
  private buildFindAllWhere(query: SeatReviewQueryDto) {
    const and: Prisma.SeatReviewWhereInput[] = [];
    const seatRowFilter = this.buildSeatTextFilter(
      query.seatRow,
      query.seatRowFrom,
      query.seatRowTo,
    );
    const seatNumberFilter = this.buildSeatTextFilter(
      query.seatNumber,
      query.seatNumberFrom,
      query.seatNumberTo,
    );
    const tagIds = this.parseIdList(query.tagIds, 'tagIds');

    if (query.q) {
      and.push({
        OR: [
          {
            content: {
              contains: query.q,
              mode: insensitive,
            },
          },
          {
            theater: {
              name: {
                contains: query.q,
                mode: insensitive,
              },
            },
          },
          {
            musical: {
              title: {
                contains: query.q,
                mode: insensitive,
              },
            },
          },
          {
            performance: {
              seasonLabel: {
                contains: query.q,
                mode: insensitive,
              },
            },
          },
          {
            seatReviewTags: {
              some: {
                tag: {
                  name: {
                    contains: query.q,
                    mode: insensitive,
                  },
                },
              },
            },
          },
        ],
      });
    }

    if (query.tag) {
      and.push({
        seatReviewTags: {
          some: {
            tag: {
              name: {
                contains: query.tag,
                mode: insensitive,
              },
            },
          },
        },
      });
    }

    if (query.hasObstruction !== undefined) {
      and.push({
        seatReviewTags: query.hasObstruction
          ? {
              some: {
                tag: {
                  name: obstructionTagName,
                },
              },
            }
          : {
              none: {
                tag: {
                  name: obstructionTagName,
                },
              },
            },
      });
    }

    const where: Prisma.SeatReviewWhereInput = {
      moderationStatus: 'VISIBLE',
      deletedAt: null,
      ...(query.theaterId
        ? { theaterId: this.parseId(query.theaterId, 'theaterId') }
        : {}),
      ...(query.theater
        ? {
            theater: {
              name: {
                contains: query.theater,
                mode: insensitive,
              },
            },
          }
        : {}),
      ...(query.musicalId
        ? { musicalId: this.parseId(query.musicalId, 'musicalId') }
        : {}),
      ...(query.musical
        ? {
            musical: {
              title: {
                contains: query.musical,
                mode: insensitive,
              },
            },
          }
        : {}),
      ...(query.performanceId
        ? { performanceId: this.parseId(query.performanceId, 'performanceId') }
        : {}),
      ...(query.seasonLabel
        ? {
            performance: {
              seasonLabel: {
                contains: query.seasonLabel,
                mode: insensitive,
              },
            },
          }
        : {}),
      ...(query.seatFloor
        ? {
            seatFloor: {
              equals: query.seatFloor,
              mode: insensitive,
            },
          }
        : {}),
      ...(query.seatSection
        ? {
            seatSection: {
              equals: query.seatSection,
              mode: insensitive,
            },
          }
        : {}),
      ...(seatRowFilter ? { seatRow: seatRowFilter } : {}),
      ...(seatNumberFilter ? { seatNumber: seatNumberFilter } : {}),
      ...(query.tagId
        ? {
            seatReviewTags: {
              some: {
                tagId: this.parseId(query.tagId, 'tagId'),
              },
            },
          }
        : {}),
      ...(tagIds.length > 0
        ? {
            seatReviewTags: {
              some: {
                tagId: {
                  in: tagIds,
                },
              },
            },
          }
        : {}),
      ...(query.minViewRating
        ? { viewRating: { gte: query.minViewRating } }
        : {}),
      ...(query.minSoundRating
        ? { soundRating: { gte: query.minSoundRating } }
        : {}),
      ...(query.minComfortRating
        ? { comfortRating: { gte: query.minComfortRating } }
        : {}),
      ...(query.minExpressionRating
        ? { expressionRating: { gte: query.minExpressionRating } }
        : {}),
      ...(query.minStageVisibilityRating
        ? {
            stageVisibilityRating: {
              gte: query.minStageVisibilityRating,
            },
          }
        : {}),
      ...(and.length > 0 ? { AND: and } : {}),
    };

    return where;
  }

  private buildSeatTextFilter(
    value: string | undefined,
    from: number | undefined,
    to: number | undefined,
  ): Prisma.StringFilter | undefined {
    if (value) {
      return {
        equals: value,
        mode: insensitive,
      };
    }

    const rangeValues = this.buildSeatRangeValues(from, to);

    return rangeValues.length > 0
      ? {
          in: rangeValues,
          mode: insensitive,
        }
      : undefined;
  }

  private buildSeatRangeValues(
    from: number | undefined,
    to: number | undefined,
  ) {
    if (!from || !to) {
      return [];
    }

    const start = Math.min(from, to);
    const end = Math.max(from, to);

    if (end - start > 200) {
      throw new BadRequestException('Seat range is too large.');
    }

    return Array.from({ length: end - start + 1 }, (_, index) =>
      String(start + index),
    );
  }

  private parseIdList(value: string | undefined, fieldName: string) {
    if (!value) {
      return [];
    }

    return value
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
      .map((id) => this.parseId(id, fieldName));
  }

  private buildFindAllOrderBy(sort: SeatReviewQueryDto['sort']) {
    const ratingOrderBy: Prisma.SeatReviewOrderByWithRelationInput[] = [
      { viewRating: 'desc' },
      { soundRating: 'desc' },
      { comfortRating: 'desc' },
      { expressionRating: 'desc' },
      { stageVisibilityRating: 'desc' },
      { createdAt: 'desc' },
    ];

    switch (sort ?? 'latest') {
      case 'oldest':
        return {
          createdAt: 'asc',
        } satisfies Prisma.SeatReviewOrderByWithRelationInput;
      case 'popular':
        return [
          { comments: { _count: 'desc' } },
          { createdAt: 'desc' },
        ] satisfies Prisma.SeatReviewOrderByWithRelationInput[];
      case 'rating':
        return ratingOrderBy;
      case 'view':
        return [
          { viewRating: 'desc' },
          { createdAt: 'desc' },
        ] satisfies Prisma.SeatReviewOrderByWithRelationInput[];
      case 'sound':
        return [
          { soundRating: 'desc' },
          { createdAt: 'desc' },
        ] satisfies Prisma.SeatReviewOrderByWithRelationInput[];
      case 'comfort':
        return [
          { comfortRating: 'desc' },
          { createdAt: 'desc' },
        ] satisfies Prisma.SeatReviewOrderByWithRelationInput[];
      case 'expression':
        return [
          { expressionRating: 'desc' },
          { createdAt: 'desc' },
        ] satisfies Prisma.SeatReviewOrderByWithRelationInput[];
      case 'stageVisibility':
        return [
          { stageVisibilityRating: 'desc' },
          { createdAt: 'desc' },
        ] satisfies Prisma.SeatReviewOrderByWithRelationInput[];
      case 'latest':
      default:
        return {
          createdAt: 'desc',
        } satisfies Prisma.SeatReviewOrderByWithRelationInput;
    }
  }

  private async assertPerformanceMatches(input: {
    performanceId: bigint;
    theaterId: bigint;
    musicalId: bigint;
  }) {
    const performance = await this.prisma.performance.findUnique({
      where: { id: input.performanceId },
    });

    if (!performance) {
      throw new BadRequestException('Performance not found');
    }

    if (
      performance.theaterId !== input.theaterId ||
      performance.musicalId !== input.musicalId
    ) {
      throw new BadRequestException(
        'Performance does not match theaterId or muscialId',
      );
    }
  }

  // 로그인 유저가 리뷰 작성자인지 확인
  private assertAuthor(authorId: bigint, currentUserId: string) {
    if (authorId !== this.parseId(currentUserId, 'userId')) {
      throw new ForbiddenException('You can only modify your own review');
    }
  }

  // 선택 입력 문자열 정리
  private normalizeOptionalText(value?: string) {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }

  // DB에서 가져온 Prisma 리뷰 객체를 API 응답용 객체로 변환
  private toPublicReview(review: SeatReviewWithRelations) {
    return {
      id: review.id.toString(),
      author: {
        id: review.author.id.toString(),
        nickname: review.author.nickname,
      },
      theater: {
        id: review.theater.id.toString(),
        name: review.theater.name,
      },
      musical: {
        id: review.musical.id.toString(),
        title: review.musical.title,
      },
      performance: review.performance
        ? {
            id: review.performance.id.toString(),
            seasonLabel: review.performance.seasonLabel,
          }
        : null,
      seat: {
        floor: review.seatFloor,
        section: review.seatSection,
        row: review.seatRow,
        number: review.seatNumber,
      },
      ratings: {
        view: review.viewRating,
        sound: review.soundRating,
        comfort: review.comfortRating,
        expression: review.expressionRating,
        stageVisibility: review.stageVisibilityRating,
      },
      content: review.content,
      tags: review.seatReviewTags.map(({ tag }) => ({
        id: tag.id.toString(),
        name: tag.name,
        type: tag.type,
      })),
      createdAt: review.createdAt.toISOString(),
      updatedAt: review.updatedAt.toISOString(),
    };
  }
}
