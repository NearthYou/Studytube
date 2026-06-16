import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class ListPostsDto {
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

  @IsNumberString()
  @IsOptional()
  categoryId?: string;

  @IsIn(['latest', 'popular', 'views'])
  @IsOptional()
  sort?: 'latest' | 'popular' | 'views';

  @IsString()
  @IsOptional()
  tag?: string;
}
