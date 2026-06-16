import { Transform } from 'class-transformer';
import { IsString, MaxLength } from 'class-validator';

function toTrimmedValue({ value }: { value: unknown }) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

export class UpdateReplyDto {
  @IsString()
  @MaxLength(2000)
  @Transform(toTrimmedValue)
  content!: string;
}
