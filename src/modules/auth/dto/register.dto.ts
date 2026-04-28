import { IsString, IsOptional, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString()
  @MinLength(2)
  fullName: string;

  @IsString()
  @MinLength(3)
  username: string;

  @IsOptional()
  @IsString()
  city?: string;
}
