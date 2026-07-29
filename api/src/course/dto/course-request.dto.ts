import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { COURSE_LIMITS } from '../course.policy';

export class CourseIdParamDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  id!: number;
}

export class CourseIdempotencyKeyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(COURSE_LIMITS.idempotencyKey)
  idempotencyKey!: string;
}

export class ListCoursesQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(512)
  @Matches(/^[A-Za-z0-9_-]+$/)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(COURSE_LIMITS.pageSize)
  limit = 20;
}
