import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  Validate,
  ValidateIf,
  ValidateNested,
  type ValidationArguments,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { COURSE_LIMITS } from '../course.policy';
import { OwnerLearningStateDto } from './owner-learning-state.dto';

const MAX_POSTGRES_BIGINT = '9223372036854775807';

@ValidatorConstraint({ name: 'positiveBigintString', async: false })
class PositiveBigintStringConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return (
      typeof value === 'string' &&
      /^[1-9]\d*$/.test(value) &&
      (value.length < MAX_POSTGRES_BIGINT.length ||
        (value.length === MAX_POSTGRES_BIGINT.length &&
          value <= MAX_POSTGRES_BIGINT))
    );
  }

  defaultMessage(): string {
    return 'stepId must be a canonical positive PostgreSQL BIGINT string';
  }
}

@ValidatorConstraint({ name: 'newCourseStepShape', async: false })
class NewCourseStepShapeConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const step = args.object as {
      sourcePostId?: unknown;
      snapshot?: unknown;
    };
    return (
      Number(step.sourcePostId !== undefined) +
        Number(step.snapshot !== undefined) ===
      1
    );
  }

  defaultMessage(): string {
    return 'step must contain exactly one sourcePostId or snapshot';
  }
}

@ValidatorConstraint({ name: 'courseStepShape', async: false })
class CourseStepShapeConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const step = args.object as {
      stepId?: unknown;
      sourcePostId?: unknown;
      snapshot?: unknown;
      ownerLearningState?: unknown;
    };
    const shapeCount =
      Number(step.stepId !== undefined) +
      Number(step.sourcePostId !== undefined) +
      Number(step.snapshot !== undefined);
    return (
      shapeCount === 1 &&
      !(step.stepId !== undefined && step.ownerLearningState !== undefined)
    );
  }

  defaultMessage(): string {
    return 'step must contain exactly one stepId, sourcePostId, or snapshot';
  }
}

export class CourseStepSnapshotDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(COURSE_LIMITS.snapshotTitle)
  title!: string;

  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(COURSE_LIMITS.snapshotUrl)
  videoUrl!: string;

  @IsString()
  @MaxLength(COURSE_LIMITS.snapshotUrl)
  @ValidateIf((_, value: unknown) => value !== '')
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  thumbnailUrl!: string;

  @IsString()
  @MaxLength(COURSE_LIMITS.channelName)
  channelName!: string;
}

export class CreateCourseStepDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  sourcePostId?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => CourseStepSnapshotDto)
  snapshot?: CourseStepSnapshotDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => OwnerLearningStateDto)
  ownerLearningState?: OwnerLearningStateDto;

  @Validate(NewCourseStepShapeConstraint)
  private readonly stepShape?: never;
}

export class CourseStepInputDto {
  @IsOptional()
  @IsString()
  @Validate(PositiveBigintStringConstraint)
  stepId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  sourcePostId?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => CourseStepSnapshotDto)
  snapshot?: CourseStepSnapshotDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => OwnerLearningStateDto)
  ownerLearningState?: OwnerLearningStateDto;

  @Validate(CourseStepShapeConstraint)
  private readonly stepShape?: never;
}
