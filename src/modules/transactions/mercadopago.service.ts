// src/modules/transactions/mercadopago.service.ts — D-una
// Integración con MercadoPago para pagos Colombia.
// Reemplaza wompi.service.ts — la máquina de estados y el escrow NO cambian.
// Soporta: PSE, tarjeta, Nequi, Daviplata vía MP.

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
export class MercadoPagoService {
  private readonly logger = new Logger(MercadoPagoService.name);
  private readonly http:        AxiosInstance;
  private readonly accessToken: string;
  private readonly webhookSecret: string;
  private readonly isDev:       boolean;

  constructor(private readonly config: ConfigService) {
    this.accessToken    = config.get('MP_ACCESS_TOKEN', '');
    this.webhookSecret  = config.get('MP_WEBHOOK_SECRET', '');
    this.isDev          = config.get('NODE_ENV', 'development') !== 'production';

    this.http = axios.create({
      baseURL: 'https://api.mercadopago.com',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type':  'application/json',
        'X-Idempotency-Key': '',
      },
      timeout: 15_000,
    });
  }

  // ── 1. Crear preferencia de pago (link de pago) ───────────
  async createPaymentLink(input: CreatePaymentLinkInput): Promise<{ url: string; preferenceId: string }> {
    // En desarrollo: retornar URL simulada
    if (this.isDev || !this.accessToken.startsWith('APP_USR') && !this.accessToken.startsWith('TEST')) {
      this.logger.log(
        `[SANDBOX] Pago simulado para tx ${input.transactionId} · $${input.amountCop.toLocaleString('es-CO')} COP · método: ${input.paymentMethod}`,
      );
      return {
        url:          `http://localhost:3000/v1/sandbox/pay/${input.transactionId}`,
        preferenceId: `sandbox_${input.transactionId}`,
      };
    }

    try {
      const appUrl = this.config.get('APP_URL', 'http://localhost:3000');

      // Crear preferencia de pago en MercadoPago
      const { data } = await this.http.post('/checkout/preferences', {
        external_reference: input.transactionId,
        items: [{
          id:          input.transactionId,
          title:       'Compra en D-una',
          quantity:    1,
          unit_price:  input.amountCop,
          currency_id: 'COP',
        }],
        payer: {
          email: input.buyerEmail,
        },
        payment_methods: {
          excluded_payment_types: this.getExcludedMethods(input.paymentMethod),
          installments: 1, // sin cuotas — pago de contado
        },
        back_urls: {
          success: `${appUrl}/v1/payments/success`,
          failure: `${appUrl}/v1/payments/failure`,
          pending: `${appUrl}/v1/payments/pending`,
        },
        auto_return:         'approved',
        notification_url:    `${appUrl}/v1/webhooks/mercadopago`,
        statement_descriptor: 'D-UNA',
        // Retención: el dinero queda en la cuenta de D-una hasta el release
        // MP maneja esto como "marketplace" — no requiere licencia SEDPE adicional
      }, {
        headers: {
          'X-Idempotency-Key': input.transactionId,
        },
      });

      this.logger.log(`MP preferencia creada: ${data.id} → ${data.init_point}`);

      return {
        url:          data.init_point, // URL de pago de MP
        preferenceId: data.id,
      };
    } catch (err: any) {
      this.logger.error('Error creando preferencia MP', err?.response?.data);
      throw new BadGatewayException('Error al iniciar el pago. Intenta de nuevo.');
    }
  }

  // ── 2. Ejecutar payout al vendedor ────────────────────────
  async createPayout(input: CreatePayoutInput): Promise<{ id: string }> {
    // En desarrollo: simular payout
    if (this.isDev || !this.accessToken) {
      this.logger.log(
        `PAYOUT simulado → vendedor ${input.sellerId}: $${input.amountCop.toLocaleString('es-CO')} COP`,
      );
      return { id: `payout_${Date.now()}` };
    }

    // En producción: usar MP Marketplace para transferir al vendedor
    // El vendedor debe haber conectado su cuenta MP vía OAuth previamente
    try {
      const { data } = await this.http.post('/v1/advanced_payments', {
        payments: [{
          payment_method_id: 'account_money',
          transaction_amount: input.amountCop,
          application_fee:    0,
        }],
        disbursements: [{
          collector_id:       input.sellerId, // MP user ID del vendedor
          amount:             input.amountCop,
          external_reference: input.sourceTransactionId,
          notification_url:   `${this.config.get('APP_URL')}/v1/webhooks/mercadopago`,
        }],
        external_reference: `payout_${input.sourceTransactionId}`,
      }, {
        headers: { 'X-Idempotency-Key': `payout_${input.sourceTransactionId}` },
      });

      this.logger.log(`MP payout ejecutado: ${data.id}`);
      return { id: data.id };
    } catch (err: any) {
      this.logger.error('Error ejecutando payout MP', err?.response?.data);
      throw new BadGatewayException('Error al transferir fondos al vendedor.');
    }
  }

  // ── 3. Verificar firma del webhook ────────────────────────
  verifyWebhookSignature(payload: string, signature: string, requestId: string): void {
    // MP firma: HMAC-SHA256 de "id:REQUEST_ID;ts:TIMESTAMP;"
    // Header: x-signature = "ts=TIMESTAMP,v1=HASH"
    if (!this.webhookSecret) return; // en desarrollo omitir

    try {
      const parts     = signature.split(',');
      const ts        = parts.find(p => p.startsWith('ts='))?.split('=')[1];
      const hash      = parts.find(p => p.startsWith('v1='))?.split('=')[1];
      const manifest  = `id:${requestId};ts:${ts};`;
      const expected  = crypto.createHmac('sha256', this.webhookSecret)
        .update(manifest)
        .digest('hex');

      if (expected !== hash) {
        this.logger.error('Firma MP inválida — posible webhook falso');
        throw new Error('Firma del webhook inválida.');
      }
    } catch (err) {
      if (err.message === 'Firma del webhook inválida.') throw err;
      this.logger.warn('Error verificando firma MP — omitiendo en desarrollo');
    }
  }

  // ── 4. Consultar estado de un pago ────────────────────────
  async getPaymentStatus(paymentId: string): Promise<{ status: string; externalReference: string }> {
    if (this.isDev) {
      return { status: 'approved', externalReference: paymentId };
    }

    const { data } = await this.http.get(`/v1/payments/${paymentId}`);
    return {
      status:            data.status,            // approved|rejected|pending|cancelled
      externalReference: data.external_reference, // nuestro transactionId
    };
  }

  // ── Helper: métodos de pago excluidos ─────────────────────
  private getExcludedMethods(method: string): { id: string }[] {
    // Si el usuario eligió un método específico, excluir los demás
    const allMethods = ['credit_card', 'debit_card', 'pse', 'bank_transfer'];
    const methodMap: Record<string, string> = {
      card:       'credit_card',
      pse:        'pse',
      nequi:      'bank_transfer',
      daviplata:  'bank_transfer',
    };
    const selected = methodMap[method];
    if (!selected) return []; // mostrar todos
    return allMethods
      .filter(m => m !== selected)
      .map(m => ({ id: m }));
  }
}
