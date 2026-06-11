import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

function toTrimmedString({ value }: { value: unknown }) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length ? trimmed : '';
}

export class UpdateMyProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Transform(toTrimmedString)
  nickname?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(toTrimmedString)
  bio?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(toTrimmedString)
  location?: string;
}
