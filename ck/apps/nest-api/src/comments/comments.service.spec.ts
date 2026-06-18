import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { CommentsService } from './comments.service';

describe('CommentsService', () => {
  const now = new Date('2026-06-12T00:00:00.000Z');
  const user: AuthenticatedUser = { id: '7', email: 'user@example.com' };

  const makePrisma = () => ({
    seatReview: {
      findUnique: jest.fn(),
    },
    comment: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    commentLike: {
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
  });

  const commentWithAuthor = {
    id: 3n,
    seatReviewId: 11n,
    authorId: 7n,
    parentId: null,
    content: 'Good comment for @musicalFan',
    createdAt: now,
    updatedAt: now,
    author: {
      id: 7n,
      nickname: 'musical-fan',
    },
    _count: {
      replies: 0,
      likes: 0,
    },
    replies: [],
  };

  const publicComment = {
    id: '3',
    seatReviewId: '11',
    parentId: null,
    author: {
      id: '7',
      nickname: 'musical-fan',
    },
    content: 'Good comment for @musicalFan',
    mentions: ['musicalFan'],
    replyCount: 0,
    likeCount: 0,
    likedByMe: false,
    replies: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  it('creates a top-level comment for an existing seat review', async () => {
    const prisma = makePrisma();
    prisma.seatReview.findUnique.mockResolvedValue({ id: 11n });
    prisma.comment.create.mockResolvedValue(commentWithAuthor);

    const service = new CommentsService(prisma as never);

    await expect(
      service.create('11', user, { content: '  Good comment for @musicalFan  ' }),
    ).resolves.toEqual(publicComment);

    expect(prisma.comment.create).toHaveBeenCalledWith({
      data: {
        seatReviewId: 11n,
        authorId: 7n,
        parentId: null,
        content: 'Good comment for @musicalFan',
      },
      include: expect.any(Object),
    });
  });

  it('creates one-level replies under a top-level comment', async () => {
    const prisma = makePrisma();
    prisma.seatReview.findUnique.mockResolvedValue({ id: 11n });
    prisma.comment.findUnique.mockResolvedValue({
      id: 3n,
      seatReviewId: 11n,
      parentId: null,
      moderationStatus: 'VISIBLE',
      deletedAt: null,
    });
    prisma.comment.create.mockResolvedValue({
      ...commentWithAuthor,
      id: 4n,
      parentId: 3n,
      content: 'Reply for @seatmate',
    });

    const service = new CommentsService(prisma as never);

    await expect(
      service.create('11', user, {
        content: ' Reply for @seatmate ',
        parentId: '3',
      }),
    ).resolves.toMatchObject({
      id: '4',
      parentId: '3',
      mentions: ['seatmate'],
    });

    expect(prisma.comment.create).toHaveBeenCalledWith({
      data: {
        seatReviewId: 11n,
        authorId: 7n,
        parentId: 3n,
        content: 'Reply for @seatmate',
      },
      include: expect.any(Object),
    });
  });

  it('rejects nested replies', async () => {
    const prisma = makePrisma();
    prisma.seatReview.findUnique.mockResolvedValue({ id: 11n });
    prisma.comment.findUnique.mockResolvedValue({
      id: 3n,
      seatReviewId: 11n,
      parentId: 2n,
      moderationStatus: 'VISIBLE',
      deletedAt: null,
    });

    const service = new CommentsService(prisma as never);

    await expect(
      service.create('11', user, { content: 'Nested reply', parentId: '3' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lists top-level comments with counts', async () => {
    const prisma = makePrisma();
    prisma.seatReview.findUnique.mockResolvedValue({ id: 11n });
    prisma.comment.findMany.mockResolvedValue([commentWithAuthor]);
    prisma.comment.count.mockResolvedValue(1);
    prisma.$transaction.mockImplementation((queries: unknown[]) =>
      Promise.all(queries),
    );

    const service = new CommentsService(prisma as never);

    await expect(service.findBySeatReview('11', {})).resolves.toEqual({
      items: [publicComment],
      total: 1,
      sort: 'oldest',
    });

    expect(prisma.comment.findMany).toHaveBeenCalledWith({
      where: {
        seatReviewId: 11n,
        parentId: null,
        moderationStatus: 'VISIBLE',
        deletedAt: null,
      },
      include: expect.any(Object),
      orderBy: { createdAt: 'asc' },
    });
  });

  it('updates only comments written by the current user', async () => {
    const prisma = makePrisma();
    prisma.comment.findUnique.mockResolvedValue({ id: 3n, authorId: 7n });
    prisma.comment.update.mockResolvedValue({
      ...commentWithAuthor,
      content: 'Updated comment',
    });

    const service = new CommentsService(prisma as never);

    await expect(
      service.update('3', user, { content: '  Updated comment  ' }),
    ).resolves.toMatchObject({
      id: '3',
      content: 'Updated comment',
    });

    expect(prisma.comment.update).toHaveBeenCalledWith({
      where: { id: 3n },
      data: { content: 'Updated comment' },
      include: expect.any(Object),
    });
  });

  it("blocks updating another user's comment", async () => {
    const prisma = makePrisma();
    prisma.comment.findUnique.mockResolvedValue({ id: 3n, authorId: 99n });

    const service = new CommentsService(prisma as never);

    await expect(
      service.update('3', user, { content: 'Updated comment' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('likes and unlikes a comment', async () => {
    const prisma = makePrisma();
    prisma.comment.findUnique.mockResolvedValue({ id: 3n });

    const service = new CommentsService(prisma as never);

    await expect(service.like('3', user)).resolves.toEqual({ liked: true });
    expect(prisma.commentLike.create).toHaveBeenCalledWith({
      data: { commentId: 3n, userId: 7n },
    });

    await expect(service.unlike('3', user)).resolves.toEqual({ liked: false });
    expect(prisma.commentLike.deleteMany).toHaveBeenCalledWith({
      where: { commentId: 3n, userId: 7n },
    });
  });

  it('returns a conflict when liking an already-liked comment', async () => {
    const prisma = makePrisma();
    prisma.comment.findUnique.mockResolvedValue({ id: 3n });
    prisma.commentLike.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate like', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    const service = new CommentsService(prisma as never);

    await expect(service.like('3', user)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('deletes only comments written by the current user', async () => {
    const prisma = makePrisma();
    prisma.comment.findUnique.mockResolvedValue({ id: 3n, authorId: 7n });
    prisma.comment.delete.mockResolvedValue({ id: 3n });

    const service = new CommentsService(prisma as never);

    await expect(service.remove('3', user)).resolves.toEqual({ deleted: true });
    expect(prisma.comment.delete).toHaveBeenCalledWith({ where: { id: 3n } });
  });
});
