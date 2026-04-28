import { IsString, IsNumber, IsIn, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdatePostDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1000) priceCop?: number;
  @IsOptional() @IsString() @IsIn(['NEW','LIKE_NEW','USED','FOR_PARTS']) condition?: string;
}
