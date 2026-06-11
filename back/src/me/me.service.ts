import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthService } from '../auth/auth.service';
import { CommentsRepository } from '../comments/repositories/comments.repository';
import { FollowsRepository } from '../follows/repositories/follows.repository';
import { PostsRepository } from '../posts/repositories/posts.repository';
import { UsersRepository } from '../users/repositories/users.repository';
import { GetMyBookmarksQueryDto } from './dto/get-my-bookmarks.query.dto';
import { GetMyCommentsQueryDto } from './dto/get-my-comments.query.dto';
import { GetMyPostsQueryDto } from './dto/get-my-posts.query.dto';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';

@Injectable()
export class MeService {
  constructor(
    private readonly authService: AuthService,
    private readonly usersRepository: UsersRepository,
    private readonly postsRepository: PostsRepository,
    private readonly commentsRepository: CommentsRepository,
    private readonly followsRepository: FollowsRepository,
  ) {}

  async getMe(userId: number) {
    return this.authService.getMe(userId);
  }

  async updateMyProfile(userId: number, dto: UpdateMyProfileDto) {
    const currentUser = await this.usersRepository.findUserById(userId);

    if (!currentUser) {
      throw new NotFoundException('User not found.');
    }

    if (
      dto.nickname &&
      (await this.usersRepository.isNicknameTakenByAnotherUser(
        userId,
        dto.nickname,
      ))
    ) {
      throw new ConflictException('Nickname is already in use.');
    }

    const passwordHash = dto.password
      ? await argon2.hash(dto.password)
      : undefined;

    const user = await this.usersRepository.updateUserProfile({
      userId,
      nickname: dto.nickname,
      passwordHash,
      bio: dto.bio,
      location: dto.location,
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    return {
      message: 'Profile updated.',
      user,
    };
  }

  async getMyPosts(userId: number, query: GetMyPostsQueryDto) {
    const result = await this.postsRepository.findPostsByAuthorId(
      userId,
      query.page,
      query.limit,
    );

    return {
      items: result.items,
      totalCount: result.totalCount,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(result.totalCount / query.limit)),
    };
  }

  async getMyBookmarks(userId: number, query: GetMyBookmarksQueryDto) {
    const result = await this.postsRepository.findBookmarkedPostsByUserId(
      userId,
      query.page,
      query.limit,
    );

    return {
      items: result.items,
      totalCount: result.totalCount,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(result.totalCount / query.limit)),
    };
  }

  async getMyComments(userId: number, query: GetMyCommentsQueryDto) {
    const result = await this.commentsRepository.findCommentsByAuthorId(
      userId,
      query.page,
      query.limit,
    );

    return {
      items: result.items,
      totalCount: result.totalCount,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(result.totalCount / query.limit)),
    };
  }

  async getMyFollows(userId: number, page: number, limit: number) {
    const result = await this.followsRepository.findFollowings(
      userId,
      page,
      limit,
    );

    return {
      items: result.items,
      totalCount: result.totalCount,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(result.totalCount / limit)),
    };
  }
}
