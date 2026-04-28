// src/modules/transactions/transactions.controller.ts — D-una
import {
  Controller, Post, Get, Body, Param, Req,
  HttpCode, HttpStatus, Headers, RawBodyRequest,
} from '@nestjs/common';
import { TransactionsService }  from './transactions.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { Public }               from '../../common/decorators/public.decorator';

@Controller('transactions')
export class TransactionsController {
  constructor(private readonly txService: TransactionsService) {}

  /**
   * POST /v1/transactions
   * Comprador inicia compra → devuelve URL de pago Wompi
   */
  @Post()
  create(@Body() dto: CreateTransactionDto, @Req() req: any) {
    return this.txService.create(req.user.userId, dto);
  }

  /**
   * GET /v1/transactions/me
   * Historial de compras y ventas del usuario autenticado
   */
  @Get('me')
  myTransactions(@Req() req: any) {
    return this.txService.findByUser(req.user.userId);
  }

  /**
   * GET /v1/transactions/:id
   * Detalle de una transacción (comprador o vendedor)
   */
  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.txService.findOne(id, req.user.userId);
  }

  /**
   * POST /v1/transactions/:id/confirm-delivery
   * Vendedor marca el producto como entregado → estado DELIVERED
   * Inicia el contador de 72h para auto-release
   */
  @Post(':id/confirm-delivery')
  @HttpCode(HttpStatus.NO_CONTENT)
  confirmDelivery(@Param('id') id: string, @Req() req: any) {
    return this.txService.confirmDelivery(id, req.user.userId);
  }

  /**
   * POST /v1/transactions/:id/confirm-receipt
   * Comprador confirma recepción → estado RELEASED → payout al vendedor
   */
  @Post(':id/confirm-receipt')
  @HttpCode(HttpStatus.NO_CONTENT)
  confirmReceipt(@Param('id') id: string, @Req() req: any) {
    return this.txService.confirmReceipt(id, req.user.userId);
  }

  /**
   * POST /v1/transactions/:id/dispute
   * Cualquiera de los dos abre una disputa → congela auto-release
   */
  @Post(':id/dispute')
  openDispute(
    @Param('id') id: string,
    @Body() body: { reason: string; description: string },
    @Req() req: any,
  ) {
    return this.txService.openDispute(id, req.user.userId, body.reason, body.description);
  }
}

// ── Webhook Wompi (ruta separada, sin JWT) ─────────────────
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly txService: TransactionsService) {}

  /**
   * POST /v1/webhooks/wompi
   * Wompi notifica cambios de estado del pago.
   * Verifica firma HMAC antes de procesar.
   * Es pública — Wompi no envía JWT.
   */
  @Public()
  @Post('wompi')
  @HttpCode(HttpStatus.OK)
  wompiWebhook(
    @Body() payload: any,
    @Headers('x-event-checksum') signature: string,
  ) {
    return this.txService.handleWompiWebhook(payload, signature);
  }
}
