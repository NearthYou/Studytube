import {
  IsArray,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

export class ChatAgentDto {
  @IsString()
  @Length(1, 1000)
  message: string;

  @IsString()
  @IsOptional()
  species?: 'cat' | 'dog' | 'both' | 'unknown';

  @IsNumber()
  @IsOptional()
  petProfileId?: number;

  @IsNumber()
  @IsOptional()
  petAge?: number;

  @IsObject()
  @IsOptional()
  location?: {
    mapX?: number;
    mapY?: number;
    radius?: number;
  };

  @IsObject()
  @IsOptional()
  context?: {
    categoryId?: string;
    postId?: string;
    route?: string;
  };

  @IsArray()
  @IsOptional()
  history?: {
    role: 'user' | 'assistant';
    content: string;
  }[];
}
