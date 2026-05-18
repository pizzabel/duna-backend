import {
  Injectable, UnauthorizedException, BadRequestException, Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import * as Twilio from 'twilio';

const REFRESH_TTL_DAYS = 30;

@Injectable()
export class AuthService {
  private readonly logger = new Logger('AuthService');
  private readonly twilioClient: Twilio.Twilio;
  private readonly verifySid: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {
    this.twilioClient = (Twilio as any)(
      this.config.getOrThrow('TWILIO_ACCOUNT_SID'),
      this.config.getOrThrow('TWILIO_AUTH_TOKEN'),
    );
    this.verifySid = this.config.getOrThrow('TWILIO_VERIFY_SID');
  }

  async requestOtp(phone: string): Promise<void> {
    const normalized = this.normalizePhone(phone);
    const key = `otp:rate:${normalized}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, 3600);
    if (count > 10) throw new BadRequestException('Demasiados intentos. Espera una hora.');

    try {
      await this.twilioClient.verify.v2
        .services(this.verifySid)
        .verifications.create({ to: normalized, channel: 'sms' });
      this.logger.log(`OTP enviado via Twilio Verify a ${normalized}`);
    } catch (err) {
      this.logger.error(`Twilio Verify error: ${err.message}`);
      throw new BadRequestException('No se pudo enviar el codigo. Intenta de nuevo.');
    }
  }

  async verifyOtp(phone: string, code: string): Promise<{ accessToken: string; refreshToken: string; isNewUser: boolean }> {
    const normalized = this.normalizePhone(phone);

    try {
      const check = await this.twilioClient.verify.v2
        .services(this.verifySid)
        .verificationChecks.create({ to: normalized, code });

      if (check.status !== 'approved') {
        throw new UnauthorizedException('Codigo invalido o expirado.');
      }
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      this.logger.error(`Twilio Verify check error: ${err.message}`);
      throw new UnauthorizedException('Codigo invalido o expirado.');
    }

    let user = await this.prisma.user.findUnique({ where: { phone: normalized } });
    const isNewUser = !user;
    if (!user) {
      user = await this.prisma.user.create({
        data: { phone: normalized, phoneVerified: true, fullName: '', username: await this.generateUsername(normalized), kycLevel: 1 },
      });
    } else {
      await this.prisma.user.update({ where: { id: user.id }, data: { phoneVerified: true } });
    }
    return { ...this.generateTokenPair(user.id), isNewUser };
  }

  async refresh(rawRefreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    let payload: { sub: string; jti: string };
    try {
      payload = this.jwt.verify(rawRefreshToken, { secret: this.config.getOrThrow('JWT_REFRESH_SECRET') });
    } catch {
      throw new UnauthorizedException('Refresh token invalido.');
    }
    const revoked = await this.redis.get(`refresh:revoked:${payload.jti}`);
    if (revoked) throw new UnauthorizedException('Sesion expirada.');
    await this.redis.set(`refresh:revoked:${payload.jti}`, '1', REFRESH_TTL_DAYS * 86_400);
    return this.generateTokenPair(payload.sub);
  }

  async logout(userId: string, jti: string): Promise<void> {
    await this.redis.set(`refresh:revoked:${jti}`, '1', REFRESH_TTL_DAYS * 86_400);
  }

  private generateTokenPair(userId: string) {
    const jti = crypto.randomUUID();
    const accessToken = this.jwt.sign({ sub: userId });
    const refreshToken = this.jwt.sign({ sub: userId, jti }, { secret: this.config.getOrThrow('JWT_REFRESH_SECRET'), expiresIn: `${REFRESH_TTL_DAYS}d` });
    return { accessToken, refreshToken };
  }

  private normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.startsWith('57') && digits.length === 12) return `+${digits}`;
    if (digits.length === 10) return `+57${digits}`;
    throw new BadRequestException('Numero de telefono invalido.');
  }

  private async generateUsername(phone: string): Promise<string> {
    const base = `user${phone.slice(-4)}`;
    const exists = await this.prisma.user.findUnique({ where: { username: base } });
    if (!exists) return base;
    return `${base}${Math.floor(Math.random() * 9000) + 1000}`;
  }
}