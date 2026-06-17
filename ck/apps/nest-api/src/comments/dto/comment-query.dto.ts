import { IsIn, IsOptional } from 'class-validator';

export class CommentQueryDto {
  @IsOptional()
  @IsIn(['oldest', 'latest'])
  sort?: 'oldest' | 'latest' = 'oldest';
}
