import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/database/prisma.service';
import { TagSeatReviewQueryDto } from './dto/tag-seat-review-query.dto';

const tagReviewInclude = {
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

type ReviewWithTags = Prisma.SeatReviewGetPayload<{
  include: typeof tagReviewInclude;
}>;

@Injectable()
export class TagsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const tags = await this.prisma.tag.findMany({
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });

    return tags.map((tag) => this.toPublicTag(tag));
  }

  async findSeatReviews(tagId: string, query: TagSeatReviewQueryDto) {
    const parsedTagId = this.parseId(tagId, 'tagId');
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const tag = await this.prisma.tag.findUnique({
      where: { id: parsedTagId },
      select: { id: true },
    });

    if (!tag) {
      throw new NotFoundException('Tag not found');
    }

    const where: Prisma.SeatReviewWhereInput = {
      seatReviewTags: {
        some: { tagId: parsedTagId },
      },
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.seatReview.findMany({
        where,
        include: tagReviewInclude,
        orderBy: { createdAt: 'desc' },
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
    };
  }

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

  private toPublicTag(tag: { id: bigint; name: string; type: string }) {
    return {
      id: tag.id.toString(),
      name: tag.name,
      type: tag.type,
    };
  }

  private toPublicReview(review: ReviewWithTags) {
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
      tags: review.seatReviewTags.map(({ tag }) => this.toPublicTag(tag)),
      createdAt: review.createdAt.toISOString(),
      updatedAt: review.updatedAt.toISOString(),
    };
  }
}
