import { Injectable, NotFoundException } from '@nestjs/common';
import { BookmarksRepository } from './repositories/bookmarks.repository';

@Injectable()
export class BookmarksService {
  constructor(private readonly bookmarksRepository: BookmarksRepository) {}

  async addBookmark(userId: number, postId: number) {
    const exists = await this.bookmarksRepository.existsPost(postId);

    if (!exists) {
      throw new NotFoundException('Post not found.');
    }

    await this.bookmarksRepository.addBookmark(userId, postId);

    return {
      message: 'Bookmark added.',
      postId,
      bookmarked: true,
    };
  }

  async removeBookmark(userId: number, postId: number) {
    const exists = await this.bookmarksRepository.existsPost(postId);

    if (!exists) {
      throw new NotFoundException('Post not found.');
    }

    await this.bookmarksRepository.removeBookmark(userId, postId);

    return {
      message: 'Bookmark removed.',
      postId,
      bookmarked: false,
    };
  }
}
