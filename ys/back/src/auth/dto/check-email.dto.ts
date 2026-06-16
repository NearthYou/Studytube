import { IsEmail, MaxLength } from 'class-validator';

export class CheckEmailDto {
  @IsEmail()
  @MaxLength(255)
  email!: string;
}
