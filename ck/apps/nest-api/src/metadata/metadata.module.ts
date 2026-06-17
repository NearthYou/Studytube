import { DatabaseModule } from 'src/database/database.module';
import { Module } from '@nestjs/common';
import { MetadataController } from './metadata.controller';
import { MetadataService } from './metadata.service';

@Module({
  imports: [DatabaseModule],
  controllers: [MetadataController],
  providers: [MetadataService],
})
export class MetadataModule {}
