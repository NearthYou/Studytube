import {
  Post,
  Body,
  Controller,
  UseGuards,
  Query,
  Get,
  Param,
  Patch,
  Delete,
} from '@nestjs/common';
import { SeatReviewsService } from './seat-reviews.service';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { CreateSeatReviewDto } from './dto/create-seat-review.dto';
import { SeatReviewQueryDto } from './dto/seat-review-query.dto';
import { UpdateSeatReviewDto } from './dto/update-seat-review.dto';

@Controller('seat-reviews')
export class SeatReviewsController {
  constructor(private readonly seatReviewsService: SeatReviewsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSeatReviewDto,
  ) {
    return this.seatReviewsService.create(user, dto);
  }

  @Get()
  findAll(@Query() query: SeatReviewQueryDto) {
    return this.seatReviewsService.findAll(query);
  }

  @Get('search')
  search(@Query() query: SeatReviewQueryDto) {
    return this.seatReviewsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.seatReviewsService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateSeatReviewDto,
  ) {
    return this.seatReviewsService.update(id, user, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  delete(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.seatReviewsService.remove(id, user);
  }
}
