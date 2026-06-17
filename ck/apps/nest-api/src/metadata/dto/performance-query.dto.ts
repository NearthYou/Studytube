import { IsNumberString, IsOptional } from 'class-validator';

export class PerformanceQueryDto {
  @IsOptional()
  @IsNumberString()
  theaterId?: string;

  @IsOptional()
  @IsNumberString()
  musicalId?: string;
}
