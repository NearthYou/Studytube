import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class CheckLoginIdDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(4)
  @MaxLength(50)
  loginId!: string;
}
