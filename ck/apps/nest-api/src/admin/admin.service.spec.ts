import { NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { AdminService } from './admin.service';

describe('AdminService', () => {
  const admin: AuthenticatedUser = { id: '1', email: 'admin@example.com' };
  const reporter: AuthenticatedUser = { id: '7', email: 'user@example.com' };

  const makePrisma = () => ({
    seatReview: {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    comment: {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    reviewReport: {
      create: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    commentReport: {
      create: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    seatReviewEmbedding: { deleteMany: jest.fn() },
    seatReviewTag: { deleteMany: jest.fn() },
    $transaction: jest.fn((queries: unknown[]) => Promise.all(queries)),
  });

  it('creates a report for an existing review', async () => {
    const prisma = makePrisma();
    prisma.seatReview.findUnique.mockResolvedValue({ id: 11n });
    prisma.reviewReport.create.mockResolvedValue({
      id: 3n,
      seatReviewId: 11n,
      reporterId: 7n,
      reason: 'spam',
      detail: 'duplicated',
      status: 'OPEN',
      createdAt: new Date('2026-06-15T00:00:00.000Z'),
    });

    const service = new AdminService(prisma as never);

    await expect(
      service.reportReview('11', reporter, {
        reason: 'spam',
        detail: ' duplicated ',
      }),
    ).resolves.toMatchObject({
      id: '3',
      seatReviewId: '11',
      reporterId: '7',
      reason: 'spam',
      detail: 'duplicated',
      status: 'OPEN',
    });
  });

  it('hides a review and writes an audit log', async () => {
    const prisma = makePrisma();
    prisma.seatReview.findUnique.mockResolvedValue({ id: 11n });
    prisma.seatReview.update.mockResolvedValue({ id: 11n });

    const service = new AdminService(prisma as never);

    await expect(
      service.hideReview('11', admin, { reason: 'spoiler' }),
    ).resolves.toEqual({ hidden: true });

    expect(prisma.seatReview.update).toHaveBeenCalledWith({
      where: { id: 11n },
      data: expect.objectContaining({
        moderationStatus: 'HIDDEN',
        hiddenById: 1n,
        hiddenReason: 'spoiler',
      }),
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 1n,
        action: 'REVIEW_HIDE',
        targetType: 'SeatReview',
        targetId: '11',
      }),
    });
  });

  it('restores a hidden review', async () => {
    const prisma = makePrisma();
    prisma.seatReview.findUnique.mockResolvedValue({ id: 11n });
    prisma.seatReview.update.mockResolvedValue({ id: 11n });

    const service = new AdminService(prisma as never);

    await expect(service.restoreReview('11', admin)).resolves.toEqual({
      restored: true,
    });
  });

  it('throws when force deleting a missing review', async () => {
    const prisma = makePrisma();
    prisma.seatReview.findUnique.mockResolvedValue(null);

    const service = new AdminService(prisma as never);

    await expect(service.forceDeleteReview('404', admin)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('creates a report for an existing comment', async () => {
    const prisma = makePrisma();
    prisma.comment.findUnique.mockResolvedValue({ id: 5n });
    prisma.commentReport.create.mockResolvedValue({
      id: 9n,
      commentId: 5n,
      reporterId: 7n,
      reason: 'abuse',
      detail: null,
      status: 'OPEN',
      createdAt: new Date('2026-06-15T00:00:00.000Z'),
    });

    const service = new AdminService(prisma as never);

    await expect(
      service.reportComment('5', reporter, { reason: 'abuse' }),
    ).resolves.toMatchObject({
      id: '9',
      commentId: '5',
      reporterId: '7',
      reason: 'abuse',
      status: 'OPEN',
    });
  });

  it('hides and restores a comment with audit logs', async () => {
    const prisma = makePrisma();
    prisma.comment.findUnique.mockResolvedValue({ id: 5n });
    prisma.comment.update.mockResolvedValue({ id: 5n });

    const service = new AdminService(prisma as never);

    await expect(service.hideComment('5', admin, { reason: 'abuse' })).resolves.toEqual({
      hidden: true,
    });
    await expect(service.restoreComment('5', admin)).resolves.toEqual({
      restored: true,
    });

    expect(prisma.comment.update).toHaveBeenCalledWith({
      where: { id: 5n },
      data: expect.objectContaining({
        moderationStatus: 'HIDDEN',
        hiddenById: 1n,
        hiddenReason: 'abuse',
      }),
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 1n,
        action: 'COMMENT_HIDE',
        targetType: 'Comment',
        targetId: '5',
      }),
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 1n,
        action: 'COMMENT_RESTORE',
        targetType: 'Comment',
        targetId: '5',
      }),
    });
  });
});
