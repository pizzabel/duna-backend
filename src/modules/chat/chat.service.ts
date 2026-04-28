// src/modules/chat/chat.service.ts — D-una
import {
  Injectable, NotFoundException, ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Crear o reutilizar chat sobre una publicación ─────────
  async create(postId: string, buyerId: string) {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, status: 'ACTIVE' },
    });
    if (!post) throw new NotFoundException('Publicación no encontrada o no disponible.');
    if (post.sellerId === buyerId) {
      throw new ForbiddenException('No puedes chatear contigo mismo.');
    }

    // Reusar chat si ya existe (UNIQUE postId + buyerId)
    const existing = await this.prisma.chat.findUnique({
      where: { postId_buyerId: { postId, buyerId } },
      include: { post: { select: { title: true, priceCop: true } } },
    });
    if (existing) {
      return { ...existing, post: { ...existing.post, priceCop: Number(existing.post.priceCop) } };
    }

    const created = await this.prisma.chat.create({
      data: { postId, buyerId, sellerId: post.sellerId },
      include: { post: { select: { title: true, priceCop: true } } },
    });
    return { ...created, post: { ...created.post, priceCop: Number(created.post.priceCop) } };
  }

  // ── Lista de chats del usuario con último mensaje ─────────
  async findByUser(userId: string) {
    const chats = await this.prisma.chat.findMany({
      where: { OR: [{ buyerId: userId }, { sellerId: userId }] },
      include: {
        post: {
          select: {
            id: true, title: true, priceCop: true,
            images: { take: 1, orderBy: { position: 'asc' } },
          },
        },
        buyer:  { select: { id: true, username: true, avatarUrl: true } },
        seller: { select: { id: true, username: true, avatarUrl: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { body: true, redactedBody: true, flagged: true, createdAt: true, senderId: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return chats.map(c => {
      const lastMsg = c.messages[0];
      const isMe    = lastMsg?.senderId === userId;
      return {
        id:   c.id,
        post: {
          ...c.post,
          priceCop: c.post.priceCop ? Number(c.post.priceCop) : undefined,
        },
        buyer:  c.buyer,
        seller: c.seller,
        lastMessage: lastMsg ? {
          body:      isMe ? lastMsg.body : (lastMsg.flagged ? lastMsg.redactedBody : lastMsg.body),
          flagged:   lastMsg.flagged,
          createdAt: lastMsg.createdAt,
          isMe,
        } : null,
        createdAt: c.createdAt,
      };
    });
  }

  // ── Mensajes paginados de un chat ─────────────────────────
  async getMessages(chatId: string, userId: string, cursor?: string, limit = 30) {
    // Verificar acceso
    const chat = await this.prisma.chat.findFirst({
      where: { id: chatId, OR: [{ buyerId: userId }, { sellerId: userId }] },
    });
    if (!chat) throw new ForbiddenException('Sin acceso a este chat.');

    const messages = await this.prisma.message.findMany({
      where:   { chatId },
      orderBy: { createdAt: 'desc' },
      take:    limit + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      include: { sender: { select: { id: true, username: true, avatarUrl: true } } },
    });

    const hasMore = messages.length > limit;
    if (hasMore) messages.pop();

    return {
      messages: messages.map(m => ({
        id:        m.id,
        chatId:    m.chatId,
        sender:    m.sender,
        // Mostrar cuerpo redactado al receptor si el mensaje fue flaggeado
        body:      m.senderId === userId
          ? m.body
          : (m.flagged ? m.redactedBody : m.body),
        flagged:   m.flagged,
        flagReasons: m.senderId === userId ? m.flagReasons : [],
        isMe:      m.senderId === userId,
        createdAt: m.createdAt,
      })),
      nextCursor: hasMore ? messages[messages.length - 1].id : null,
    };
  }
}
