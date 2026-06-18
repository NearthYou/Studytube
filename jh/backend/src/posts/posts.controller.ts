import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { BigIntIdPipe } from '../common/pipes/bigint-id.pipe';
import { CreatePostDto } from './dto/create-post.dto';
import { ListPostsDto } from './dto/list-posts.dto';
import { SearchPostsDto } from './dto/search-posts.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { postImageUploadOptions } from './post-image-upload.options';
import { PostsService } from './posts.service';

@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  findAll(@Query() dto: ListPostsDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.postsService.findAll(dto, user);
  }

  @Get('search')
  @UseGuards(OptionalJwtAuthGuard)
  search(
    @Query() dto: SearchPostsDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.postsService.search(dto, user);
  }

  @Post('images')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FilesInterceptor('images', 1, postImageUploadOptions))
  uploadImages(
    @UploadedFiles() images: Express.Multer.File[] = [],
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.postsService.uploadImages(images, user);
  }

  @Delete('images/:imageId')
  @UseGuards(JwtAuthGuard)
  deleteImage(
    @Param('imageId', BigIntIdPipe) imageId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.postsService.deleteImage(imageId, user);
  }

  @Get(':postId')
  @UseGuards(OptionalJwtAuthGuard)
  findOne(
    @Param('postId', BigIntIdPipe) postId: string,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.postsService.findOne(postId, user);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Body() dto: CreatePostDto, @CurrentUser() user: AuthenticatedUser) {
    return this.postsService.create(dto, user);
  }

  @Patch(':postId')
  @UseGuards(JwtAuthGuard)
  update(
    @Param('postId', BigIntIdPipe) postId: string,
    @Body() dto: UpdatePostDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.postsService.update(postId, dto, user);
  }

  @Delete(':postId')
  @UseGuards(JwtAuthGuard)
  remove(
    @Param('postId', BigIntIdPipe) postId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.postsService.remove(postId, user);
  }

  @Post(':postId/views')
  incrementViews(@Param('postId', BigIntIdPipe) postId: string) {
    return this.postsService.incrementViews(postId);
  }
}
