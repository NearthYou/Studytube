import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsString,
  Length,
  Matches,
  MinLength,
} from 'class-validator';

export class SignupDto {
  @IsEmail()
  email: string;

  @IsString()
  @Length(2, 20)
  @Matches(/^[가-힣a-zA-Z0-9_]+$/)
  nickname: string;

  @IsString()
  @MinLength(8)
  @Matches(/[!@#$%^&*(),.?":{}|<>_\-\\[\];'/`~+=]/)
  password: string;

  @IsString()
  passwordConfirm: string;

  @IsString()
  emailVerificationToken: string;

  @Transform(
    ({ value }: { value: unknown }): boolean =>
      value === true || value === 'true',
  )
  @IsBoolean()
  termsAccepted: boolean;
}
