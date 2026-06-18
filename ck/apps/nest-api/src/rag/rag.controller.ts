import { Body, Controller, Param, Post } from '@nestjs/common';
import { AskRagQuestionDto } from './dto/ask-rag-question.dto';
import { RagService } from './rag.service';

@Controller('rag')
export class RagController {
  constructor(private readonly ragService: RagService) {}

  @Post('questions')
  ask(@Body() dto: AskRagQuestionDto) {
    return this.ragService.ask(dto.question, dto.limit);
  }

  @Post('index/:reviewId')
  indexOne(@Param('reviewId') reviewId: string) {
    return this.ragService.upsertReviewEmbedding(BigInt(reviewId));
  }

  @Post('index')
  indexAll() {
    return this.ragService.reindexAll();
  }
}
