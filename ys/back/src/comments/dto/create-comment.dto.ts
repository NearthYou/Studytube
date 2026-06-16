import { Transform } from 'class-transformer';
import { IsString, MaxLength } from 'class-validator';

function toTrimmedValue({ value }: { value: unknown }) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

export class CreateCommentDto {
  @IsString()
  @MaxLength(2000)
  @Transform(toTrimmedValue)
  content!: string;
}
