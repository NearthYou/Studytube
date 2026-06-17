import { Controller, Get, Param, Query } from '@nestjs/common';
import { TagSeatReviewQueryDto } from './dto/tag-seat-review-query.dto';
import { TagsService } from './tags.service';

@Controller('tags')
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Get()
  findAll() {
    return this.tagsService.findAll();
  }

  @Get(':tagId/seat-reviews')
  findSeatReviews(
    @Param('tagId') tagId: string,
    @Query() query: TagSeatReviewQueryDto,
  ) {
    return this.tagsService.findSeatReviews(tagId, query);
  }
}
