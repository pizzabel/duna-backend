// src/modules/disputes/disputes.service.ts — D-una
import {
  Injectable, NotFoundException, ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { PrismaService }  from '../../common/prisma/prisma.service';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { AddEvidenceDto }   from './dto/add-evidence.dto';

@Injectable()
export class DisputesService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Abrir disputa ─────────────────────────────────────────
  async create(dto: CreateDisputeDto, userId: string) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: dto.transactionId },
    });
    if (!tx) throw new NotFoundException('Transacción no encontrada.');
    if (tx.buyerId !== userId && tx.sellerId !== userId) {
      throw new ForbiddenException('No tienes acceso a esta transacción.');
    }
    if (!['PAID_HELD', 'DELIVERED'].includes(tx.status)) {
      throw new BadRequestException(
        `No se puede abrir una disputa en estado ${tx.status}. Solo en PAID_HELD o DELIVERED.`,
      );
    }

    // Verificar que no haya disputa abierta ya
    const existing = await this.prisma.dispute.findFirst({
      where: {
        transactionId: dto.transactionId,
        status: { in: ['OPEN', 'UNDER_REVIEW', 'EVIDENCE_REQUESTED'] },
      },
    });
    if (existing) {
      throw new BadRequestException('Ya hay una disputa abierta para esta transacción.');
    }

    // Cambiar estado de la transacción a DISPUTED
    await this.prisma.transaction.update({
      where: { id: dto.transactionId },
      data:  { status: 'DISPUTED', updatedAt: new Date() },
    });

    // Registrar evento
    await this.prisma.transactionEvent.create({
      data: {
        transactionId: dto.transactionId,
        eventType:     'dispute_opened',
        actorId:       userId,
        payload:       { reason: dto.reason },
      },
    });

    const dispute = await this.prisma.dispute.create({
      data: {
        transactionId: dto.transactionId,
        openedById:    userId,
        reason:        dto.reason as any,
        description:   dto.description,
        status:        'OPEN',
      },
      include: {
        openedBy: { select: { id: true, username: true } },
        transaction: {
          select: {
            id: true, status: true, amountCop: true,
            post: { select: { title: true } },
          },
        },
      },
    });

    return {
      ...dispute,
      transaction: {
        ...dispute.transaction,
        amountCop: Number(dispute.transaction.amountCop),
      },
    };
  }

  // ── Agregar evidencia ─────────────────────────────────────
  async addEvidence(disputeId: string, dto: AddEvidenceDto, userId: string) {
    const dispute = await this.prisma.dispute.findUnique({
      where:   { id: disputeId },
      include: { transaction: true },
    });
    if (!dispute) throw new NotFoundException('Disputa no encontrada.');

    const { buyerId, sellerId } = dispute.transaction;
    if (userId !== buyerId && userId !== sellerId) {
      throw new ForbiddenException('Sin acceso a esta disputa.');
    }
    if (['RESOLVED_REFUND', 'RESOLVED_RELEASE', 'RESOLVED_PARTIAL'].includes(dispute.status)) {
      throw new BadRequestException('La disputa ya fue resuelta.');
    }

    return this.prisma.disputeEvidence.create({
      data: {
        disputeId,
        submittedById: userId,
        type:          dto.type,
        content:       dto.content,
      },
    });
  }

  // ── Detalle de una disputa ────────────────────────────────
  async findOne(id: string, userId: string) {
    const dispute = await this.prisma.dispute.findUnique({
      where:   { id },
      include: {
        openedBy:  { select: { id: true, username: true, avatarUrl: true } },
        evidence:  { orderBy: { createdAt: 'asc' } },
        transaction: {
          include: {
            post:   { select: { title: true, images: { take: 1 } } },
            buyer:  { select: { id: true, username: true } },
            seller: { select: { id: true, username: true } },
          },
        },
      },
    });

    if (!dispute) throw new NotFoundException('Disputa no encontrada.');
    const { buyerId, sellerId } = dispute.transaction;
    if (userId !== buyerId && userId !== sellerId) {
      throw new ForbiddenException('Sin acceso.');
    }

    return {
      ...dispute,
      transaction: {
        ...dispute.transaction,
        amountCop:       Number(dispute.transaction.amountCop),
        commissionCop:   Number(dispute.transaction.commissionCop),
        sellerPayoutCop: Number(dispute.transaction.sellerPayoutCop),
      },
    };
  }

  // ── Mis disputas ──────────────────────────────────────────
  async findByUser(userId: string) {
    const disputes = await this.prisma.dispute.findMany({
      where: {
        transaction: {
          OR: [{ buyerId: userId }, { sellerId: userId }],
        },
      },
      include: {
        transaction: {
          select: {
            id: true, amountCop: true,
            post: { select: { title: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return disputes.map(d => ({
      ...d,
      transaction: {
        ...d.transaction,
        amountCop: Number(d.transaction.amountCop),
      },
    }));
  }
}
