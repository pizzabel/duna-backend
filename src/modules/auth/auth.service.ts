// src/modules/auth/auth.service.ts — D-una
import {
  Injectable, UnauthorizedException, BadRequestException,
} from '@nestjs/common';
import { JwtService }     from '@nestjs/jwt';
import { ConfigService }  from '@nestjs/config';
import { PrismaService }  from '../../common/prisma/prisma.service';
import { RedisService }   from '../../common/redis/redis.service';
import { OtpService }     from './otp.service';

const REFRESH_TTL_DAYS = 30;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma:  PrismaService,
    private readonly jwt:     JwtService,
    private readonly redis:   RedisService,
    private readonly otp:     OtpService,
    private readonly config:  ConfigService,
  ) {}

  // ── 1. Solicitar OTP ──────────────────────────────────────
  async requestOtp(phone: string): Promise<void> {
    const normalized = this.normalizePhone(phone);

    // Rate limit: máx 3 OTPs/hora por número
    const key   = `otp:rate:${normalized}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, 3600);
    if (count > 3) {
      throw new BadRequestException('Demasiados intentos. Espera una hora.');
    }

    const code = this.otp.generate();

    // Guardar código directo (sin hash) — columna VarChar(6)
    await this.prisma.otpToken.create({
      data: {
        phone:     normalized,
        code,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    await this.otp.send(normalized, code);
  }

  // ── 2. Verificar OTP → tokens ─────────────────────────────
  async verifyOtp(
    phone: string,
    code:  string,
  ): Promise<{ accessToken: string; refreshToken: string; isNewUser: boolean }> {
    const normalized = this.normalizePhone(phone);

    // Buscar el OTP más reciente no usado
    const token = await this.prisma.otpToken.findFirst({
      where:   { phone: normalized, used: false, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });

    if (!token) throw new UnauthorizedException('Código inválido o expirado.');

    // Comparación directa — el código es de corta duración (10 min)
    const valid = code === token.code;
    if (!valid)  throw new UnauthorizedException('Código incorrecto.');

    // Marcar como usado
    await this.prisma.otpToken.update({ where: { id: token.id }, data: { used: true } });

    // Crear usuario si no existe
    let user = await this.prisma.user.findUnique({ where: { phone: normalized } });
    const isNewUser = !user;
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          phone:         normalized,
          phoneVerified: true,
          fullName:      '',
          username:      await this.generateUsername(normalized),
          kycLevel:      1,
        },
      });
    } else {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { phoneVerified: true },
      });
    }

    return { ...this.generateTokenPair(user.id), isNewUser };
  }

  // ── 3. Refresh token ──────────────────────────────────────
  async refresh(
    rawRefreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    let payload: { sub: string; jti: string };
    try {
      payload = this.jwt.verify(rawRefreshToken, {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Refresh token inválido.');
    }

    const revoked = await this.redis.get(`refresh:revoked:${payload.jti}`);
    if (revoked) throw new UnauthorizedException('Sesión expirada.');

    await this.redis.set(
      `refresh:revoked:${payload.jti}`,
      '1',
      REFRESH_TTL_DAYS * 86_400,
    );

    return this.generateTokenPair(payload.sub);
  }

  // ── 4. Logout ──────────────────────────────────────────────
  async logout(userId: string, jti: string): Promise<void> {
    await this.redis.set(`refresh:revoked:${jti}`, '1', REFRESH_TTL_DAYS * 86_400);
  }

  // ── Helpers ───────────────────────────────────────────────
  private generateTokenPair(userId: string) {
    const jti          = crypto.randomUUID();
    const accessToken  = this.jwt.sign({ sub: userId });
    const refreshToken = this.jwt.sign(
      { sub: userId, jti },
      {
        secret:    this.config.getOrThrow('JWT_REFRESH_SECRET'),
        expiresIn: `${REFRESH_TTL_DAYS}d`,
      },
    );
    return { accessToken, refreshToken };
  }

  private normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.startsWith('57') && digits.length === 12) return `+${digits}`;
    if (digits.length === 10) return `+57${digits}`;
    throw new BadRequestException('Número de teléfono inválido. Usa formato colombiano.');
  }

  private async generateUsername(phone: string): Promise<string> {
    const base   = `user${phone.slice(-4)}`;
    const exists = await this.prisma.user.findUnique({ where: { username: base } });
    if (!exists) return base;
    return `${base}${Math.floor(Math.random() * 9000) + 1000}`;
  }
}


@Injectable()
export class AuthService {
  constructor(
    private readonly prisma:  PrismaService,
    private readonly jwt:     JwtService,
    private readonly redis:   RedisService,
    private readonly otp:     OtpService,
    private readonly config:  ConfigService,
  ) {}

  // ── 1. Solicitar OTP ──────────────────────────────────────
  async requestOtp(phone: string): Promise<void> {
    const normalized = this.normalizePhone(phone);

    // Rate limit: máx 3 OTPs/hora por número
    const key   = `otp:rate:${normalized}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, 3600);
    if (count > 3) {
      throw new BadRequestException('Demasiados intentos. Espera una hora.');
    }

    const code = this.otp.generate();

    // Guardar en BD (TTL 10 min)
    await this.prisma.otpToken.create({
      data: {
        phone:     normalized,
        code:      await bcrypt.hash(code, 10),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    await this.otp.send(normalized, code);
  }

  // ── 2. Verificar OTP → tokens ─────────────────────────────
  async verifyOtp(
    phone: string,
    code:  string,
  ): Promise<{ accessToken: string; refreshToken: string; isNewUser: boolean }> {
    const normalized = this.normalizePhone(phone);

    // Buscar el OTP más reciente no usado
    const token = await this.prisma.otpToken.findFirst({
      where:   { phone: normalized, used: false, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });

    if (!token) throw new UnauthorizedException('Código inválido o expirado.');

    const valid = await bcrypt.compare(code, token.code);
    if (!valid)  throw new UnauthorizedException('Código incorrecto.');

    // Marcar como usado
    await this.prisma.otpToken.update({ where: { id: token.id }, data: { used: true } });

    // Crear usuario si no existe
    let user = await this.prisma.user.findUnique({ where: { phone: normalized } });
    const isNewUser = !user;
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          phone:         normalized,
          phoneVerified: true,
          fullName:      '',
          username:      await this.generateUsername(normalized),
          kycLevel:      1,
        },
      });
    } else {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { phoneVerified: true },
      });
    }

    return { ...this.generateTokenPair(user.id), isNewUser };
  }

  // ── 3. Refresh token ──────────────────────────────────────
  async refresh(
    rawRefreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    let payload: { sub: string; jti: string };
    try {
      payload = this.jwt.verify(rawRefreshToken, {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Refresh token inválido.');
    }

    // Verificar que no esté revocado
    const revoked = await this.redis.get(`refresh:revoked:${payload.jti}`);
    if (revoked) throw new UnauthorizedException('Sesión expirada.');

    // Revocar el actual (rotación)
    await this.redis.set(
      `refresh:revoked:${payload.jti}`,
      '1',
      REFRESH_TTL_DAYS * 86_400,
    );

    return this.generateTokenPair(payload.sub);
  }

  // ── 4. Logout ──────────────────────────────────────────────
  async logout(userId: string, jti: string): Promise<void> {
    await this.redis.set(`refresh:revoked:${jti}`, '1', REFRESH_TTL_DAYS * 86_400);
  }

  // ── Helpers ───────────────────────────────────────────────
  private generateTokenPair(userId: string) {
    const jti          = crypto.randomUUID();
    const accessToken  = this.jwt.sign({ sub: userId });
    const refreshToken = this.jwt.sign(
      { sub: userId, jti },
      {
        secret:     this.config.getOrThrow('JWT_REFRESH_SECRET'),
        expiresIn:  `${REFRESH_TTL_DAYS}d`,
      },
    );
    return { accessToken, refreshToken };
  }

  private normalizePhone(phone: string): string {
    // Acepta: 3001234567 | +573001234567 | 573001234567
    const digits = phone.replace(/\D/g, '');
    if (digits.startsWith('57') && digits.length === 12) return `+${digits}`;
    if (digits.length === 10) return `+57${digits}`;
    throw new BadRequestException('Número de teléfono inválido. Usa formato colombiano.');
  }

  private async generateUsername(phone: string): Promise<string> {
    const base    = `user${phone.slice(-4)}`;
    const exists  = await this.prisma.user.findUnique({ where: { username: base } });
    if (!exists) return base;
    return `${base}${Math.floor(Math.random() * 9000) + 1000}`;
  }
}
