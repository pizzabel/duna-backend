// src/modules/antifraud/antifraud.service.ts — D-una
// Pipeline de análisis de mensajes en tiempo real.
// Cada mensaje pasa por esta cadena ANTES de persistirse.

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService }      from '../../common/prisma/prisma.service';

export interface FlagResult {
  flagged:     boolean;
  flags:       string[];
  redactedBody: string;
  riskDelta:   number; // puntos a sumar al risk_score del remitente
}

// Palabras y patrones que indican intento de evasión de plataforma
const ESCAPE_KEYWORDS: string[] = [
  'whatsapp', 'wasap', 'wsp', 'telegram',
  'instagram', 'insta',
  'llámame', 'llamame', 'llama al', 'me llamas',
  'fuera de la app', 'por fuera', 'fuera de duna',
  'en efectivo', 'pago en efectivo', 'cash', 'en mano', 'en físico',
  'transferencia directa', 'transferencia bancaria directa',
  'contra entrega sin app', 'sin pagar aquí',
  'nequi directo', 'daviplata directo',
];

// Teléfonos colombianos: móviles (3xx) y fijos (60x)
const PHONE_REGEX =
  /\b(?:\+?57[\s\-.]?)?(?:3\d{2}[\s\-.]?\d{3}[\s\-.]?\d{4}|60\d[\s\-.]?\d{3}[\s\-.]?\d{4})\b/g;

// URLs externas (no whitelistadas)
const URL_REGEX = /https?:\/\/\S+/gi;
const URL_WHITELIST = ['duna.app', 'dane.gov.co'];

// Emails
const EMAIL_REGEX = /[\w.+\-]+@[\w.\-]+\.[a-z]{2,}/gi;

// Puntos de riesgo por tipo de flag
const RISK_POINTS: Record<string, number> = {
  phone_number:   15,
  escape_keyword: 20,
  external_link:  10,
  email:          10,
};

@Injectable()
export class AntifraudService {
  private readonly logger = new Logger(AntifraudService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Punto de entrada principal ────────────────────────────
  scan(body: string): FlagResult {
    const flags: string[]  = [];
    let redacted           = body;
    let riskDelta          = 0;

    // 1. Números de teléfono colombianos
    PHONE_REGEX.lastIndex = 0;
    if (PHONE_REGEX.test(body)) {
      flags.push('phone_number');
      riskDelta += RISK_POINTS.phone_number;
      PHONE_REGEX.lastIndex = 0;
      redacted = redacted.replace(PHONE_REGEX, '[número bloqueado]');
    }

    // 2. Keywords de escape (case-insensitive, variantes con tildes)
    const lower = this.normalize(body);
    for (const word of ESCAPE_KEYWORDS) {
      const normalizedWord = this.normalize(word);
      if (lower.includes(normalizedWord)) {
        const flagKey = `escape_keyword:${word}`;
        if (!flags.includes(flagKey)) {
          flags.push(flagKey);
          riskDelta += RISK_POINTS.escape_keyword;
        }
        // Reemplazar en el texto redactado
        const re = new RegExp(this.escapeRegex(word), 'gi');
        redacted  = redacted.replace(re, '[bloqueado]');
      }
    }

    // 3. URLs externas no whitelistadas
    URL_REGEX.lastIndex = 0;
    const urls = body.match(URL_REGEX) ?? [];
    for (const url of urls) {
      if (!URL_WHITELIST.some(w => url.toLowerCase().includes(w))) {
        if (!flags.includes('external_link')) {
          flags.push('external_link');
          riskDelta += RISK_POINTS.external_link;
        }
        redacted = redacted.replace(url, '[enlace bloqueado]');
      }
    }

    // 4. Emails
    EMAIL_REGEX.lastIndex = 0;
    if (EMAIL_REGEX.test(body)) {
      flags.push('email');
      riskDelta += RISK_POINTS.email;
      EMAIL_REGEX.lastIndex = 0;
      redacted = redacted.replace(EMAIL_REGEX, '[email bloqueado]');
    }

    return {
      flagged:      flags.length > 0,
      flags,
      redactedBody: redacted,
      riskDelta,
    };
  }

  // ── Actualizar risk_score del usuario ─────────────────────
  async applyRiskDelta(userId: string, delta: number): Promise<number> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        riskScore: { increment: delta },
        updatedAt: new Date(),
      },
      select: { riskScore: true, status: true },
    });

    const newScore = user.riskScore;
    this.logger.log(`Usuario ${userId} → riskScore: ${newScore}`);

    // Acciones automáticas por umbral
    if (newScore >= 90 && user.status === 'ACTIVE') {
      await this.autoBan(userId);
    } else if (newScore >= 70 && user.status === 'ACTIVE') {
      await this.requireKyc(userId);
    }

    return newScore;
  }

  // ── Acciones automáticas ──────────────────────────────────
  private async autoBan(userId: string): Promise<void> {
    this.logger.warn(`AUTO-BAN disparado para usuario ${userId}`);
    await this.prisma.user.update({
      where: { id: userId },
      data: { status: 'BANNED' },
    });
    // TODO: reembolso automático de transacciones abiertas
    // TODO: notificación al panel admin
  }

  private async requireKyc(userId: string): Promise<void> {
    this.logger.warn(`KYC requerido para usuario ${userId} (score ≥ 70)`);
    // Ocultar publicaciones del feed hasta verificar
    await this.prisma.post.updateMany({
      where: { sellerId: userId, status: 'ACTIVE' },
      data:  { status: 'PAUSED' },
    });
  }

  // ── Utilidades ────────────────────────────────────────────

  /** Normaliza texto: minúsculas + elimina tildes */
  private normalize(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
