import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { PerformanceQueryDto } from './dto/performance-query.dto';

// 화면에서 선택지로 쓸 메타데이터를 DB에서 가져오는 서비스
@Injectable()
export class MetadataService {
  constructor(private readonly prisma: PrismaService) {}

  async getTheaters() {
    const theaters = await this.prisma.theater.findMany({
      orderBy: { name: 'asc' },
    });

    return theaters.map((theater) => ({
      id: theater.id.toString(),
      name: theater.name,
    }));
  }

  async getMusicals() {
    const musicals = await this.prisma.musical.findMany({
      orderBy: { title: 'asc' },
    });

    return musicals.map((musical) => ({
      id: musical.id.toString(),
      name: musical.title,
    }));
  }

  async getPerformances(query: PerformanceQueryDto) {
    const where = {
      ...(query.theaterId ? { theaterId: BigInt(query.theaterId) } : {}),
      ...(query.musicalId ? { musicalId: BigInt(query.musicalId) } : {}),
    };

    const performances = await this.prisma.performance.findMany({
      where,
      include: {
        theater: true,
        musical: true,
      },
      orderBy: [
        { theater: { name: 'asc' } },
        { musical: { title: 'asc' } },
        { seasonLabel: 'desc' },
      ],
    });

    const labeledPerformanceKeys = new Set(
      performances
        .filter((performance) => performance.seasonLabel)
        .map(
          (performance) =>
            `${performance.theaterId.toString()}::${performance.musicalId.toString()}`,
        ),
    );

    const visiblePerformances = performances.filter((performance) => {
      const key = `${performance.theaterId.toString()}::${performance.musicalId.toString()}`;

      return performance.seasonLabel || !labeledPerformanceKeys.has(key);
    });

    return visiblePerformances.map((performance) => ({
      id: performance.id.toString(),
      theaterId: performance.theaterId.toString(),
      theaterName: performance.theater.name,
      musicalId: performance.musicalId.toString(),
      musicalTitle: performance.musical.title,
      seasonLabel: performance.seasonLabel,
      displayTitle: [performance.seasonLabel, performance.musical.title]
        .filter(Boolean)
        .join(' '),
    }));
  }
}
