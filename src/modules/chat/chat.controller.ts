// src/modules/chat/chat.controller.ts — D-una
import {
  Controller, Get, Post, Body, Param, Req, Query,
} from '@nestjs/common';
import { ChatService }     from './chat.service';
import { CreateChatDto }   from './dto/create-chat.dto';

@Controller('chats')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /** GET /v1/chats — lista de chats del usuario con último mensaje */
  @Get()
  myChats(@Req() req: any) {
    return this.chatService.findByUser(req.user.userId);
  }

  /** POST /v1/chats — abrir chat sobre una publicación */
  @Post()
  create(@Body() dto: CreateChatDto, @Req() req: any) {
    return this.chatService.create(dto.postId, req.user.userId);
  }

  /** GET /v1/chats/:id/messages — mensajes paginados */
  @Get(':id/messages')
  messages(
    @Param('id') id: string,
    @Req()       req: any,
    @Query('cursor') cursor?: string,
    @Query('limit')  limit?: string,
  ) {
    return this.chatService.getMessages(
      id,
      req.user.userId,
      cursor,
      limit ? parseInt(limit) : 30,
    );
  }
}
