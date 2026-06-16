import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FollowsRepository } from './repositories/follows.repository';

@Injectable()
export class FollowsService {
  constructor(private readonly followsRepository: FollowsRepository) {}

  async followUser(followerId: number, followingId: number) {
    if (followerId === followingId) {
      throw new BadRequestException('You cannot follow yourself.');
    }

    const exists = await this.followsRepository.existsUser(followingId);

    if (!exists) {
      throw new NotFoundException('User not found.');
    }

    await this.followsRepository.addFollow(followerId, followingId);

    return {
      message: 'Followed user.',
      userId: followingId,
      following: true,
    };
  }

  async unfollowUser(followerId: number, followingId: number) {
    if (followerId === followingId) {
      throw new BadRequestException('You cannot unfollow yourself.');
    }

    const exists = await this.followsRepository.existsUser(followingId);

    if (!exists) {
      throw new NotFoundException('User not found.');
    }

    await this.followsRepository.removeFollow(followerId, followingId);

    return {
      message: 'Unfollowed user.',
      userId: followingId,
      following: false,
    };
  }

  async getFollowers(userId: number, page: number, limit: number) {
    const result = await this.followsRepository.findFollowers(userId, page, limit);

    return {
      items: result.items,
      totalCount: result.totalCount,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(result.totalCount / limit)),
    };
  }

  async getFollowings(userId: number, page: number, limit: number) {
    const result = await this.followsRepository.findFollowings(userId, page, limit);

    return {
      items: result.items,
      totalCount: result.totalCount,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(result.totalCount / limit)),
    };
  }
}
