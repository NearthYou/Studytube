import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SignupDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(4)
  @MaxLength(50)
  loginId!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(100)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,100}$/, {
    message: '비밀번호는 대문자, 소문자, 숫자를 포함해 8자 이상이어야 합니다.',
  })
  password!: string;

  @IsString()
  @IsNotEmpty()
  passwordConfirm!: string;

  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(50)
  nickname!: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  emailVerificationToken?: string;
}
