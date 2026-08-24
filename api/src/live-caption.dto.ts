import { ApiProperty } from '@nestjs/swagger';
import {
  IsBase64,
  IsIn,
  IsInt,
  IsNumber,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_LEARNING_AUDIO_SECONDS } from './learning/provider-budget.repository';

export class CaptureLiveCaptionChunkDto {
  @Matches(/^\d+$/u)
  contextId!: string;

  @IsUUID('4')
  sessionId!: string;

  @IsInt()
  @Min(0)
  ordinal!: number;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(MAX_LEARNING_AUDIO_SECONDS)
  startSeconds!: number;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(MAX_LEARNING_AUDIO_SECONDS)
  endSeconds!: number;

  @IsString()
  @IsIn([
    'audio/webm',
    'audio/webm;codecs=opus',
    'audio/ogg',
    'audio/ogg;codecs=opus',
  ])
  mimeType!: string;

  @IsBase64()
  @MaxLength(400_000)
  audioBase64!: string;
}

export class FinalizeLiveCaptionsDto {
  @Matches(/^\d+$/u)
  contextId!: string;

  @IsUUID('4')
  sessionId!: string;
}

export class LiveCaptionChunkResponseDto {
  @ApiProperty({ minimum: 0 })
  ordinal!: number;

  @ApiProperty({ minimum: 0 })
  start!: number;

  @ApiProperty({ minimum: 0 })
  end!: number;

  @ApiProperty()
  sourceLanguage!: string;

  @ApiProperty()
  source!: string;

  @ApiProperty()
  korean!: string;
}

export class LiveCaptionFinalizeResponseDto {
  @ApiProperty({ enum: ['ready'] })
  status!: 'ready';
}
