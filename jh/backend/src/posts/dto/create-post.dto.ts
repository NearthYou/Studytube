import { Transform } from 'class-transformer';
import {
  ArrayNotEmpty,
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

const toStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map(toPrimitiveString).filter(Boolean);
  }

  if (value === undefined || value === null || value === '') {
    return [];
  }

  return [toPrimitiveString(value)].filter(Boolean);
};

export class CreatePostDto {
  @IsString()
  @Length(1, 100)
  title: string;

  @IsString()
  @Length(1, 5000)
  content: string;

  @Transform(({ value }: { value: unknown }) => toStringArray(value))
  @IsArray()
  @ArrayNotEmpty()
  @IsNumberString({}, { each: true })
  categoryIds: string[];

  @Transform(({ value }: { value: unknown }) => toStringArray(value))
  @IsArray()
  @IsOptional()
  @IsNumberString({}, { each: true })
  imageIds?: string[];

  @Transform(({ value }: { value: unknown }) => toStringArray(value))
  @IsArray()
  @ArrayMaxSize(5)
  @IsOptional()
  @IsString({ each: true })
  tagNames?: string[];
}
