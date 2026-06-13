import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListCommentsDto {
  @Transform(({ value }: { value: unknown }) =>
    value === undefined ? undefined : Number(value),
  )
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @Transform(({ value }: { value: unknown }) =>
    value === undefined ? undefined : Number(value),
  )
  @IsInt()
  @Min(1)
  @Max(50)
  @IsOptional()
  limit?: number;
}
