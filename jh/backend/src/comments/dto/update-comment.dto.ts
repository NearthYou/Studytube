import { IsString, Length } from 'class-validator';

export class UpdateCommentDto {
  @IsString()
  @Length(1, 1000)
  content: string;
}
