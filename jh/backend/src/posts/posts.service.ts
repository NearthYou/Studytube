import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { mkdir, unlink } from 'node:fs/promises';
import { parse } from 'node:path';
import sharp from 'sharp';
import {
  DataSource,
  EntityManager,
  In,
  IsNull,
  LessThan,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { CategoryEntity } from '../categories/category.entity';
import { CommentEntity } from '../comments/comment.entity';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { reencodeImageFileToWebp } from '../common/upload/image-upload';
import {
  getUploadPublicPrefix,
  toUploadLocalPath,
} from '../common/upload/upload-paths';
import { PostLikeEntity } from '../likes/post-like.entity';
import { CreatePostDto } from './dto/create-post.dto';
import { ListPostsDto } from './dto/list-posts.dto';
import { SearchPostsDto } from './dto/search-posts.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { PostImageEntity } from './entities/post-image.entity';
import { PostEntity } from './entities/post.entity';
import { TagEntity } from './entities/tag.entity';

interface PaginationInput {
  page?: number;
  limit?: number;
  categoryId?: string;
  sort?: 'latest' | 'popular' | 'views';
  tag?: string;
}

interface PostStats {
  likeCounts: Map<string, number>;
  commentCounts: Map<string, number>;
  likedPostIds: Set<string>;
}

interface PostImageVariantPaths {
  thumbnailPath: string;
  cardPath: string;
  detailPath: string;
}

const CATEGORY_VALUE_BY_NAME: Record<string, string> = {
  일상: 'daily',
  산책: 'walk',
  돌봄: 'care',
  질문: 'question',
};

const POST_IMAGE_CANONICAL_MAX_DIMENSION = 1600;
const POST_IMAGE_MAX_INPUT_PIXELS = 24_000_000;
const POST_IMAGE_WEBP_QUALITY = 86;
const POST_IMAGE_VARIANTS = [
  {
    column: 'thumbnailPath',
    suffix: 'thumbnail',
    width: 480,
    quality: 80,
  },
  {
    column: 'cardPath',
    suffix: 'card',
    width: 960,
    quality: 82,
  },
  {
    column: 'detailPath',
    suffix: 'detail',
    width: 1600,
    quality: 86,
  },
] as const;

@Injectable()
export class PostsService implements OnModuleInit {
  private readonly logger = new Logger(PostsService.name);
  private orphanCleanupTimer?: NodeJS.Timeout;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(PostEntity)
    private readonly postsRepository: Repository<PostEntity>,
    @InjectRepository(CategoryEntity)
    private readonly categoriesRepository: Repository<CategoryEntity>,
    @InjectRepository(PostImageEntity)
    private readonly postImagesRepository: Repository<PostImageEntity>,
    @InjectRepository(PostLikeEntity)
    private readonly postLikesRepository: Repository<PostLikeEntity>,
    @InjectRepository(CommentEntity)
    private readonly commentsRepository: Repository<CommentEntity>,
  ) {}

  onModuleInit() {
    void this.cleanupOrphanImages();

    this.orphanCleanupTimer = setInterval(
      () => void this.cleanupOrphanImages(),
      this.getOrphanCleanupIntervalMs(),
    );
    this.orphanCleanupTimer.unref?.();
  }

  async findAll(dto: ListPostsDto, user?: AuthenticatedUser) {
    return this.findPagedPosts(dto, user);
  }

  async search(dto: SearchPostsDto, user?: AuthenticatedUser) {
    const keyword = dto.keyword.trim();

    if (!keyword) {
      throw new BadRequestException('검색어를 입력해주세요.');
    }

    return this.findPagedPosts(dto, user, keyword);
  }

  async findByCategory(
    categoryId: string,
    dto: ListPostsDto,
    user?: AuthenticatedUser,
  ) {
    return this.findPagedPosts({ ...dto, categoryId }, user);
  }

  async findOne(postId: string, user?: AuthenticatedUser) {
    this.assertId(postId);

    const post = await this.postsRepository.findOne({
      where: { id: postId },
      relations: {
        author: true,
        categories: true,
        images: true,
        tags: true,
      },
    });

    if (!post) {
      throw new NotFoundException('게시글을 찾을 수 없습니다.');
    }

    const stats = await this.getPostStats([post.id], user?.id);

    return this.toPostResponse(post, stats, user);
  }

  async create(dto: CreatePostDto, user: AuthenticatedUser) {
    const postId = await this.dataSource.transaction(async (manager) => {
      const categories = await this.getCategoriesOrThrow(dto.categoryIds);
      const tags = await this.getTagsForPost(dto.tagNames, manager);
      const imageIds = dto.imageIds ?? [];

      if (imageIds.length > 1) {
        throw new BadRequestException(
          '이미지는 최대 1장만 첨부할 수 있습니다.',
        );
      }

      const post = manager.create(PostEntity, {
        userId: user.id,
        title: dto.title.trim(),
        content: dto.content.trim(),
        categories,
        tags,
      });
      const savedPost = await manager.save(post);

      if (imageIds.length > 0) {
        const images = await manager.findBy(PostImageEntity, {
          id: In(imageIds),
        });

        this.assertEditableImages(images, imageIds, user.id, null);

        for (const image of images) {
          image.postId = savedPost.id;
        }

        await manager.save(images);
      }

      return savedPost.id;
    });

    return {
      message: '게시글이 등록되었습니다.',
      post: await this.findOne(postId, user),
    };
  }

  async update(postId: string, dto: UpdatePostDto, user: AuthenticatedUser) {
    this.assertId(postId);
    const deletedFilePaths: string[] = [];

    await this.dataSource.transaction(async (manager) => {
      const post = await manager.findOne(PostEntity, {
        where: { id: postId },
        relations: {
          categories: true,
          images: true,
          tags: true,
        },
      });

      if (!post) {
        throw new NotFoundException('게시글을 찾을 수 없습니다.');
      }

      this.assertPostOwner(post, user);

      if (dto.title !== undefined) {
        post.title = dto.title.trim();
      }

      if (dto.content !== undefined) {
        post.content = dto.content.trim();
      }

      if (dto.categoryIds !== undefined) {
        post.categories = await this.getCategoriesOrThrow(dto.categoryIds);
      }

      if (dto.tagNames !== undefined) {
        post.tags = await this.getTagsForPost(dto.tagNames, manager);
      }

      post.updatedAt = new Date();
      await manager.save(post);

      if (dto.imageIds !== undefined) {
        if (dto.imageIds.length > 1) {
          throw new BadRequestException(
            '이미지는 최대 1장만 첨부할 수 있습니다.',
          );
        }

        const images =
          dto.imageIds.length > 0
            ? await manager.findBy(PostImageEntity, { id: In(dto.imageIds) })
            : [];

        this.assertEditableImages(images, dto.imageIds, user.id, post.id);

        const nextImageIds = new Set(dto.imageIds);
        const removedImages = post.images.filter(
          (image) => !nextImageIds.has(image.id),
        );

        for (const image of removedImages) {
          deletedFilePaths.push(...this.getImageFilePaths(image));
        }

        if (removedImages.length > 0) {
          await manager.remove(removedImages);
        }

        for (const image of images) {
          image.postId = post.id;
        }

        await manager.save(images);
      }
    });

    await this.deleteFiles(deletedFilePaths);

    return {
      message: '게시글이 수정되었습니다.',
      post: await this.findOne(postId, user),
    };
  }

  async remove(postId: string, user: AuthenticatedUser) {
    this.assertId(postId);
    const post = await this.postsRepository.findOne({
      where: { id: postId },
      relations: {
        images: true,
      },
    });

    if (!post) {
      throw new NotFoundException('게시글을 찾을 수 없습니다.');
    }

    this.assertPostOwner(post, user);

    const filePaths = post.images.flatMap((image) =>
      this.getImageFilePaths(image),
    );
    await this.postsRepository.delete({ id: post.id });
    await this.deleteFiles(filePaths);

    return {
      message: '게시글이 삭제되었습니다.',
      postId,
    };
  }

  async incrementViews(postId: string) {
    this.assertId(postId);

    const result = await this.postsRepository.increment(
      { id: postId },
      'views',
      1,
    );

    if (!result.affected) {
      throw new NotFoundException('게시글을 찾을 수 없습니다.');
    }

    const post = await this.postsRepository.findOne({
      where: { id: postId },
      select: {
        id: true,
        views: true,
      },
    });

    return {
      message: '조회수가 증가했습니다.',
      postId,
      views: post?.views ?? 0,
    };
  }

  async uploadImages(files: Express.Multer.File[], user: AuthenticatedUser) {
    if (!files.length) {
      throw new BadRequestException('업로드할 이미지를 선택해주세요.');
    }

    if (files.length > 1) {
      await this.deleteFiles(
        files.map(
          (file) => `${this.getPostImagePublicPathPrefix()}/${file.filename}`,
        ),
      );
      throw new BadRequestException('이미지는 최대 1장만 첨부할 수 있습니다.');
    }

    const originalFilePaths = files.map(
      (file) => `${this.getPostImagePublicPathPrefix()}/${file.filename}`,
    );
    const createdVariantFilePaths: string[] = [];

    try {
      const imageRecords = await Promise.all(
        files.map(async (file) => {
          const filePath = `${this.getPostImagePublicPathPrefix()}/${file.filename}`;
          const normalizedImage = await reencodeImageFileToWebp(
            toUploadLocalPath(filePath),
            {
              maxHeight: POST_IMAGE_CANONICAL_MAX_DIMENSION,
              maxInputPixels: POST_IMAGE_MAX_INPUT_PIXELS,
              maxWidth: POST_IMAGE_CANONICAL_MAX_DIMENSION,
              quality: POST_IMAGE_WEBP_QUALITY,
            },
          );
          const variantPaths = await this.createImageVariants(file);

          createdVariantFilePaths.push(
            variantPaths.thumbnailPath,
            variantPaths.cardPath,
            variantPaths.detailPath,
          );

          return this.postImagesRepository.create({
            userId: user.id,
            postId: null,
            originalFilename: file.originalname,
            storedFilename: file.filename,
            filePath,
            ...variantPaths,
            fileSize: String(normalizedImage.fileSize),
            mimeType: 'image/webp',
          });
        }),
      );
      const images = await this.postImagesRepository.save(imageRecords);

      return {
        message: '이미지가 업로드되었습니다.',
        images: images.map((image) => this.toImageResponse(image)),
      };
    } catch (error) {
      await this.deleteFiles([
        ...originalFilePaths,
        ...createdVariantFilePaths,
      ]);
      throw error;
    }
  }

  async deleteImage(imageId: string, user: AuthenticatedUser) {
    this.assertId(imageId);

    const image = await this.postImagesRepository.findOne({
      where: { id: imageId },
      relations: {
        post: true,
      },
    });

    if (!image) {
      throw new NotFoundException('이미지를 찾을 수 없습니다.');
    }

    if (image.userId !== user.id && image.post?.userId !== user.id) {
      throw new ForbiddenException('이미지를 삭제할 권한이 없습니다.');
    }

    await this.postImagesRepository.delete({ id: image.id });
    await this.deleteFiles(this.getImageFilePaths(image));

    return {
      message: '이미지가 삭제되었습니다.',
      imageId,
    };
  }

  async cleanupOrphanImages() {
    const cutoff = new Date(Date.now() - this.getOrphanMaxAgeMs());
    const orphanImages = await this.postImagesRepository.find({
      where: {
        postId: IsNull(),
        createdAt: LessThan(cutoff),
      },
      take: 100,
    });

    if (!orphanImages.length) {
      return {
        deletedCount: 0,
      };
    }

    await this.postImagesRepository.delete({
      id: In(orphanImages.map((image) => image.id)),
    });
    await this.deleteFiles(
      orphanImages.flatMap((image) => this.getImageFilePaths(image)),
    );

    this.logger.log(`Deleted ${orphanImages.length} orphan post image(s).`);

    return {
      deletedCount: orphanImages.length,
    };
  }

  private async findPagedPosts(
    dto: PaginationInput,
    user?: AuthenticatedUser,
    keyword?: string,
  ) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 12;
    const query = this.createPostListQuery(dto, keyword);
    const [posts, totalCount] = await query
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    const stats = await this.getPostStats(
      posts.map((post) => post.id),
      user?.id,
    );

    return {
      message: '게시글 목록을 조회했습니다.',
      items: posts.map((post) => this.toPostResponse(post, stats, user)),
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  private createPostListQuery(
    dto: PaginationInput,
    keyword?: string,
  ): SelectQueryBuilder<PostEntity> {
    const query = this.postsRepository
      .createQueryBuilder('post')
      .leftJoinAndSelect('post.author', 'author')
      .leftJoinAndSelect('post.categories', 'category')
      .leftJoinAndSelect('post.images', 'image')
      .leftJoinAndSelect('post.tags', 'tag');

    if (dto.categoryId) {
      query.innerJoin(
        'post.categories',
        'filterCategory',
        'filterCategory.id = :categoryId',
        { categoryId: dto.categoryId },
      );
    }

    const filterTagName = this.normalizeTagName(dto.tag);

    if (filterTagName) {
      query.innerJoin(
        'post.tags',
        'filterTag',
        'filterTag.name = :filterTagName',
        { filterTagName },
      );
    }

    if (keyword) {
      query.andWhere(
        '(post.title ILIKE :keyword OR post.content ILIKE :keyword OR author.nickname ILIKE :keyword OR category.name ILIKE :keyword OR tag.name ILIKE :keyword)',
        { keyword: `%${keyword}%` },
      );
    }

    if (dto.sort === 'popular') {
      query
        .addSelect(
          '(SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = post.post_id)',
          'like_count',
        )
        .orderBy('like_count', 'DESC')
        .addOrderBy('post.createdAt', 'DESC');
    } else if (dto.sort === 'views') {
      query.orderBy('post.views', 'DESC').addOrderBy('post.createdAt', 'DESC');
    } else {
      query.orderBy('post.createdAt', 'DESC');
    }

    return query;
  }

  private async getCategoriesOrThrow(categoryIds: string[]) {
    if (!categoryIds.length) {
      throw new BadRequestException('카테고리를 선택해주세요.');
    }

    const uniqueCategoryIds = [...new Set(categoryIds)];
    const categories = await this.categoriesRepository.findBy({
      id: In(uniqueCategoryIds),
    });

    if (categories.length !== uniqueCategoryIds.length) {
      throw new BadRequestException(
        '존재하지 않는 카테고리가 포함되어 있습니다.',
      );
    }

    return categories;
  }

  private async getTagsForPost(
    tagNames: string[] | undefined,
    manager: EntityManager = this.dataSource.manager,
  ) {
    const normalizedTagNames = this.normalizeTagNames(tagNames ?? []);

    if (!normalizedTagNames.length) {
      return [];
    }

    const existingTags = await manager.findBy(TagEntity, {
      name: In(normalizedTagNames),
    });
    const existingTagNames = new Set(existingTags.map((tag) => tag.name));
    const newTags = normalizedTagNames
      .filter((name) => !existingTagNames.has(name))
      .map((name) => manager.create(TagEntity, { name }));

    if (newTags.length > 0) {
      existingTags.push(...(await manager.save(TagEntity, newTags)));
    }

    const tagsByName = new Map(existingTags.map((tag) => [tag.name, tag]));

    return normalizedTagNames
      .map((name) => tagsByName.get(name))
      .filter((tag): tag is TagEntity => Boolean(tag));
  }

  private normalizeTagNames(tagNames: string[]) {
    const normalizedTagNames = tagNames
      .map((tagName) => this.normalizeTagName(tagName))
      .filter(Boolean);
    const uniqueTagNames = [...new Set(normalizedTagNames)];

    if (uniqueTagNames.length > 5) {
      throw new BadRequestException('태그는 최대 5개까지 입력할 수 있습니다.');
    }

    return uniqueTagNames;
  }

  private normalizeTagName(tagName?: string) {
    const normalized = (tagName ?? '')
      .trim()
      .replace(/^#+/, '')
      .trim()
      .toLowerCase();

    if (!normalized) {
      return '';
    }

    if (normalized.length > 20) {
      throw new BadRequestException('태그는 20자 이하로 입력해주세요.');
    }

    return normalized;
  }

  private async getPostStats(
    postIds: string[],
    currentUserId?: string,
  ): Promise<PostStats> {
    if (!postIds.length) {
      return {
        likeCounts: new Map(),
        commentCounts: new Map(),
        likedPostIds: new Set(),
      };
    }

    const [likeRows, commentRows, likedRows] = await Promise.all([
      this.postLikesRepository
        .createQueryBuilder('like')
        .select('like.postId', 'postId')
        .addSelect('COUNT(*)', 'count')
        .where('like.postId IN (:...postIds)', { postIds })
        .groupBy('like.postId')
        .getRawMany<{ postId: string; count: string }>(),
      this.commentsRepository
        .createQueryBuilder('comment')
        .select('comment.postId', 'postId')
        .addSelect('COUNT(*)', 'count')
        .where('comment.postId IN (:...postIds)', { postIds })
        .groupBy('comment.postId')
        .getRawMany<{ postId: string; count: string }>(),
      currentUserId
        ? this.postLikesRepository.findBy({
            userId: currentUserId,
            postId: In(postIds),
          })
        : Promise.resolve([]),
    ]);

    return {
      likeCounts: new Map(
        likeRows.map((row) => [String(row.postId), Number(row.count)]),
      ),
      commentCounts: new Map(
        commentRows.map((row) => [String(row.postId), Number(row.count)]),
      ),
      likedPostIds: new Set(likedRows.map((row) => row.postId)),
    };
  }

  private toPostResponse(
    post: PostEntity,
    stats: PostStats,
    user?: AuthenticatedUser,
  ) {
    const images = [...(post.images ?? [])].sort(
      (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
    );
    const categories = [...(post.categories ?? [])].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
    const tags = [...(post.tags ?? [])].sort((left, right) =>
      left.name.localeCompare(right.name),
    );

    return {
      id: post.id,
      title: post.title,
      content: post.content,
      body: post.content,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      views: post.views,
      author: {
        id: post.author?.id ?? post.userId,
        nickname: post.author?.nickname ?? '알 수 없음',
        profileImageUrl: post.author?.profileImageUrl ?? null,
      },
      categories: categories.map((category) =>
        this.toCategoryResponse(category),
      ),
      category: this.toCategoryResponse(categories[0]),
      tags: tags.map((tag) => this.toTagResponse(tag)),
      images: images.map((image) => this.toImageResponse(image)),
      thumbnailUrl: images[0] ? this.getCardImagePath(images[0]) : null,
      detailImageUrl: images[0] ? this.getDetailImagePath(images[0]) : null,
      likeCount: stats.likeCounts.get(post.id) ?? 0,
      commentCount: stats.commentCounts.get(post.id) ?? 0,
      likedByMe: stats.likedPostIds.has(post.id),
      isOwner: user?.id === post.userId,
    };
  }

  private toCategoryResponse(category?: CategoryEntity) {
    if (!category) {
      return null;
    }

    return {
      id: category.id,
      name: category.name,
      value: CATEGORY_VALUE_BY_NAME[category.name] ?? `category-${category.id}`,
    };
  }

  private toTagResponse(tag: TagEntity) {
    return {
      id: tag.id,
      name: tag.name,
    };
  }

  private toImageResponse(image: PostImageEntity) {
    return {
      id: image.id,
      url: image.filePath,
      thumbnailUrl: image.thumbnailPath ?? image.filePath,
      cardUrl: this.getCardImagePath(image),
      detailUrl: this.getDetailImagePath(image),
      originalUrl: image.filePath,
      originalFilename: image.originalFilename,
      fileSize: image.fileSize,
      mimeType: image.mimeType,
    };
  }

  private getCardImagePath(
    image: Pick<PostImageEntity, 'filePath' | 'cardPath'>,
  ) {
    return image.cardPath ?? image.filePath;
  }

  private getDetailImagePath(
    image: Pick<PostImageEntity, 'filePath' | 'detailPath'>,
  ) {
    return image.detailPath ?? image.filePath;
  }

  private assertEditableImages(
    images: PostImageEntity[],
    expectedImageIds: string[],
    userId: string,
    postId: string | null,
  ) {
    const uniqueImageIds = [...new Set(expectedImageIds)];

    if (images.length !== uniqueImageIds.length) {
      throw new BadRequestException(
        '존재하지 않는 이미지가 포함되어 있습니다.',
      );
    }

    for (const image of images) {
      if (image.userId !== userId) {
        throw new ForbiddenException('이미지를 사용할 권한이 없습니다.');
      }

      if (image.postId !== null && image.postId !== postId) {
        throw new BadRequestException(
          '이미 다른 게시글에 연결된 이미지입니다.',
        );
      }
    }
  }

  private assertPostOwner(
    post: Pick<PostEntity, 'userId'>,
    user: AuthenticatedUser,
  ) {
    if (post.userId !== user.id) {
      throw new ForbiddenException('게시글을 수정할 권한이 없습니다.');
    }
  }

  private assertId(id: string) {
    if (!/^\d+$/.test(id)) {
      throw new BadRequestException('올바른 ID 형식이 아닙니다.');
    }
  }

  private async createImageVariants(
    file: Express.Multer.File,
  ): Promise<PostImageVariantPaths> {
    const sourcePath = toUploadLocalPath(
      `${this.getPostImagePublicPathPrefix()}/${file.filename}`,
    );
    const variantDirectory = toUploadLocalPath(
      this.getPostImageVariantPublicPathPrefix(),
    );
    const parsedFilename = parse(file.filename);
    const variantPaths = {} as PostImageVariantPaths;

    await mkdir(variantDirectory, { recursive: true });

    for (const variant of POST_IMAGE_VARIANTS) {
      const publicPath = `${this.getPostImageVariantPublicPathPrefix()}/${parsedFilename.name}-${variant.suffix}.webp`;

      await sharp(sourcePath)
        .rotate()
        .resize({
          width: variant.width,
          withoutEnlargement: true,
        })
        .webp({ quality: variant.quality })
        .toFile(toUploadLocalPath(publicPath));

      variantPaths[variant.column] = publicPath;
    }

    return variantPaths;
  }

  private getImageFilePaths(
    image: Pick<
      PostImageEntity,
      'filePath' | 'thumbnailPath' | 'cardPath' | 'detailPath'
    >,
  ) {
    return [
      image.filePath,
      image.thumbnailPath,
      image.cardPath,
      image.detailPath,
    ].filter((filePath): filePath is string => Boolean(filePath));
  }

  private async deleteFiles(filePaths: string[]) {
    const uniqueFilePaths = [...new Set(filePaths)];
    const results = await Promise.allSettled(
      uniqueFilePaths.map((filePath) => unlink(toUploadLocalPath(filePath))),
    );

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.logger.warn(
          `Failed to delete upload file ${uniqueFilePaths[index]}: ${this.toErrorMessage(result.reason)}`,
        );
      }
    });
  }

  private getPostImagePublicPathPrefix() {
    return `${getUploadPublicPrefix()}/posts`;
  }

  private getPostImageVariantPublicPathPrefix() {
    return `${this.getPostImagePublicPathPrefix()}/variants`;
  }

  private toErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : 'Unknown error';
  }

  private getOrphanMaxAgeMs() {
    const hours = Number(process.env.POST_IMAGE_ORPHAN_MAX_AGE_HOURS ?? 24);

    return (Number.isFinite(hours) && hours > 0 ? hours : 24) * 60 * 60 * 1000;
  }

  private getOrphanCleanupIntervalMs() {
    const minutes = Number(
      process.env.POST_IMAGE_ORPHAN_CLEANUP_INTERVAL_MINUTES ?? 60,
    );

    return (Number.isFinite(minutes) && minutes > 0 ? minutes : 60) * 60 * 1000;
  }
}
