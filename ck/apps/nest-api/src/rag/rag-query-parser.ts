import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import type { RagIntent, RagQuestionFilters } from './rag.types';

const theaterAliasMap: Record<string, string[]> = {
  세종문화회관대극장: [
    '세종',
    '세종대극장',
    '세종 대극장',
    '세종문화회관',
    '세문',
    '세문회',
    '세종문회',
  ],
  세종문화회관m씨어터: [
    '세종 m씨어터',
    '세종 m',
    '세종 엠씨어터',
    '세종 엠',
    'm씨어터',
    '엠씨어터',
  ],
  세종문화회관s씨어터: [
    '세종 s씨어터',
    '세종 s',
    '세종 에스씨어터',
    '세종 에스',
    's씨어터',
    '에스씨어터',
  ],
  블루스퀘어신한카드홀: [
    '블루스퀘어',
    '블루 스퀘어',
    '블퀘',
    '블스',
    '블루스퀘어 신카홀',
    '신카홀',
    '신한카드홀',
  ],
  tom1관: ['tom', 'tom 1관', '티오엠', '티오엠 1관', '톰', '톰 1관', '대학로 tom', '대학로 티오엠'],
  tom2관: ['tom 2관', '티오엠 2관', '톰 2관'],
};

@Injectable()
export class RagQueryParser {
  constructor(private readonly prisma: PrismaService) {}

  async parse(question: string): Promise<RagQuestionFilters> {
    const normalized = question.trim();
    const [theaters, musicals] = await Promise.all([
      this.prisma.theater.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.musical.findMany({
        select: { id: true, title: true },
        orderBy: { title: 'asc' },
      }),
    ]);

    const theater = this.findBestNameMatch(normalized, theaters, 'name');
    const musical = this.findBestNameMatch(normalized, musicals, 'title');

    const seat = this.extractSeat(normalized);
    const asksRange = this.extractAsksRange(normalized);

    if (asksRange && seat.seatRow && !/^\d+$/.test(seat.seatRow)) {
      delete seat.seatRow;
    }

    return {
      ...(theater
        ? {
            theaterId: theater.id.toString(),
            theaterName: theater.name,
          }
        : {}),
      ...(musical
        ? {
            musicalId: musical.id.toString(),
            musicalTitle: musical.title,
          }
        : {}),
      ...seat,
      side: this.extractSide(normalized),
      ...this.extractTag(normalized),
      asksRange,
      intent: this.extractIntent(normalized),
    };
  }

  private findBestNameMatch<T extends { id: bigint }>(
    question: string,
    items: T[],
    key: keyof T & string,
  ) {
    const normalizedQuestion = this.compact(question);
    const matches = items
      .map((item) => {
        const value = item[key];

        if (typeof value !== 'string') {
          return null;
        }

        const aliases = this.buildNameAliases(value);
        const alias = aliases.find((candidate) =>
          normalizedQuestion.includes(this.compact(candidate)),
        );

        return alias ? { item, score: this.compact(alias).length } : null;
      })
      .filter((item): item is { item: T; score: number } => Boolean(item))
      .sort((a, b) => b.score - a.score);

    return matches[0]?.item;
  }

  private buildNameAliases(value: string) {
    const aliases = new Set([value]);
    aliases.add(value.replace(/\s+/g, ''));
    aliases.add(value.replace(/\s*(대극장|신한카드홀|M씨어터|S씨어터|1관|2관)$/i, ''));
    aliases.add(value.split(/\s+/)[0]);
    theaterAliasMap[this.compact(value)]?.forEach((alias) => aliases.add(alias));
    return Array.from(aliases).filter(Boolean);
  }

  private compact(value: string) {
    return value.toLowerCase().replace(/\s+/g, '');
  }

  private extractSeat(question: string) {
    const floorMatch = question.match(/(\d+)\s*(층|F)/i);
    const sectionMatch = question.match(/([A-Z0-9가-힣]+)\s*(구역|블록|블럭)/i);
    const rowMatch = question.match(/(\d+|[A-Z가-힣]+)\s*(열|row)/i);
    const numberMatch = question.match(/(\d+)\s*(번|번석|좌석)/);

    return {
      ...(floorMatch
        ? {
            seatFloor: `${floorMatch[1]}${this.normalizeFloorUnit(floorMatch[2])}`,
          }
        : {}),
      ...(sectionMatch
        ? { seatSection: sectionMatch[1].trim().toUpperCase() }
        : {}),
      ...(rowMatch ? { seatRow: rowMatch[1].trim().toUpperCase() } : {}),
      ...(numberMatch ? { seatNumber: numberMatch[1] } : {}),
    };
  }

  private normalizeFloorUnit(unit: string) {
    return unit.toUpperCase() === 'F' ? 'F' : '층';
  }

  private extractSide(question: string) {
    if (
      /(왼쪽|좌측|왼블|좌블|왼쪽블록|왼쪽블럭|좌측블록|좌측블럭)/.test(question)
    ) {
      return 'left' as const;
    }

    if (
      /(오른쪽|우측|오블|우블|오른쪽블록|오른쪽블럭|우측블록|우측블럭)/.test(
        question,
      )
    ) {
      return 'right' as const;
    }

    if (/(중앙|중블|중앙블록|중앙블럭|가운데|센터)/.test(question)) {
      return 'center' as const;
    }

    return undefined;
  }

  private extractTag(question: string) {
    if (/(시야\s*방해|시야방해|시방|가림|난간)/.test(question)) {
      return { tagName: '시야방해' };
    }

    return {};
  }

  private extractAsksRange(question: string) {
    return /(몇\s*열까지|어디까지|어느\s*열까지|범위|까지야|까지니)/.test(
      question,
    );
  }

  private extractIntent(question: string): RagIntent {
    if (/(표정|얼굴|배우|배역|가까이)/.test(question)) {
      return 'expression';
    }

    if (
      /(시야|보임|가림|시방|시야방해|멀어|가까워|앞사람|난간|잘 보여|잘보여)/.test(
        question,
      )
    ) {
      return 'view';
    }

    if (/(전체|무대|군무|영상|연출|동선 전체)/.test(question)) {
      return 'stageVisibility';
    }

    if (/(음향|소리|넘버|오케|스피커|대사)/.test(question)) {
      return 'sound';
    }

    if (
      /(편한|편해|안락|불편|다리|허리|좁고|장시간|착석|좌석감|오래 앉아)/.test(
        question,
      )
    ) {
      return 'comfort';
    }

    return 'general';
  }
}
