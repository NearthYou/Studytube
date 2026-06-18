import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { PrismaService } from 'src/database/prisma.service';
import { ModerateReviewDto } from './dto/moderate-review.dto';
import { ReportReviewDto } from './dto/report-review.dto';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async reportReview(
    reviewIdValue: string,
    user: AuthenticatedUser,
    dto: ReportReviewDto,
  ) {
    const seatReviewId = this.parseId(reviewIdValue, 'reviewId');
    const reporterId = this.parseId(user.id, 'userId');

    await this.assertReviewExists(seatReviewId);

    const report = await this.prisma.reviewReport.create({
      data: {
        seatReviewId,
        reporterId,
        reason: dto.reason.trim(),
        detail: this.normalizeOptionalText(dto.detail),
      },
    });

    return {
      id: report.id.toString(),
      seatReviewId: report.seatReviewId.toString(),
      reporterId: report.reporterId.toString(),
      reason: report.reason,
      detail: report.detail,
      status: report.status,
      createdAt: report.createdAt.toISOString(),
    };
  }

  async listReports(status = 'OPEN') {
    const [reviewReports, commentReports] = await Promise.all([
      this.prisma.reviewReport.findMany({
        where: status === 'ALL' ? {} : { status },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.commentReport.findMany({
        where: status === 'ALL' ? {} : { status },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return [
      ...reviewReports.map((report) => ({
        targetType: 'SeatReview',
        targetId: report.seatReviewId.toString(),
        id: report.id.toString(),
        seatReviewId: report.seatReviewId.toString(),
        reporterId: report.reporterId.toString(),
        reason: report.reason,
        detail: report.detail,
        status: report.status,
        createdAt: report.createdAt.toISOString(),
      })),
      ...commentReports.map((report) => ({
        targetType: 'Comment',
        targetId: report.commentId.toString(),
        id: report.id.toString(),
        commentId: report.commentId.toString(),
        reporterId: report.reporterId.toString(),
        reason: report.reason,
        detail: report.detail,
        status: report.status,
        createdAt: report.createdAt.toISOString(),
      })),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async reportComment(
    commentIdValue: string,
    user: AuthenticatedUser,
    dto: ReportReviewDto,
  ) {
    const commentId = this.parseId(commentIdValue, 'commentId');
    const reporterId = this.parseId(user.id, 'userId');

    await this.assertCommentExists(commentId);

    const report = await this.prisma.commentReport.create({
      data: {
        commentId,
        reporterId,
        reason: dto.reason.trim(),
        detail: this.normalizeOptionalText(dto.detail),
      },
    });

    return {
      id: report.id.toString(),
      commentId: report.commentId.toString(),
      reporterId: report.reporterId.toString(),
      reason: report.reason,
      detail: report.detail,
      status: report.status,
      createdAt: report.createdAt.toISOString(),
    };
  }

  async hideReview(idValue: string, actor: AuthenticatedUser, dto: ModerateReviewDto) {
    const id = this.parseId(idValue, 'id');
    const actorId = this.parseId(actor.id, 'actorId');

    await this.assertReviewExists(id);
    await this.prisma.seatReview.update({
      where: { id },
      data: {
        moderationStatus: 'HIDDEN',
        hiddenAt: new Date(),
        hiddenById: actorId,
        hiddenReason: this.normalizeOptionalText(dto.reason),
      },
    });
    await this.writeAudit(actorId, 'REVIEW_HIDE', 'SeatReview', id.toString(), {
      reason: dto.reason ?? null,
    });

    return { hidden: true };
  }

  async restoreReview(idValue: string, actor: AuthenticatedUser) {
    const id = this.parseId(idValue, 'id');
    const actorId = this.parseId(actor.id, 'actorId');

    await this.assertReviewExists(id);
    await this.prisma.seatReview.update({
      where: { id },
      data: {
        moderationStatus: 'VISIBLE',
        hiddenAt: null,
        hiddenById: null,
        hiddenReason: null,
      },
    });
    await this.writeAudit(actorId, 'REVIEW_RESTORE', 'SeatReview', id.toString());

    return { restored: true };
  }

  async forceDeleteReview(idValue: string, actor: AuthenticatedUser) {
    const id = this.parseId(idValue, 'id');
    const actorId = this.parseId(actor.id, 'actorId');

    await this.assertReviewExists(id);
    await this.prisma.$transaction([
      this.prisma.seatReviewEmbedding.deleteMany({ where: { seatReviewId: id } }),
      this.prisma.seatReviewTag.deleteMany({ where: { seatReviewId: id } }),
      this.prisma.comment.deleteMany({ where: { seatReviewId: id } }),
      this.prisma.reviewReport.deleteMany({ where: { seatReviewId: id } }),
      this.prisma.seatReview.delete({ where: { id } }),
      this.prisma.auditLog.create({
        data: {
          actorId,
          action: 'REVIEW_FORCE_DELETE',
          targetType: 'SeatReview',
          targetId: id.toString(),
        },
      }),
    ]);

    return { deleted: true };
  }

  async hideComment(idValue: string, actor: AuthenticatedUser, dto: ModerateReviewDto) {
    const id = this.parseId(idValue, 'id');
    const actorId = this.parseId(actor.id, 'actorId');

    await this.assertCommentExists(id);
    await this.prisma.comment.update({
      where: { id },
      data: {
        moderationStatus: 'HIDDEN',
        hiddenAt: new Date(),
        hiddenById: actorId,
        hiddenReason: this.normalizeOptionalText(dto.reason),
      },
    });
    await this.writeAudit(actorId, 'COMMENT_HIDE', 'Comment', id.toString(), {
      reason: dto.reason ?? null,
    });

    return { hidden: true };
  }

  async restoreComment(idValue: string, actor: AuthenticatedUser) {
    const id = this.parseId(idValue, 'id');
    const actorId = this.parseId(actor.id, 'actorId');

    await this.assertCommentExists(id);
    await this.prisma.comment.update({
      where: { id },
      data: {
        moderationStatus: 'VISIBLE',
        hiddenAt: null,
        hiddenById: null,
        hiddenReason: null,
      },
    });
    await this.writeAudit(actorId, 'COMMENT_RESTORE', 'Comment', id.toString());

    return { restored: true };
  }

  async forceDeleteComment(idValue: string, actor: AuthenticatedUser) {
    const id = this.parseId(idValue, 'id');
    const actorId = this.parseId(actor.id, 'actorId');

    await this.assertCommentExists(id);
    await this.prisma.$transaction([
      this.prisma.commentReport.deleteMany({ where: { commentId: id } }),
      this.prisma.comment.delete({ where: { id } }),
      this.prisma.auditLog.create({
        data: {
          actorId,
          action: 'COMMENT_FORCE_DELETE',
          targetType: 'Comment',
          targetId: id.toString(),
        },
      }),
    ]);

    return { deleted: true };
  }

  async listAuditLogs() {
    const logs = await this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return logs.map((log) => ({
      id: log.id.toString(),
      actorId: log.actorId.toString(),
      action: log.action,
      targetType: log.targetType,
      targetId: log.targetId,
      metadata: log.metadata,
      createdAt: log.createdAt.toISOString(),
    }));
  }

  private async assertReviewExists(id: bigint) {
    const review = await this.prisma.seatReview.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!review) {
      throw new NotFoundException('Seat review not found');
    }
  }

  private async assertCommentExists(id: bigint) {
    const comment = await this.prisma.comment.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }
  }

  private async writeAudit(
    actorId: bigint,
    action: string,
    targetType: string,
    targetId: string,
    metadata?: Record<string, unknown>,
  ) {
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action,
        targetType,
        targetId,
        metadata: metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }

  private normalizeOptionalText(value?: string) {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }

  private parseId(value: string, fieldName: string) {
    try {
      const parsed = BigInt(value);

      if (parsed <= 0n) {
        throw new Error('ID must be positive');
      }

      return parsed;
    } catch {
      throw new BadRequestException(`${fieldName} must be a positive integer string`);
    }
  }
}
