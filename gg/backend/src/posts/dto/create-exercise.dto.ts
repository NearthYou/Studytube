import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreateSetDto } from './create-set.dto';

export class CreateExerciseDto {
  @IsString()
  @IsNotEmpty()
  exerciseName: string;

  @IsNumber()
  @Min(0)
  weightKg: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  targetReps?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  orderIndex?: number;

  @IsOptional()
  @IsString()
  memo?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSetDto)
  sets: CreateSetDto[];
}
