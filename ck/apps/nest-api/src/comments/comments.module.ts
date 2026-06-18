import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/database/database.module';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';

@Module({
  imports: [DatabaseModule],
  controllers: [CommentsController],
  providers: [CommentsService],
})
export class CommentsModule {}
