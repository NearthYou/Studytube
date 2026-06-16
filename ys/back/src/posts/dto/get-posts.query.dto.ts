import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { POST_SORT_VALUES, PostSort } from '../types/post-sort.type';

const SEASON_VALUES = ['봄', '여름', '가을', '겨울'] as const;
const COMPANION_VALUES = ['혼자', '친구', '연인', '가족'] as const;

function toTrimmedValue({ value }: { value: unknown }) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

export class GetPostsQueryDto {
  @IsOptional()
  @IsString()
  @Transform(toTrimmedValue)
  q?: string;

  @IsOptional()
  @IsString()
  @Transform(toTrimmedValue)
  regionCode?: string;

  @IsOptional()
  @IsString()
  @Transform(toTrimmedValue)
  budgetCode?: string;

  @IsOptional()
  @IsString()
  @Transform(toTrimmedValue)
  themeCode?: string;

  @IsOptional()
  @IsIn(SEASON_VALUES)
  season?: (typeof SEASON_VALUES)[number];

  @IsOptional()
  @IsIn(COMPANION_VALUES)
  companion?: (typeof COMPANION_VALUES)[number];

  @IsOptional()
  @IsIn(POST_SORT_VALUES)
  sort: PostSort = 'latest';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 15;
}
