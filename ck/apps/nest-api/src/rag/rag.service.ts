import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/database/prisma.service';
import { OpenAiRagClient } from './openai-rag.client';
import {
  buildSeatReviewRagMetadata,
  buildSeatReviewRagDocument,
  ragSeatReviewInclude,
} from './rag-document.builder';
import { RagQueryParser } from './rag-query-parser';
import type { RagAnswer, RagQuestionFilters, RagSource } from './rag.types';

type RagCandidateRow = {
  id: bigint;
  distance: number;
  theater_id: bigint;
  theater_name: string;
  musical_id: bigint;
  musical_title: string;
  performance_id: bigint | null;
  season_label: string | null;
  seat_floor: string;
  seat_section: string | null;
  seat_row: string;
  seat_number: string;
  view_rating: number;
  sound_rating: number;
  comfort_rating: number;
  expression_rating: number;
  stage_visibility_rating: number;
  content: string;
  tags: string[];
};

type DirectSearchMode = 'exact' | 'nearbyRow' | 'sameScope';

type TagRangeRow = {
  seat_floor: string;
  min_row: number | null;
  max_row: number | null;
  review_count: bigint;
};

@Injectable()
export class RagService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly openAi: OpenAiRagClient,
    private readonly queryParser: RagQueryParser,
  ) {}

  async ask(question: string, limit = 5): Promise<RagAnswer> {
    const startedAt = Date.now();
    const normalizedQuestion = question.trim();

    if (normalizedQuestion.length < 2) {
      throw new BadRequestException('question must be at least 2 characters');
    }

    const filters = await this.queryParser.parse(normalizedQuestion);
    const sources = await this.findRelevantSources(
      normalizedQuestion,
      filters,
      limit,
    );

    if (sources.length === 0) {
      const result = {
        answer:
          '아직 이 질문에 답할 만큼 맞는 좌석 후기를 찾지 못했습니다. 극장명, 층, 구역이나 열을 조금 더 넓혀서 물어보면 더 잘 찾아볼 수 있어요.',
        reasons: ['검색 조건과 의도가 모두 맞는 후기를 찾지 못했습니다.'],
        filters,
        sources: [],
      };
      await this.logQuery(normalizedQuestion, result, startedAt);
      return result;
    }

    const rangeAnswer = await this.buildTagRangeAnswer(filters);

    if (rangeAnswer) {
      const result = {
        answer: rangeAnswer,
        reasons: this.buildReasons(filters, sources),
        filters,
        sources,
      };
      await this.logQuery(normalizedQuestion, result, startedAt);
      return result;
    }

    const answer = await this.openAi.createAnswer({
      question: normalizedQuestion,
      filters,
      sources,
    });

    const result = {
      answer,
      reasons: this.buildReasons(filters, sources),
      filters,
      sources,
    };
    await this.logQuery(normalizedQuestion, result, startedAt);
    return result;
  }

  async upsertReviewEmbedding(reviewId: bigint) {
    const review = await this.prisma.seatReview.findUnique({
      where: { id: reviewId },
      include: ragSeatReviewInclude,
    });

    if (!review) {
      throw new BadRequestException('Seat review not found');
    }
    if (review.moderationStatus !== 'VISIBLE' || review.deletedAt) {
      await this.deleteReviewEmbedding(reviewId);
      return {
        seatReviewId: reviewId.toString(),
        indexed: false,
      };
    }

    const document = buildSeatReviewRagDocument(review);
    const metadata = JSON.stringify(buildSeatReviewRagMetadata(review));
    const embedding = await this.openAi.createEmbedding(document);
    const vector = this.toVectorLiteral(embedding);

    await this.prisma.$executeRaw`
      INSERT INTO "seat_review_embeddings" ("seat_review_id", "document", "metadata", "document_version", "embedding", "updated_at")
      VALUES (${reviewId}, ${document}, ${metadata}::jsonb, ${'seat-review-v2'}, ${vector}::vector, NOW())
      ON CONFLICT ("seat_review_id")
      DO UPDATE SET
        "document" = EXCLUDED."document",
        "metadata" = EXCLUDED."metadata",
        "document_version" = EXCLUDED."document_version",
        "embedding" = EXCLUDED."embedding",
        "updated_at" = NOW()
    `;

    return {
      seatReviewId: reviewId.toString(),
      indexed: true,
    };
  }

  async deleteReviewEmbedding(reviewId: bigint) {
    await this.prisma.$executeRaw`
      DELETE FROM "seat_review_embeddings"
      WHERE "seat_review_id" = ${reviewId}
    `;
  }

  async reindexAll() {
    const reviews = await this.prisma.seatReview.findMany({
      where: { moderationStatus: 'VISIBLE', deletedAt: null },
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    for (const review of reviews) {
      await this.upsertReviewEmbedding(review.id);
    }

    return {
      indexedCount: reviews.length,
    };
  }

  private async buildTagRangeAnswer(filters: RagQuestionFilters) {
    if (!filters.asksRange || !filters.tagName) {
      return null;
    }

    const conditions = this.buildDirectSqlConditions(filters, 'sameScope');
    const numericRow = Prisma.sql`NULLIF(regexp_replace(sr."seat_row", '[^0-9]', '', 'g'), '')::int`;

    const rows = await this.prisma.$queryRaw<TagRangeRow[]>(Prisma.sql`
      SELECT
        sr."seat_floor",
        MIN(${numericRow}) AS "min_row",
        MAX(${numericRow}) AS "max_row",
        COUNT(*)::bigint AS "review_count"
      FROM "seat_reviews" sr
      ${conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty}
      GROUP BY sr."seat_floor"
      ORDER BY NULLIF(regexp_replace(sr."seat_floor", '[^0-9]', '', 'g'), '')::int ASC NULLS LAST
    `);

    const usableRows = rows.filter((row) => row.max_row !== null);

    if (usableRows.length === 0) {
      return null;
    }

    const theater = filters.theaterName ?? '해당 극장';
    const tag = filters.tagName;
    const total = usableRows.reduce(
      (sum, row) => sum + Number(row.review_count),
      0,
    );

    if (filters.seatFloor && usableRows.length === 1) {
      const row = usableRows[0];

      return `${theater} ${row.seat_floor}은 ${tag} 태그가 ${row.max_row}열까지 확인됩니다. 이건 ${row.seat_floor} 전체가 다 시야방해라는 뜻은 아니고, 후기에서 난간, 사이드 시야, 앞사람 영향 같은 방해 요소가 기록된 좌석이 ${row.max_row}열까지 있었다는 의미예요. 현재 집계에 사용된 ${tag} 후기는 ${total}개입니다.`;
    }

    const floorSummaries = usableRows.map((row) => {
      const minRow = row.min_row === row.max_row ? null : `${row.min_row}열부터 `;
      return `${row.seat_floor}은 ${minRow ?? ''}${row.max_row}열까지`;
    });
    const farthest = usableRows.reduce((current, row) => {
      const currentFloor = this.parseFirstNumber(current.seat_floor) ?? 0;
      const nextFloor = this.parseFirstNumber(row.seat_floor) ?? 0;

      if (nextFloor !== currentFloor) {
        return nextFloor > currentFloor ? row : current;
      }

      return (row.max_row ?? 0) > (current.max_row ?? 0) ? row : current;
    }, usableRows[0]);
    return `${theater} 후기 기준으로 ${tag} 태그는 ${floorSummaries.join(', ')} 확인됩니다. 전체로 보면 ${farthest.seat_floor} ${farthest.max_row}열까지 ${tag}가 붙은 후기가 있어요. 다만 이건 해당 층의 모든 좌석이 방해된다는 뜻은 아니고, 난간, 사이드 시야, 앞사람 영향처럼 후기에서 방해로 기록된 좌석이 그 범위까지 있다는 의미로 보면 됩니다. 현재 집계에 사용된 ${tag} 후기는 ${total}개입니다.`;
  }

  private parseFirstNumber(value: string) {
    const match = value.match(/\d+/);
    return match ? Number(match[0]) : null;
  }

  private async findRelevantSources(
    question: string,
    filters: RagQuestionFilters,
    limit: number,
  ) {
    const safeLimit = this.getSafeLimit(filters, limit);
    const exactSources = await this.searchDirectSources(
      filters,
      safeLimit,
      filters.asksRange ? 'sameScope' : 'exact',
    );
    let sources = exactSources;

    if (
      filters.seatRow &&
      !filters.asksRange &&
      exactSources.length < Math.min(3, safeLimit)
    ) {
      sources = this.mergeSources(
        sources,
        await this.searchDirectSources(filters, safeLimit, 'nearbyRow'),
      );
    }

    if (sources.length < Math.min(3, safeLimit)) {
      sources = this.mergeSources(
        sources,
        await this.searchDirectSources(filters, safeLimit, 'sameScope'),
      );
    }

    if (await this.hasEmbeddings()) {
      const queryEmbedding = await this.openAi.createEmbedding(
        this.buildQueryText(question, filters),
      );
      sources = this.mergeSources(
        sources,
        await this.searchVectorSources(queryEmbedding, filters, safeLimit),
      );
    }

    return sources.slice(0, safeLimit);
  }

  private async hasEmbeddings() {
    const rows = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS "count" FROM "seat_review_embeddings"
    `;

    return Number(rows[0]?.count ?? 0) > 0;
  }

  private getSafeLimit(filters: RagQuestionFilters, limit: number) {
    const requestedLimit = Math.min(Math.max(limit, 1), 10);
    return filters.asksRange || filters.tagName
      ? Math.max(20, requestedLimit)
      : Math.max(8, requestedLimit);
  }

  private mergeSources(primary: RagSource[], secondary: RagSource[]) {
    const seen = new Set(primary.map((source) => source.id));
    const merged = [...primary];

    for (const source of secondary) {
      if (seen.has(source.id)) {
        continue;
      }

      seen.add(source.id);
      merged.push(source);
    }

    return merged;
  }

  private async searchDirectSources(
    filters: RagQuestionFilters,
    limit: number,
    mode: DirectSearchMode,
  ): Promise<RagSource[]> {
    const conditions = this.buildDirectSqlConditions(filters, mode);
    const orderBy = this.buildDirectOrderBy(filters, mode);

    const rows = await this.prisma.$queryRaw<RagCandidateRow[]>(Prisma.sql`
      SELECT
        sr."id",
        0::double precision AS "distance",
        t."id" AS "theater_id",
        t."name" AS "theater_name",
        m."id" AS "musical_id",
        m."title" AS "musical_title",
        p."id" AS "performance_id",
        p."season_label",
        sr."seat_floor",
        sr."seat_section",
        sr."seat_row",
        sr."seat_number",
        sr."view_rating",
        sr."sound_rating",
        sr."comfort_rating",
        sr."expression_rating",
        sr."stage_visibility_rating",
        sr."content",
        COALESCE(array_remove(array_agg(tag."name"), NULL), ARRAY[]::text[]) AS "tags"
      FROM "seat_reviews" sr
      JOIN "theaters" t ON t."id" = sr."theater_id"
      JOIN "musicals" m ON m."id" = sr."musical_id"
      LEFT JOIN "performances" p ON p."id" = sr."performance_id"
      LEFT JOIN "seat_review_tags" srt ON srt."seat_review_id" = sr."id"
      LEFT JOIN "tags" tag ON tag."id" = srt."tag_id"
      ${conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty}
      GROUP BY sr."id", t."id", m."id", p."id"
      ${orderBy}
      LIMIT ${limit}
    `);

    return rows.map((row) => this.toSource(row));
  }

  private async searchVectorSources(
    embedding: number[],
    filters: RagQuestionFilters,
    limit: number,
  ): Promise<RagSource[]> {
    const vector = this.toVectorLiteral(embedding);
    const conditions = this.buildSqlConditions(filters);
    const orderBy = this.buildOrderBy(filters);
    const safeLimit = Math.min(Math.max(limit, 1), 20);

    const rows = await this.prisma.$queryRaw<RagCandidateRow[]>(Prisma.sql`
      SELECT
        sr."id",
        (sre."embedding" <=> ${vector}::vector) AS "distance",
        t."id" AS "theater_id",
        t."name" AS "theater_name",
        m."id" AS "musical_id",
        m."title" AS "musical_title",
        p."id" AS "performance_id",
        p."season_label",
        sr."seat_floor",
        sr."seat_section",
        sr."seat_row",
        sr."seat_number",
        sr."view_rating",
        sr."sound_rating",
        sr."comfort_rating",
        sr."expression_rating",
        sr."stage_visibility_rating",
        sr."content",
        COALESCE(array_remove(array_agg(tag."name"), NULL), ARRAY[]::text[]) AS "tags"
      FROM "seat_review_embeddings" sre
      JOIN "seat_reviews" sr ON sr."id" = sre."seat_review_id"
      JOIN "theaters" t ON t."id" = sr."theater_id"
      JOIN "musicals" m ON m."id" = sr."musical_id"
      LEFT JOIN "performances" p ON p."id" = sr."performance_id"
      LEFT JOIN "seat_review_tags" srt ON srt."seat_review_id" = sr."id"
      LEFT JOIN "tags" tag ON tag."id" = srt."tag_id"
      ${conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty}
      GROUP BY sr."id", sre."embedding", t."id", m."id", p."id"
      ${orderBy}
      LIMIT ${safeLimit}
    `);

    return rows.map((row) => this.toSource(row));
  }

  private toSource(row: RagCandidateRow): RagSource {
    return {
      id: row.id.toString(),
      score: Number((1 - row.distance).toFixed(4)),
      theater: {
        id: row.theater_id.toString(),
        name: row.theater_name,
      },
      musical: {
        id: row.musical_id.toString(),
        title: row.musical_title,
      },
      performance: row.performance_id
        ? {
            id: row.performance_id.toString(),
            seasonLabel: row.season_label,
          }
        : null,
      seat: {
        floor: row.seat_floor,
        section: row.seat_section,
        row: row.seat_row,
        number: row.seat_number,
      },
      ratings: {
        view: row.view_rating,
        sound: row.sound_rating,
        comfort: row.comfort_rating,
        expression: row.expression_rating,
        stageVisibility: row.stage_visibility_rating,
      },
      tags: row.tags ?? [],
      content: row.content,
    };
  }

  private buildDirectSqlConditions(
    filters: RagQuestionFilters,
    mode: DirectSearchMode,
  ) {
    const conditions = this.buildBaseSqlConditions(filters);

    if (filters.seatFloor) {
      conditions.push(Prisma.sql`sr."seat_floor" ILIKE ${filters.seatFloor}`);
    }

    if (filters.seatSection) {
      conditions.push(
        Prisma.sql`sr."seat_section" ILIKE ${filters.seatSection}`,
      );
    }

    if (filters.seatRow && mode === 'exact') {
      conditions.push(Prisma.sql`sr."seat_row" ILIKE ${filters.seatRow}`);
    }

    if (filters.seatRow && mode === 'nearbyRow') {
      const rowNumber = Number(filters.seatRow);

      if (Number.isFinite(rowNumber)) {
        conditions.push(Prisma.sql`
          ABS(NULLIF(regexp_replace(sr."seat_row", '[^0-9]', '', 'g'), '')::int - ${rowNumber}) <= 1
        `);
      } else {
        conditions.push(Prisma.sql`sr."seat_row" ILIKE ${filters.seatRow}`);
      }
    }

    if (filters.seatNumber && mode === 'exact') {
      conditions.push(Prisma.sql`sr."seat_number" ILIKE ${filters.seatNumber}`);
    }

    if (filters.tagName) {
      conditions.push(Prisma.sql`
        EXISTS (
          SELECT 1
          FROM "seat_review_tags" tag_filter_srt
          JOIN "tags" tag_filter ON tag_filter."id" = tag_filter_srt."tag_id"
          WHERE tag_filter_srt."seat_review_id" = sr."id"
            AND tag_filter."name" = ${filters.tagName}
        )
      `);
    }

    return conditions;
  }

  private buildBaseSqlConditions(filters: RagQuestionFilters) {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`sr."moderation_status" = 'VISIBLE'`,
      Prisma.sql`sr."deleted_at" IS NULL`,
    ];

    if (filters.theaterId) {
      conditions.push(
        Prisma.sql`sr."theater_id" = ${BigInt(filters.theaterId)}`,
      );
    }

    if (filters.musicalId) {
      conditions.push(
        Prisma.sql`sr."musical_id" = ${BigInt(filters.musicalId)}`,
      );
    }

    return conditions;
  }

  private buildDirectOrderBy(
    filters: RagQuestionFilters,
    mode: DirectSearchMode,
  ) {
    const numericRow = Prisma.sql`NULLIF(regexp_replace(sr."seat_row", '[^0-9]', '', 'g'), '')::int`;

    if (filters.asksRange || filters.tagName) {
      return Prisma.sql`
        ORDER BY sr."seat_floor" ASC, ${numericRow} ASC NULLS LAST, sr."seat_row" ASC, sr."seat_section" ASC, sr."seat_number" ASC
      `;
    }

    if (filters.seatRow && mode !== 'sameScope') {
      const rowNumber = Number(filters.seatRow);

      if (Number.isFinite(rowNumber)) {
        return Prisma.sql`
          ORDER BY ABS(${numericRow} - ${rowNumber}) ASC NULLS LAST, ${numericRow} ASC NULLS LAST, sr."seat_section" ASC, sr."seat_number" ASC
        `;
      }
    }

    switch (filters.intent) {
      case 'comfort':
        return Prisma.sql`ORDER BY sr."comfort_rating" DESC, sr."created_at" DESC`;
      case 'sound':
        return Prisma.sql`ORDER BY sr."sound_rating" DESC, sr."created_at" DESC`;
      case 'expression':
        return Prisma.sql`ORDER BY sr."expression_rating" DESC, sr."created_at" DESC`;
      case 'stageVisibility':
        return Prisma.sql`ORDER BY sr."stage_visibility_rating" DESC, sr."created_at" DESC`;
      case 'view':
        return Prisma.sql`ORDER BY sr."view_rating" DESC, sr."created_at" DESC`;
      case 'general':
      default:
        return Prisma.sql`ORDER BY sr."created_at" DESC`;
    }
  }

  private buildSqlConditions(filters: RagQuestionFilters) {
    const conditions = this.buildBaseSqlConditions(filters);

    if (filters.seatFloor) {
      conditions.push(Prisma.sql`sr."seat_floor" ILIKE ${filters.seatFloor}`);
    }

    if (filters.seatSection) {
      conditions.push(
        Prisma.sql`sr."seat_section" ILIKE ${filters.seatSection}`,
      );
    }

    if (filters.seatRow) {
      conditions.push(Prisma.sql`sr."seat_row" ILIKE ${filters.seatRow}`);
    }

    if (filters.seatNumber) {
      conditions.push(Prisma.sql`sr."seat_number" ILIKE ${filters.seatNumber}`);
    }

    if (filters.tagName) {
      conditions.push(Prisma.sql`
        EXISTS (
          SELECT 1
          FROM "seat_review_tags" tag_filter_srt
          JOIN "tags" tag_filter ON tag_filter."id" = tag_filter_srt."tag_id"
          WHERE tag_filter_srt."seat_review_id" = sr."id"
            AND tag_filter."name" = ${filters.tagName}
        )
      `);
    }

    return conditions;
  }

  private buildOrderBy(filters: RagQuestionFilters) {
    switch (filters.intent) {
      case 'comfort':
        return Prisma.sql`ORDER BY sr."comfort_rating" DESC, "distance" ASC`;
      case 'sound':
        return Prisma.sql`ORDER BY sr."sound_rating" DESC, "distance" ASC`;
      case 'expression':
        return Prisma.sql`ORDER BY sr."expression_rating" DESC, "distance" ASC`;
      case 'stageVisibility':
        return Prisma.sql`ORDER BY sr."stage_visibility_rating" DESC, "distance" ASC`;
      case 'view':
        return Prisma.sql`ORDER BY sr."view_rating" DESC, "distance" ASC`;
      case 'general':
      default:
        return Prisma.sql`ORDER BY "distance" ASC`;
    }
  }

  private buildQueryText(question: string, filters: RagQuestionFilters) {
    return [
      `질문: ${question}`,
      filters.theaterName ? `극장 조건: ${filters.theaterName}` : undefined,
      filters.musicalTitle ? `작품 조건: ${filters.musicalTitle}` : undefined,
      filters.seatFloor ? `층 조건: ${filters.seatFloor}` : undefined,
      filters.seatSection ? `구역 조건: ${filters.seatSection}` : undefined,
      filters.seatRow ? `열 조건: ${filters.seatRow}` : undefined,
      filters.side ? `좌우 방향 조건: ${filters.side}` : undefined,
      filters.tagName ? `태그 조건: ${filters.tagName}` : undefined,
      filters.asksRange ? '범위 질문: 예' : undefined,
      `질문 의도: ${filters.intent}`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private buildReasons(filters: RagQuestionFilters, sources: RagSource[]) {
    const reasons: string[] = [];

    if (filters.theaterName) {
      reasons.push(`${filters.theaterName} 극장 후기를 우선 검색했습니다.`);
    }

    if (filters.musicalTitle) {
      reasons.push(`${filters.musicalTitle} 작품 후기를 우선 검색했습니다.`);
    }

    if (filters.intent !== 'general') {
      reasons.push(
        `${filters.intent} 의도에 맞는 평점 기준을 검색 정렬에 반영했습니다.`,
      );
    }

    reasons.push(`관련 후기 ${sources.length}개를 근거로 답변했습니다.`);

    return reasons;
  }

  private async logQuery(
    question: string,
    answer: RagAnswer,
    startedAt: number,
  ) {
    await this.prisma.ragQueryLog
      .create({
        data: {
          question,
          filters: answer.filters as Prisma.InputJsonValue,
          sourceIds: answer.sources.map((source) => source.id),
          answerPreview: answer.answer.slice(0, 500),
          latencyMs: Date.now() - startedAt,
        },
      })
      .catch(() => undefined);
  }

  private toVectorLiteral(embedding: number[]) {
    if (embedding.length !== 1536) {
      throw new InternalServerErrorException(
        `Embedding dimension must be 1536, received ${embedding.length}`,
      );
    }

    return `[${embedding.join(',')}]`;
  }
}
