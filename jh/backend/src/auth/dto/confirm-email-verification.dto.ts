import { IsEmail, Matches } from 'class-validator';

export class ConfirmEmailVerificationDto {
  @IsEmail()
  email: string;

  @Matches(/^\d{6}$/)
  code: string;
}
