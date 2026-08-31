import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

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

export class LearningPreferencesDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  interests!: string[];

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  pace!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  goal!: string;
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => LearningPreferencesDto)
  preferences?: LearningPreferencesDto;
}
