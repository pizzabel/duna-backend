// src/modules/chat/chat.gateway.ts — D-una
// WebSocket gateway para mensajería en tiempo real.
// CADA mensaje pasa por el pipeline antifraude antes de persistirse.

import {
  WebSocketGateway, WebSocketServer, SubscribeMessage,
  MessageBody, ConnectedSocket, OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger }              from '@nestjs/common';
import { Server, Socket }      from 'socket.io';
import { JwtService }          from '@nestjs/jwt';
import { ConfigService }       from '@nestjs/config';
import { PrismaService }       from '../../common/prisma/prisma.service';
import { AntifraudService }    from '../antifraud/antifraud.service';
import { SendMessageDto }      from './dto/send-message.dto';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/',
  transports: ['websocket', 'polling'],
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(ChatGateway.name);

  // Mapa de userId → socketId para enrutar mensajes
  private userSockets = new Map<string, string>();

  constructor(
    private readonly prisma:    PrismaService,
    private readonly jwt:       JwtService,
    private readonly config:    ConfigService,
    private readonly antifraud: AntifraudService,
  ) {}

  // ── Conexión: autenticar via JWT en handshake ─────────────
  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = this.extractToken(client);

      // Verificar JWT manualmente con el secret
      const secret = this.config.getOrThrow('JWT_SECRET');
      let payload: { sub: string };

      try {
        payload = this.jwt.verify(token, { secret }) as { sub: string };
      } catch (jwtErr) {
        // Intentar decodificar sin verificar para dar mejor error
        try {
          const decoded = this.jwt.decode(token) as any;
          if (decoded?.exp && decoded.exp * 1000 < Date.now()) {
            client.emit('error', { message: 'Token expirado. Solicita un nuevo OTP.' });
          } else {
            client.emit('error', { message: 'Token inválido.' });
          }
        } catch {
          client.emit('error', { message: 'Token inválido.' });
        }
        client.disconnect();
        return;
      }

      // Guardar userId en el socket
      (client as any).userId = payload.sub;
      client.join(`user:${payload.sub}`);
      this.userSockets.set(payload.sub, client.id);

      this.logger.log(`✓ Conectado: ${payload.sub} (socket: ${client.id})`);
      client.emit('connected', { userId: payload.sub, socketId: client.id });

    } catch (err) {
      this.logger.warn(`✗ Conexión rechazada: ${err.message}`);
      client.emit('error', { message: 'Error de autenticación.' });
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket): void {
    const userId = (client as any).userId;
    if (userId) {
      this.userSockets.delete(userId);
      this.logger.log(`✗ Desconectado: ${userId}`);
    }
  }

  // ── Enviar mensaje ────────────────────────────────────────
  @SubscribeMessage('chat:send')
  async handleSend(
    @ConnectedSocket() client: Socket,
    @MessageBody()    dto:    SendMessageDto,
  ) {
    const senderId = (client as any).userId;
    if (!senderId) {
      client.emit('error', { message: 'No autenticado.' });
      return;
    }

    // Verificar que el remitente pertenece al chat
    const chat = await this.prisma.chat.findFirst({
      where: {
        id: dto.chatId,
        OR: [{ buyerId: senderId }, { sellerId: senderId }],
      },
    });
    if (!chat) {
      client.emit('error', { message: 'Chat no encontrado.' });
      return;
    }

    // ── PIPELINE ANTIFRAUDE ──────────────────────────────────
    const scan = this.antifraud.scan(dto.body);

    // Persistir mensaje (body original para auditoría)
    const message = await this.prisma.message.create({
      data: {
        chatId:      dto.chatId,
        senderId,
        body:        dto.body,
        flagged:     scan.flagged,
        flagReasons: scan.flags,
        redactedBody: scan.flagged ? scan.redactedBody : null,
      },
      include: {
        sender: { select: { id: true, username: true, avatarUrl: true } },
      },
    });

    // Actualizar risk_score si hubo flags
    if (scan.flagged) {
      const newScore = await this.antifraud.applyRiskDelta(senderId, scan.riskDelta);
      this.logger.warn(
        `⚠ Flags: [${scan.flags.join(', ')}] · body: "${dto.body}" · score: ${newScore}`,
      );
    }

    // Determinar el recipiente
    const recipientId = chat.buyerId === senderId ? chat.sellerId : chat.buyerId;

    // Payload para el EMISOR (ve su mensaje original)
    const senderPayload = {
      id:          message.id,
      chatId:      dto.chatId,
      body:        message.body,
      flagged:     message.flagged,
      flagReasons: message.flagReasons,
      sender:      message.sender,
      isMe:        true,
      createdAt:   message.createdAt,
    };

    // Payload para el RECEPTOR (ve versión redactada si fue flaggeado)
    const recipientPayload = {
      ...senderPayload,
      body:        scan.flagged ? scan.redactedBody : message.body,
      flagReasons: [],
      isMe:        false,
    };

    // Emitir al emisor
    client.emit('chat:message', senderPayload);

    // Emitir al receptor (si está conectado)
    this.server.to(`user:${recipientId}`).emit('chat:message', recipientPayload);

    this.logger.log(`💬 Mensaje: ${senderId} → chat ${dto.chatId}${scan.flagged ? ' [FLAGGED]' : ''}`);

    return { ok: true, messageId: message.id };
  }

  // ── Indicador de escritura ────────────────────────────────
  @SubscribeMessage('chat:typing')
  async handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody()    data:   { chatId: string; isTyping: boolean },
  ) {
    const senderId = (client as any).userId;
    if (!senderId) return;

    const chat = await this.prisma.chat.findFirst({
      where: { id: data.chatId, OR: [{ buyerId: senderId }, { sellerId: senderId }] },
    });
    if (!chat) return;

    const recipientId = chat.buyerId === senderId ? chat.sellerId : chat.buyerId;
    this.server.to(`user:${recipientId}`).emit('chat:typing', {
      chatId:   data.chatId,
      userId:   senderId,
      isTyping: data.isTyping,
    });
  }

  // ── Marcar mensajes como leídos ───────────────────────────
  @SubscribeMessage('chat:read')
  async handleRead(
    @ConnectedSocket() client: Socket,
    @MessageBody()    data:   { chatId: string },
  ) {
    const userId = (client as any).userId;
    if (!userId) return;

    const chat = await this.prisma.chat.findFirst({
      where: { id: data.chatId, OR: [{ buyerId: userId }, { sellerId: userId }] },
    });
    if (!chat) return;

    const otherId = chat.buyerId === userId ? chat.sellerId : chat.buyerId;
    this.server.to(`user:${otherId}`).emit('chat:read', {
      chatId: data.chatId,
      userId,
    });
  }

  // ── Helper ────────────────────────────────────────────────
  private extractToken(client: Socket): string {
    const auth =
      client.handshake?.auth?.token as string ||
      (client.handshake?.headers?.authorization as string)?.replace('Bearer ', '');
    if (!auth) throw new Error('Token no proporcionado.');
    return auth;
  }
}
