// src/modules/auth/auth.controller.ts — D-una
import {
  Controller, Post, Body, HttpCode, HttpStatus, Req,
} from '@nestjs/common';
import { Throttle }      from '@nestjs/throttler';
import { AuthService }   from './auth.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto }  from './dto/verify-otp.dto';
import { RefreshDto }    from './dto/refresh.dto';
import { Public }        from '../../common/decorators/public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * POST /v1/auth/otp/request
   * Rate limited: 3/hora por IP (más estricto que el global)
   */
  @Public()
  @Throttle({ default: { ttl: 3_600_000, limit: 3 } })
  @Post('otp/request')
  @HttpCode(HttpStatus.NO_CONTENT)
  async requestOtp(@Body() dto: RequestOtpDto): Promise<void> {
    await this.authService.requestOtp(dto.phone);
  }

  /**
   * POST /v1/auth/otp/verify
   * Retorna access + refresh tokens y flag de usuario nuevo
   */
  @Public()
  @Post('otp/verify')
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto.phone, dto.code);
  }

  /**
   * POST /v1/auth/refresh
   * Rotación de refresh token (el anterior queda revocado)
   */
  @Public()
  @Post('refresh')
  async refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  /**
   * POST /v1/auth/logout
   * Requiere JWT válido. Revoca el refresh token actual.
   */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: any): Promise<void> {
    const { sub, jti } = req.user;
    await this.authService.logout(sub, jti);
  }
}
