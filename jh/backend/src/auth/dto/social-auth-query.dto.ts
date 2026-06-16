import { IsOptional, IsString } from 'class-validator';

export class SocialAuthQueryDto {
  @IsString()
  @IsOptional()
  redirect?: string;
}
