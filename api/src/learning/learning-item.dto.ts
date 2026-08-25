import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  IsOptional,
} from 'class-validator';
import { MAX_LEARNING_AUDIO_SECONDS } from './provider-budget.repository';

export class StartLearningItemDto {
  @IsString()
  @Length(1, 2_048)
  videoUrl!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_LEARNING_AUDIO_SECONDS)
  requestedAudioSeconds!: number;

  @IsOptional()
  @IsBoolean()
  repairInitialGap?: boolean;
}

export class LearningContextParamDto {
  @Matches(/^[1-9]\d*$/u)
  contextId!: string;
}

export class LearningNoteParamDto extends LearningContextParamDto {
  @Matches(/^[1-9]\d*$/u)
  noteId!: string;
}

export class CreateLearningNoteDto {
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(86_400)
  positionSeconds!: number;

  @IsString()
  @Length(1, 4_000)
  body!: string;
}

export class UpdateLearningNoteDto {
  @IsString()
  @Length(1, 4_000)
  body!: string;
}

export class ExplainLearningSegmentDto {
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(86_400)
  startSeconds!: number;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(86_400)
  endSeconds!: number;
}
