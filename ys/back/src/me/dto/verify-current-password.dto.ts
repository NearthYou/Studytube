import { IsString, MaxLength, MinLength } from 'class-validator';

export class VerifyCurrentPasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  currentPassword!: string;
}
