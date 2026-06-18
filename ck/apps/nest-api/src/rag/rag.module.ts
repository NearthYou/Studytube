import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/database/database.module';
import { OpenAiRagClient } from './openai-rag.client';
import { RagController } from './rag.controller';
import { RagQueryParser } from './rag-query-parser';
import { RagService } from './rag.service';

@Module({
  imports: [DatabaseModule],
  controllers: [RagController],
  providers: [OpenAiRagClient, RagQueryParser, RagService],
  exports: [RagService],
})
export class RagModule {}
