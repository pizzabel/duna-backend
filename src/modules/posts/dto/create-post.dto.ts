import {
  IsString, IsNumber, IsIn, IsUUID,
  MinLength, MaxLength, Min, IsOptional,
  IsArray, IsUrl,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePostDto {
  @IsString()
  @MinLength(4)
  @MaxLength(120)
  title: string;

  @IsString()
  @MinLength(10)
  description: string;

  @IsUUID()
  categoryId: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1000)
  priceCop: number;

  @IsString()
  @IsIn(['NEW', 'LIKE_NEW', 'USED', 'FOR_PARTS'])
  condition: string;

  @Type(() => Number)
  @IsNumber()
  lat: number;

  @Type(() => Number)
  @IsNumber()
  lng: number;

  @IsOptional()
  @IsArray()
  images?: string[];
}
