import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ReportReviewDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  detail?: string;
}
