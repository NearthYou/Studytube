import { Controller, Get, Query } from '@nestjs/common';
import { MetadataService } from './metadata.service';
import { PerformanceQueryDto } from './dto/performance-query.dto';

// HTTP 요청을 받아서 어떤 서비스 함수로 실행할지 연결
@Controller()
export class MetadataController {
  constructor(private readonly metadataService: MetadataService) {}

  @Get('theaters')
  getTheaters() {
    return this.metadataService.getTheaters();
  }

  @Get('musicals')
  getMusicals() {
    return this.metadataService.getMusicals();
  }

  @Get('performances')
  getPerformances(@Query() query: PerformanceQueryDto) {
    return this.metadataService.getPerformances(query);
  }
}
