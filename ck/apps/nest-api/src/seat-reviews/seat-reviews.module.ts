import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/database/database.module';
import { SeatReviewsController } from './seat-reviews.controller';
import { SeatReviewsService } from './seat-reviews.service';
import { RagModule } from 'src/rag/rag.module';

@Module({
  imports: [DatabaseModule, RagModule],
  controllers: [SeatReviewsController],
  providers: [SeatReviewsService],
})
export class SeatReviewsModule {}
