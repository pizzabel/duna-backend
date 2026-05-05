// src/modules/transactions/wompi.service.ts — D-una
// Integración con Wompi (Bancolombia) para pagos Colombia.
// Soporta: PSE, tarjeta, Nequi, Daviplata.

import { Injectable, Logger, BadGatewayException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';

interface CreatePaymentLinkInput {
  transactionId: string;
  amountCop:     number;
  paymentMethod: string; // pse|card|nequi|daviplata
  buyerEmail:    string;
}

interface CreatePayoutInput {
  sourceTransactionId: string;
  amountCop:           number;
  sellerId:            string;
}

@Injectable()
export class WompiService {
  private readonly logger = new Logger(WompiService.name);
  private readonly http: AxiosInstance;
  private readonly publicKey:  string;
  private readonly privateKey: string;
  private readonly secret:     string;
  private readonly baseUrl:    string;

  constructor(private readonly config: ConfigService) {
    const env       = config.get('NODE_ENV', 'development');
    this.baseUrl    = env === 'production'
      ? 'https://production.wompi.co/v1'
      : 'https://sandbox.wompi.co/v1';

    this.publicKey  = config.getOrThrow('WOMPI_PUBLIC_KEY');
    this.privateKey = config.getOrThrow('WOMPI_PRIVATE_KEY');
    this.secret     = config.getOrThrow('WOMPI_EVENTS_SECRET');

    this.http = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Authorization': `Bearer ${this.privateKey}`,
        'Content-Type':  'application/json',
      },
      timeout: 15_000,
    });
  }

  // ── 1. Crear link de pago ─────────────────────────────────
  async createPaymentLink(input: CreatePaymentLinkInput): Promise<{ url: string }> {
    // En desarrollo: retornar URL simulada sin llamar a Wompi
    if (process.env.NODE_ENV !== 'production') {
      this.logger.log(`[SANDBOX] Pago simulado para tx ${input.transactionId} · $${input.amountCop.toLocaleString('es-CO')} COP · método: ${input.paymentMethod}`);
      return { url: `http://localhost:3000/v1/sandbox/pay/${input.transactionId}` };
    }

    try {
      // Obtener acceptance token (requerido por Wompi)
      const { data: merchant } = await this.http.get('/merchants/' + this.publicKey);
      const acceptanceToken    = merchant.data.presigned_acceptance.acceptance_token;

      const payload = {
        amount_in_cents: input.amountCop * 100,
        currency:        'COP',
        customer_email:  input.buyerEmail,
        reference:       input.transactionId,
        redirect_url:    `${this.config.getOrThrow('APP_URL')}/compra/${input.transactionId}`,
        acceptance_token: acceptanceToken,
        payment_method: this.buildPaymentMethod(input.paymentMethod),
      };

      const { data } = await this.http.post('/transactions', payload);
      const tx       = data.data;

      this.logger.log(`Wompi tx creada: ${tx.id} → ${tx.status}`);

      // Para Nequi/Daviplata retorna redirect URL; para PSE/tarjeta también
      return { url: tx.payment_method?.extra?.redirect_url ?? tx.payment_link_id ?? '' };
    } catch (err: any) {
      this.logger.error('Error creando pago en Wompi', err?.response?.data);
      throw new BadGatewayException('Error al iniciar el pago. Intenta de nuevo.');
    }
  }

  // ── 2. Ejecutar payout al vendedor ────────────────────────
  async createPayout(input: CreatePayoutInput): Promise<{ id: string }> {
    // En producción: POST /v1/transactions tipo payout
    // En sandbox simulamos con log
    this.logger.log(
      `PAYOUT simulado → vendedor ${input.sellerId}: $${input.amountCop.toLocaleString('es-CO')} COP`,
    );

    // TODO producción:
    // const { data } = await this.http.post('/payouts', {
    //   source_transaction_id: input.sourceTransactionId,
    //   amount_in_cents:       input.amountCop * 100,
    //   currency:              'COP',
    //   ...destination bank account
    // });

    return { id: `payout_${Date.now()}` };
  }

  // ── 3. Verificar firma HMAC del webhook ───────────────────
  verifySignature(payload: any, signature: string): void {
    // Omitir verificacion si no hay secret configurado (sandbox/desarrollo)
    if (!this.secret || this.secret === 'test_placeholder' || this.secret === 'placeholder') {
      this.logger.warn('Wompi signature check omitido — sin secret configurado');
      return;
    }

    const { id, status, amount_in_cents, currency, created_at } = payload?.data?.transaction ?? {};
    const checksum_props = `${id}${status}${amount_in_cents}${currency}${created_at}${this.secret}`;
    const expected = crypto.createHash('sha256').update(checksum_props).digest('hex');

    if (expected !== signature) {
      this.logger.error('Firma Wompi invalida — posible webhook falso');
      throw new Error('Firma del webhook invalida.');
    }
  }

  // ── Helpers ───────────────────────────────────────────────
  private buildPaymentMethod(method: string): object {
    switch (method) {
      case 'nequi':
        return { type: 'NEQUI' };
      case 'daviplata':
        return { type: 'DAVIPLATA' };
      case 'pse':
        return { type: 'PSE', user_type: 0, user_legal_id_type: 'CC', user_legal_id: '', financial_institution_code: '' };
      default:
        return { type: 'CARD' };
    }
  }
}
