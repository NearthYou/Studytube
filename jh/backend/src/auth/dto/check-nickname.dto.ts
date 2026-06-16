import { IsString, Length, Matches } from 'class-validator';

export class CheckNicknameDto {
  @IsString()
  @Length(2, 20)
  @Matches(/^[가-힣a-zA-Z0-9_]+$/)
  nickname: string;
}
