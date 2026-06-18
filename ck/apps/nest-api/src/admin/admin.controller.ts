import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { ModerateReviewDto } from './dto/moderate-review.dto';
import { ReportReviewDto } from './dto/report-review.dto';

@Controller()
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post('seat-reviews/:reviewId/reports')
  @UseGuards(JwtAuthGuard)
  reportReview(
    @Param('reviewId') reviewId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReportReviewDto,
  ) {
    return this.adminService.reportReview(reviewId, user, dto);
  }

  @Get('admin/reports')
  @UseGuards(JwtAuthGuard, AdminGuard)
  listReports(@Query('status') status?: string) {
    return this.adminService.listReports(status);
  }

  @Post('comments/:commentId/reports')
  @UseGuards(JwtAuthGuard)
  reportComment(
    @Param('commentId') commentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReportReviewDto,
  ) {
    return this.adminService.reportComment(commentId, user, dto);
  }

  @Patch('admin/seat-reviews/:id/hide')
  @UseGuards(JwtAuthGuard, AdminGuard)
  hideReview(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ModerateReviewDto,
  ) {
    return this.adminService.hideReview(id, user, dto);
  }

  @Patch('admin/seat-reviews/:id/restore')
  @UseGuards(JwtAuthGuard, AdminGuard)
  restoreReview(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.adminService.restoreReview(id, user);
  }

  @Delete('admin/seat-reviews/:id/force')
  @UseGuards(JwtAuthGuard, AdminGuard)
  forceDeleteReview(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.adminService.forceDeleteReview(id, user);
  }

  @Patch('admin/comments/:id/hide')
  @UseGuards(JwtAuthGuard, AdminGuard)
  hideComment(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ModerateReviewDto,
  ) {
    return this.adminService.hideComment(id, user, dto);
  }

  @Patch('admin/comments/:id/restore')
  @UseGuards(JwtAuthGuard, AdminGuard)
  restoreComment(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.adminService.restoreComment(id, user);
  }

  @Delete('admin/comments/:id/force')
  @UseGuards(JwtAuthGuard, AdminGuard)
  forceDeleteComment(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.adminService.forceDeleteComment(id, user);
  }

  @Get('admin/audit-logs')
  @UseGuards(JwtAuthGuard, AdminGuard)
  listAuditLogs() {
    return this.adminService.listAuditLogs();
  }
}
