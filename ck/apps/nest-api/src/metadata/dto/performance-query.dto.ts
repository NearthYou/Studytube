import { IsOptional, IsString } from 'class-validator';

export class PerformanceQueryDto {
  @IsOptional() // 있어도 되고 없어도 됨
  @IsString() // 문자열어이어야 함
  theaterId?: string;

  @IsOptional()
  @IsString()
  musicalId?: string;
}
