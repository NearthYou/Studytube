import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class CreateSetDto {
  @IsInt()
  @Min(1)
  setNumber: number;

  @IsInt()
  @Min(0)
  reps: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  perceivedDifficulty?: number;
}
