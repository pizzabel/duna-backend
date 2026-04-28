// src/modules/auth/jwt.strategy.ts — D-una
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService }    from '@nestjs/config';
import { PrismaService }    from '../../common/prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config:  ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest:   ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:      config.getOrThrow('JWT_SECRET'),
    });
  }

  async validate(payload: { sub: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, status: true, kycLevel: true, riskScore: true },
    });

    if (!user || user.status === 'BANNED') {
      throw new UnauthorizedException('Cuenta suspendida o no encontrada.');
    }

    return { userId: user.id, status: user.status, kycLevel: user.kycLevel };
  }
}
