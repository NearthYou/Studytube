import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class AgentRunBudgetsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3_600_000)
  wallTimeBudgetMs?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  toolCallBudget?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  tokenBudget?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  estimatedCostBudgetUsd?: number;
}

export class CreateAgentRunDto {
  @IsString()
  @Length(1, 2_000)
  objective!: string;

  @IsOptional()
  @IsInt()
  @Min(3)
  @Max(6)
  requestedStepCount?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => AgentRunBudgetsDto)
  budgets?: AgentRunBudgetsDto;
}

export class AgentRunParamDto {
  @IsUUID('4')
  runId!: string;
}

export class CourseStepParamDto {
  @Matches(/^[1-9]\d*$/u)
  stepId!: string;
}

export class QuizParamDto {
  @IsUUID('4')
  quizId!: string;
}

export class ExpectedVersionDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class RecordProgressDto {
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  startSeconds!: number;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  endSeconds!: number;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  lastPositionSeconds!: number;

  @IsDateString({ strict: true })
  occurredAt!: string;
}

export class QuizAnswerDto {
  @IsUUID('4')
  questionId!: string;

  @IsInt()
  @Min(0)
  selectedChoiceIndex!: number;
}

export class SubmitQuizDto {
  @IsArray()
  @ArrayMinSize(5)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => QuizAnswerDto)
  answers!: QuizAnswerDto[];
}
