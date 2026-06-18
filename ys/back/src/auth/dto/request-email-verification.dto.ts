import { IsEmail, MaxLength } from 'class-validator';

export class RequestEmailVerificationDto {
  @IsEmail()
  @MaxLength(255)
  email!: string;
}
