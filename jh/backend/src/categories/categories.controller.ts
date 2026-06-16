import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { BigIntIdPipe } from '../common/pipes/bigint-id.pipe';
import { ListPostsDto } from '../posts/dto/list-posts.dto';
import { PostsService } from '../posts/posts.service';
import { CategoriesService } from './categories.service';

@Controller('categories')
export class CategoriesController {
  constructor(
    private readonly categoriesService: CategoriesService,
    private readonly postsService: PostsService,
  ) {}

  @Get()
  findAll() {
    return this.categoriesService.findAll();
  }

  @Get(':categoryId/posts')
  @UseGuards(OptionalJwtAuthGuard)
  async findPostsByCategory(
    @Param('categoryId', BigIntIdPipe) categoryId: string,
    @Query() dto: ListPostsDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    await this.categoriesService.findOneOrThrow(categoryId);
    return this.postsService.findByCategory(categoryId, dto, user);
  }
}
