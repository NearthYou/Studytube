import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ModerateReviewDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
