import { Type } from 'class-transformer';
import { ApiHideProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsString,
  MaxLength,
  Min,
  Validate,
  ValidateNested,
  type ValidationArguments,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { COURSE_LIMITS } from '../course.policy';

@ValidatorConstraint({ name: 'increasingTimeRange', async: false })
class IncreasingTimeRangeConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const range = args.object as { start?: unknown; end?: unknown };
    return (
      typeof range.start === 'number' &&
      Number.isFinite(range.start) &&
      typeof range.end === 'number' &&
      Number.isFinite(range.end) &&
      range.end > range.start
    );
  }

  defaultMessage(): string {
    return 'end must be greater than start';
  }
}

export class CourseLoopStateDto {
  @IsBoolean()
  enabled!: boolean;

  @IsBoolean()
  manual!: boolean;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  start!: number;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  end!: number;

  @Validate(IncreasingTimeRangeConstraint)
  @ApiHideProperty()
  private readonly rangeInvariant?: never;
}

export class CourseLearningMarkDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(COURSE_LIMITS.markId)
  id!: string;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  start!: number;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  end!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(COURSE_LIMITS.markText)
  note!: string;

  @IsString()
  @MaxLength(COURSE_LIMITS.markText)
  caption!: string;

  @IsISO8601({ strict: true, strictSeparator: true })
  createdAt!: string;

  @Validate(IncreasingTimeRangeConstraint)
  @ApiHideProperty()
  private readonly rangeInvariant?: never;
}

export class OwnerLearningStateDto {
  @IsIn(['ko', 'en'])
  captionLanguage!: 'ko' | 'en';

  @IsBoolean()
  captionsEnabled!: boolean;

  @IsIn([0.75, 1, 1.25, 1.5, 2])
  playbackRate!: 0.75 | 1 | 1.25 | 1.5 | 2;

  @ValidateNested()
  @Type(() => CourseLoopStateDto)
  loop!: CourseLoopStateDto;

  @IsArray()
  @ArrayMaxSize(COURSE_LIMITS.marks)
  @ValidateNested({ each: true })
  @Type(() => CourseLearningMarkDto)
  marks!: CourseLearningMarkDto[];
}
