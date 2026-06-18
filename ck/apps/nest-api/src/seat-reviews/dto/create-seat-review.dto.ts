import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class CreateSeatReviewDto {
  @IsString()
  theaterId!: string;

  @IsString()
  musicalId!: string;

  @IsString()
  performanceId!: string;

  @IsString()
  seatFloor!: string;

  @IsOptional()
  @IsString()
  seatSection?: string;

  @IsString()
  seatRow!: string;

  @IsString()
  seatNumber!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  viewRating!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  soundRating!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  comfortRating!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  expressionRating!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  stageVisibilityRating!: number;

  @IsString()
  @MinLength(10)
  content!: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  tagIds?: string[];
}
