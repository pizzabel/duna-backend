// src/modules/transactions/transactions.service.ts — D-una
// Máquina de estados finita + lógica de escrow + integración Wompi/MercadoPago.

import {
  Injectable, Logger, BadRequestException,
  NotFoundException, ForbiddenException,
} from '@nestjs/common';
import { PrismaService }        from '../../common/prisma/prisma.service';
import { WompiService }         from './wompi.service';
import { MercadoPagoService }   from './mercadopago.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TransactionStatus }    from '@prisma/client';
import { CreateTransactionDto } from './dto/create-transaction.dto';

// Comisión: 8% sobre el precio, mínimo $2.000 COP
function calcCommission(priceCop: bigint) {
  const price      = Number(priceCop);
  const commission = Math.max(Math.round(price * 0.08), 2_000);
  const wompiFee   = Math.round(price * 0.0299) + 900;
  return {
    commissionCop:   BigInt(commission),
    sellerPayoutCop: BigInt(price - commission),
    platformNetCop:  BigInt(commission - wompiFee),
    wompiFee:        BigInt(wompiFee),
  };
}

// Transiciones válidas de la máquina de estados
const VALID_TRANSITIONS: Partial<Record<TransactionStatus, TransactionStatus[]>> = {
  PENDING_PAYMENT: [TransactionStatus.PAID_HELD,  TransactionStatus.CANCELLED],
  PAID_HELD:       [TransactionStatus.DELIVERED,  TransactionStatus.DISPUTED, TransactionStatus.CANCELLED],
  DELIVERED:       [TransactionStatus.RELEASED,   TransactionStatus.DISPUTED],
  DISPUTED:        [TransactionStatus.RELEASED,   TransactionStatus.REFUNDED],
};

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    private readonly prisma:         PrismaService,
    private readonly wompi:          WompiService,
    private readonly mp:             MercadoPagoService,
    private readonly notifications:  NotificationsService,
  ) {}

  // ── 1. Iniciar compra ─────────────────────────────────────
  async create(buyerId: string, dto: CreateTransactionDto) {
    const post = await this.prisma.post.findFirst({
      where: { id: dto.postId, status: 'ACTIVE' },
      include: { seller: true },
    });
    if (!post) throw new NotFoundException('Publicación no disponible.');
    if (post.sellerId === buyerId) throw new BadRequestException('No puedes comprarte a ti mismo.');

    // Máximo 3 compras en PAID_HELD simultáneas (anti-escape de capital)
    const heldCount = await this.prisma.transaction.count({
      where: { buyerId, status: 'PAID_HELD' },
    });
    if (heldCount >= 3) {
      throw new BadRequestException('Tienes 3 pagos pendientes. Confirma recepción antes de comprar más.');
    }

    const fees = calcCommission(post.priceCop);

    const tx = await this.prisma.transaction.create({
      data: {
        postId:          post.id,
        buyerId,
        sellerId:        post.sellerId,
        amountCop:       post.priceCop,
        commissionCop:   fees.commissionCop,
        sellerPayoutCop: fees.sellerPayoutCop,
        status:          'PENDING_PAYMENT',
        paymentMethod:   dto.paymentMethod,
      },
    });

    await this.logEvent(tx.id, 'transaction_created', { buyerId, postId: post.id }, buyerId);

    // Crear link de pago en Wompi (sandbox: retorna URL simulada)
    const paymentLink = await this.wompi.createPaymentLink({
      transactionId: tx.id,
      amountCop:     Number(post.priceCop),
      paymentMethod: dto.paymentMethod,
      buyerEmail:    dto.buyerEmail,
    });

    return {
      transactionId: tx.id,
      paymentUrl:    paymentLink.url,
      reference:     tx.id,
      amount:        Number(post.priceCop),
      commission:    Number(fees.commissionCop),
      sellerPayout:  Number(fees.sellerPayoutCop),
    };
  }

  // ── 2. Webhook Wompi → PAID_HELD ─────────────────────────
  async handleWompiWebhook(payload: any, signature: string): Promise<void> {
    // En sandbox omitimos verificación de firma
    if (process.env.NODE_ENV === 'production') {
      this.wompi.verifySignature(payload, signature);
    }

    const tx_data = payload?.data?.transaction;
    if (!tx_data) return;

    const { reference, status, id: providerTxId, payment_method_type } = tx_data;

    const tx = await this.prisma.transaction.findUnique({ where: { id: reference } });
    if (!tx) {
      this.logger.warn(`Webhook Wompi: transacción no encontrada ${reference}`);
      return;
    }

    if (status === 'APPROVED' && tx.status === 'PENDING_PAYMENT') {
      await this.transition(tx.id, 'PAID_HELD', null, {
        providerTxId,
        paymentMethod:   payment_method_type,
        paymentProvider: 'wompi',
      });
      await this.notifications.send(tx.sellerId, 'nueva_venta', {
        transactionId: tx.id,
        amount:        Number(tx.amountCop),
      });
    }

    if (['DECLINED', 'VOIDED', 'ERROR'].includes(status)) {
      await this.transition(tx.id, 'CANCELLED', null, { reason: status });
    }
  }

  // ── 3. Vendedor marca entregado → DELIVERED ───────────────
  async confirmDelivery(transactionId: string, sellerId: string): Promise<void> {
    const tx = await this.findAndValidate(transactionId, sellerId, 'seller');
    if (tx.status !== 'PAID_HELD') {
      throw new BadRequestException('Solo puedes marcar entregado cuando el pago está retenido.');
    }

    const autoReleaseAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

    await this.transition(transactionId, 'DELIVERED', sellerId, {});
    await this.prisma.transaction.update({
      where: { id: transactionId },
      data:  { autoReleaseAt },
    });

    await this.notifications.send(tx.buyerId, 'producto_entregado', { transactionId });
  }

  // ── 4. Comprador confirma recepción → RELEASED ────────────
  async confirmReceipt(transactionId: string, buyerId: string): Promise<void> {
    const tx = await this.findAndValidate(transactionId, buyerId, 'buyer');
    if (tx.status !== 'DELIVERED') {
      throw new BadRequestException('El vendedor aún no marcó el producto como entregado.');
    }
    await this.releaseToSeller(tx);
  }

  // ── 5. Abrir disputa ──────────────────────────────────────
  async openDispute(
    transactionId: string,
    userId:        string,
    reason:        string,
    description:   string,
  ) {
    const tx = await this.prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!tx) throw new NotFoundException('Transacción no encontrada.');
    if (tx.buyerId !== userId && tx.sellerId !== userId) {
      throw new ForbiddenException('Sin acceso a esta transacción.');
    }
    if (!['PAID_HELD', 'DELIVERED'].includes(tx.status)) {
      throw new BadRequestException('No se puede disputar en este estado.');
    }

    await this.transition(transactionId, 'DISPUTED', userId, {});

    const dispute = await this.prisma.dispute.create({
      data: {
        transactionId,
        openedById:  userId,
        reason:      reason as any,
        description,
        status:      'OPEN',
      },
    });

    return dispute;
  }

  // ── 6. Auto-release (job cada 5 min) ──────────────────────
  async autoRelease(transactionId: string): Promise<void> {
    const tx = await this.prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!tx || tx.status !== 'DELIVERED') return;

    const openDispute = await this.prisma.dispute.findFirst({
      where: { transactionId, status: { in: ['OPEN', 'UNDER_REVIEW', 'EVIDENCE_REQUESTED'] } },
    });
    if (openDispute) return;

    await this.releaseToSeller(tx);
    await this.logEvent(transactionId, 'auto_released', { reason: '72h_timeout' }, null);
  }

  // ── Historial del usuario ─────────────────────────────────
  async findByUser(userId: string) {
    const txs = await this.prisma.transaction.findMany({
      where:   { OR: [{ buyerId: userId }, { sellerId: userId }] },
      include: {
        post:   { select: { title: true, images: { take: 1, orderBy: { position: 'asc' } } } },
        buyer:  { select: { id: true, username: true, avatarUrl: true } },
        seller: { select: { id: true, username: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return txs.map(tx => ({
      ...tx,
      amountCop:       Number(tx.amountCop),
      commissionCop:   Number(tx.commissionCop),
      sellerPayoutCop: Number(tx.sellerPayoutCop),
      isBuyer:         tx.buyerId === userId,
    }));
  }

  // ── Detalle de una transacción ────────────────────────────
  async findOne(id: string, userId: string) {
    const tx = await this.prisma.transaction.findUnique({
      where:   { id },
      include: {
        post:    { select: { title: true, images: { take: 1, orderBy: { position: 'asc' } } } },
        buyer:   { select: { id: true, username: true, avatarUrl: true } },
        seller:  { select: { id: true, username: true, avatarUrl: true } },
        events:  { orderBy: { createdAt: 'asc' } },
        disputes: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    if (!tx) throw new NotFoundException('Transacción no encontrada.');
    if (tx.buyerId !== userId && tx.sellerId !== userId) {
      throw new ForbiddenException('Sin acceso.');
    }

    return {
      ...tx,
      amountCop:       Number(tx.amountCop),
      commissionCop:   Number(tx.commissionCop),
      sellerPayoutCop: Number(tx.sellerPayoutCop),
      isBuyer:         tx.buyerId === userId,
    };
  }

  // ── Helpers internos ──────────────────────────────────────
  private async releaseToSeller(tx: any): Promise<void> {
    this.logger.log(`Liberando pago → vendedor ${tx.sellerId}: $${Number(tx.sellerPayoutCop).toLocaleString('es-CO')} COP`);

    await this.wompi.createPayout({
      sourceTransactionId: tx.providerTxId,
      amountCop:           Number(tx.sellerPayoutCop),
      sellerId:            tx.sellerId,
    });

    await this.prisma.transaction.update({
      where: { id: tx.id },
      data:  { status: 'RELEASED', releasedAt: new Date() },
    });

    await this.logEvent(tx.id, 'released', {}, null);

    await this.notifications.send(tx.sellerId, 'pago_recibido', {
      transactionId: tx.id,
      amount:        Number(tx.sellerPayoutCop),
    });

    await this.notifications.send(tx.buyerId, 'transaccion_completada', {
      transactionId: tx.id,
    });
  }

  private async transition(
    txId:    string,
    to:      TransactionStatus,
    actorId: string | null,
    extra:   Record<string, any>,
  ): Promise<void> {
    const tx = await this.prisma.transaction.findUniqueOrThrow({ where: { id: txId } });

    const allowed = VALID_TRANSITIONS[tx.status] ?? [];
    if (!allowed.includes(to)) {
      throw new BadRequestException(`Transición inválida: ${tx.status} → ${to}`);
    }

    await this.prisma.transaction.update({
      where: { id: txId },
      data: {
        status:    to,
        updatedAt: new Date(),
        ...(extra.providerTxId    && { providerTxId:     extra.providerTxId }),
        ...(extra.paymentMethod   && { paymentMethod:    extra.paymentMethod }),
        ...(extra.paymentProvider && { paymentProvider:  extra.paymentProvider }),
      },
    });

    await this.logEvent(txId, `status_→_${to.toLowerCase()}`, extra, actorId);
  }

  private async logEvent(
    txId:      string,
    eventType: string,
    payload:   object,
    actorId:   string | null,
  ): Promise<void> {
    await this.prisma.transactionEvent.create({
      data: { transactionId: txId, eventType, payload, actorId },
    });
  }

  private async findAndValidate(txId: string, userId: string, role: 'buyer' | 'seller') {
    const tx = await this.prisma.transaction.findUnique({ where: { id: txId } });
    if (!tx) throw new NotFoundException('Transacción no encontrada.');
    const field = role === 'buyer' ? 'buyerId' : 'sellerId';
    if (tx[field] !== userId) throw new ForbiddenException('Sin acceso.');
    return tx;
  }

  // ── Webhook MercadoPago → PAID_HELD ──────────────────────
  async handleMercadoPagoWebhook(
    payload:   any,
    signature: string,
    requestId: string,
  ): Promise<void> {
    // Verificar firma en producción
    if (process.env.NODE_ENV === 'production') {
      this.mp.verifyWebhookSignature(JSON.stringify(payload), signature, requestId);
    }

    // MP envía distintos tipos de notificaciones
    const topic = payload?.type || payload?.topic;
    if (topic !== 'payment') return; // solo nos interesan pagos

    const paymentId = payload?.data?.id || payload?.id;
    if (!paymentId) return;

    // Consultar el estado real del pago en MP
    const payment = await this.mp.getPaymentStatus(String(paymentId));
    const reference = payment.externalReference; // nuestro transactionId

    const tx = await this.prisma.transaction.findUnique({ where: { id: reference } });
    if (!tx) {
      this.logger.warn(`Webhook MP: transacción no encontrada ${reference}`);
      return;
    }

    if (payment.status === 'approved' && tx.status === 'PENDING_PAYMENT') {
      await this.transition(tx.id, 'PAID_HELD', null, {
        providerTxId:    String(paymentId),
        paymentProvider: 'mercadopago',
        paymentMethod:   'mp',
      });
      await this.notifications.send(tx.sellerId, 'nueva_venta', {
        transactionId: tx.id,
        amount:        Number(tx.amountCop),
      });
      this.logger.log(`MP pago aprobado: tx ${tx.id} → PAID_HELD`);
    }

    if (['rejected', 'cancelled'].includes(payment.status)) {
      await this.transition(tx.id, 'CANCELLED', null, { reason: payment.status });
      this.logger.log(`MP pago rechazado: tx ${tx.id} → CANCELLED`);
    }
  }
}
