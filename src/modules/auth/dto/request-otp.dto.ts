// request-otp.dto.ts
import { IsString, Matches } from 'class-validator';

export class RequestOtpDto {
  @IsString()
  @Matches(/^(\+?57)?3\d{9}$/, { message: 'Número colombiano inválido. Ej: 3001234567' })
  phone: string;
}
