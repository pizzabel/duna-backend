// src/modules/reviews/reviews.service.ts — D-una
import {
  Injectable, NotFoundException, ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { PrismaService }  from '../../common/prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Crear calificación ────────────────────────────────────
  async create(dto: CreateReviewDto, reviewerId: string) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: dto.transactionId },
    });
    if (!tx) throw new NotFoundException('Transacción no encontrada.');

    // Solo comprador o vendedor pueden calificar
    if (tx.buyerId !== reviewerId && tx.sellerId !== reviewerId) {
      throw new ForbiddenException('No participaste en esta transacción.');
    }

    // Solo se puede calificar tras RELEASED
    if (tx.status !== 'RELEASED') {
      throw new BadRequestException(
        'Solo puedes calificar cuando la transacción está completada (RELEASED).',
      );
    }

    // El reviewee es el otro participante
    const revieweeId = tx.buyerId === reviewerId ? tx.sellerId : tx.buyerId;

    // Verificar que no haya calificado ya
    const existing = await this.prisma.review.findUnique({
      where: { transactionId_reviewerId: { transactionId: dto.transactionId, reviewerId } },
    });
    if (existing) {
      throw new BadRequestException('Ya calificaste esta transacción.');
    }

    const review = await this.prisma.review.create({
      data: {
        transactionId: dto.transactionId,
        reviewerId,
        revieweeId,
        rating:  dto.rating,
        comment: dto.comment,
      },
      include: {
        reviewer: { select: { id: true, username: true, avatarUrl: true } },
        reviewee: { select: { id: true, username: true } },
      },
    });

    return review;
  }

  // ── Calificaciones de un usuario ──────────────────────────
  async findByUser(userId: string) {
    const reviews = await this.prisma.review.findMany({
      where:   { revieweeId: userId },
      include: {
        reviewer: { select: { id: true, username: true, avatarUrl: true } },
        transaction: { select: { post: { select: { title: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Calcular promedio
    const avg = reviews.length
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
      : 0;

    return {
      userId,
      ratingAvg:   Math.round(avg * 10) / 10,
      ratingCount: reviews.length,
      reviews,
    };
  }
}
