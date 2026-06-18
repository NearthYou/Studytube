import { IsEmail, IsString, MinLength } from 'class-validator';

// 로그인 요청 바디가 올바른 모양인지 자동검사
// 회원가입과 별개의 DTO
export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}
