import { Injectable, NotFoundException } from '@nestjs/common';
import { PostsRepository } from '../posts/repositories/posts.repository';
import { UsersRepository } from './repositories/users.repository';
import { GetUserPostsQueryDto } from './dto/get-user-posts.query.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly postsRepository: PostsRepository,
  ) {}

  async getUserProfile(userId: number) {
    const user = await this.usersRepository.findUserById(userId);

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    return {
      user,
    };
  }

  async getUserPosts(userId: number, query: GetUserPostsQueryDto) {
    const user = await this.usersRepository.findUserById(userId);

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const result = await this.postsRepository.findPostsByAuthorId(
      userId,
      query.page,
      query.limit,
    );

    return {
      user,
      items: result.items,
      totalCount: result.totalCount,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(result.totalCount / query.limit)),
    };
  }
}
