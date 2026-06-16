import { Transform } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateIf,
} from 'class-validator';

const SEASON_VALUES = ['봄', '여름', '가을', '겨울'] as const;
const COMPANION_VALUES = ['혼자', '친구', '연인', '가족'] as const;
const IMAGE_URL_OPTIONS = {
  protocols: ['http', 'https'],
  require_protocol: true,
};

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
  @ValidateIf((_, value) => value !== undefined && value !== '')
  @IsUrl(IMAGE_URL_OPTIONS, {
    message: 'imageUrl must be a valid http or https URL.',
  })
  @MaxLength(2048)
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
  @MaxLength(10000)
  @Transform(toTrimmedValue)
  content?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
