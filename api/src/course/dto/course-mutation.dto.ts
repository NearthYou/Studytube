import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidateNested,
  type ValidationArguments,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { COURSE_LIMITS } from '../course.policy';
import { CourseStepInputDto } from './course-step.dto';

@ValidatorConstraint({ name: 'courseMetadataPatch', async: false })
class CourseMetadataPatchConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const patch = args.object as { title?: unknown; description?: unknown };
    return patch.title !== undefined || patch.description !== undefined;
  }

  defaultMessage(): string {
    return 'at least one metadata field is required';
  }
}

export class CourseVersionDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class UpdateCourseDto extends CourseVersionDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(COURSE_LIMITS.title)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(COURSE_LIMITS.description)
  description?: string;

  @Validate(CourseMetadataPatchConstraint)
  private readonly metadataPatch?: never;
}

export class ReplaceCourseStepsDto extends CourseVersionDto {
  @IsArray()
  @ArrayMaxSize(COURSE_LIMITS.steps)
  @ValidateNested({ each: true })
  @Type(() => CourseStepInputDto)
  steps!: CourseStepInputDto[];
}

export class CreateCourseFeedbackDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(COURSE_LIMITS.feedbackBody)
  body!: string;
}
