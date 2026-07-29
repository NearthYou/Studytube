import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { COURSE_LIMITS } from '../course.policy';
import { CreateCourseStepDto } from './course-step.dto';

export class CreateCourseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(COURSE_LIMITS.title)
  title!: string;

  @IsString()
  @MaxLength(COURSE_LIMITS.description)
  description: string = '';

  @IsArray()
  @ArrayMaxSize(COURSE_LIMITS.steps)
  @ValidateNested({ each: true })
  @Type(() => CreateCourseStepDto)
  steps: CreateCourseStepDto[] = [];
}
