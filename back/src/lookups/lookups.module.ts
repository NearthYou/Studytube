import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { LookupsController } from './lookups.controller';
import { LookupsService } from './lookups.service';
import { LookupsRepository } from './repositories/lookups.repository';

@Module({
  imports: [DatabaseModule],
  controllers: [LookupsController],
  providers: [LookupsService, LookupsRepository],
  exports: [LookupsService],
})
export class LookupsModule {}
