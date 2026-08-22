import {
  IsInt,
  IsNumber,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class StartLearningItemDto {
  @IsString()
  @Length(1, 2_048)
  videoUrl!: string;

  @IsInt()
  @Min(1)
  @Max(14_400)
  requestedAudioSeconds!: number;
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
