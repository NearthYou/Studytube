import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class PetPlaceAreaQueryDto {
  @IsString()
  @IsOptional()
  areaCode?: string;

  @IsString()
  @IsOptional()
  sigunguCode?: string;

  @IsString()
  @IsOptional()
  contentTypeId?: string;

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
