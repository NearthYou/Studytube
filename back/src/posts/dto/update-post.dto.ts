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
  return trimmed.length ? trimmed : '';
}

export class UpdatePostDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(toTrimmedValue)
  title?: string;

  @IsOptional()
  @IsDateString()
  travelDate?: string;

  @IsOptional()
  @IsString()
  @ValidateIf((_, value) => value !== undefined && value !== '')
  @IsUrl(IMAGE_URL_OPTIONS, {
    message: 'imageUrl must be a valid http or https URL.',
  })
  @MaxLength(2048)
  @Transform(toTrimmedValue)
  imageUrl?: string;

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
  @IsString()
  @MaxLength(10000)
  @Transform(toTrimmedValue)
  content?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
