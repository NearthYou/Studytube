import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNumberString,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

const toPrimitiveString = (value: unknown): string => {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }

  return '';
};

const toOptionalStringArray = (value: unknown): string[] | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value.map(toPrimitiveString).filter(Boolean);
  }

  if (value === '') {
    return [];
  }

  return [toPrimitiveString(value)].filter(Boolean);
};

export class UpdatePostDto {
  @IsString()
  @Length(1, 100)
  @IsOptional()
  title?: string;

  @IsString()
  @Length(1, 5000)
  @IsOptional()
  content?: string;

  @Transform(({ value }: { value: unknown }) => toOptionalStringArray(value))
  @IsArray()
  @IsOptional()
  @IsNumberString({}, { each: true })
  categoryIds?: string[];

  @Transform(({ value }: { value: unknown }) => toOptionalStringArray(value))
  @IsArray()
  @IsOptional()
  @IsNumberString({}, { each: true })
  imageIds?: string[];

  @Transform(({ value }: { value: unknown }) => toOptionalStringArray(value))
  @IsArray()
  @ArrayMaxSize(5)
  @IsOptional()
  @IsString({ each: true })
  tagNames?: string[];
}
