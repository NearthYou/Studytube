import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

const toBoolean = ({ value }: { value: unknown }) => {
  if (value === true || value === 'true') {
    return true;
  }

  if (value === false || value === 'false') {
    return false;
  }

  return value;
};

export type SeatReviewSort =
  | 'latest'
  | 'oldest'
  | 'popular'
  | 'rating'
  | 'view'
  | 'sound'
  | 'comfort'
  | 'expression'
  | 'stageVisibility';

export class SeatReviewQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  theaterId?: string;

  @IsOptional()
  @IsString()
  theater?: string;

  @IsOptional()
  @IsString()
  musicalId?: string;

  @IsOptional()
  @IsString()
  musical?: string;

  @IsOptional()
  @IsString()
  performanceId?: string;

  @IsOptional()
  @IsString()
  seasonLabel?: string;

  @IsOptional()
  @IsString()
  seatFloor?: string;

  @IsOptional()
  @IsString()
  seatSection?: string;

  @IsOptional()
  @IsString()
  seatRow?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  seatRowFrom?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  seatRowTo?: number;

  @IsOptional()
  @IsString()
  seatNumber?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  seatNumberFrom?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  seatNumberTo?: number;

  @IsOptional()
  @IsString()
  tagId?: string;

  @IsOptional()
  @IsString()
  tagIds?: string;

  @IsOptional()
  @IsString()
  tag?: string;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  hasObstruction?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  minViewRating?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  minSoundRating?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  minComfortRating?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  minExpressionRating?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  minStageVisibilityRating?: number;

  @IsOptional()
  @IsIn([
    'latest',
    'oldest',
    'popular',
    'rating',
    'view',
    'sound',
    'comfort',
    'expression',
    'stageVisibility',
  ])
  sort?: SeatReviewSort = 'latest';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;
}
