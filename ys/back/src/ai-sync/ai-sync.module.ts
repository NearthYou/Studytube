import { Global, Module } from '@nestjs/common';
import { AiSyncService } from './ai-sync.service';

@Global()
@Module({
  providers: [AiSyncService],
  exports: [AiSyncService],
})
export class AiSyncModule {}
