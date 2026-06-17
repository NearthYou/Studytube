import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

// 회원가입 요청 바디가 올바른 모양인지 자동 검사
// DTO: 요청 바디가 어떤 모양이어야 하는지 검사
export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(20)
  nickname!: string;
}
