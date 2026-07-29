import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class SignupDto {
  @IsEmail()
  email!: string;
}

export class ResendVerificationDto {
  @IsEmail()
  email!: string;
}

export class ConsumeVerificationDto {
  @IsString()
  @IsNotEmpty()
  verificationToken!: string;
}

export class CompleteRegistrationDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}
