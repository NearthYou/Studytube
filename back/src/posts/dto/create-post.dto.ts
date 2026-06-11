import { Transform } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const SEASON_VALUES = ['봄', '여름', '가을', '겨울'] as const;
const COMPANION_VALUES = ['혼자', '친구', '연인', '가족'] as const;

function toTrimmedValue({ value }: { value: unknown }) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

export class CreatePostDto {
  @IsString()
  @MaxLength(200)
  @Transform(toTrimmedValue)
  title!: string;

  @IsDateString()
  travelDate!: string;

  @IsOptional()
  @IsString()
  @Transform(toTrimmedValue)
  imageUrl?: string;

  @IsString()
  @Transform(toTrimmedValue)
  regionCode!: string;

  @IsString()
  @Transform(toTrimmedValue)
  budgetCode!: string;

  @IsString()
  @Transform(toTrimmedValue)
  themeCode!: string;

  @IsIn(SEASON_VALUES)
  season!: (typeof SEASON_VALUES)[number];

  @IsIn(COMPANION_VALUES)
  companion!: (typeof COMPANION_VALUES)[number];

  @IsOptional()
  @IsString()
  @Transform(toTrimmedValue)
  content?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
