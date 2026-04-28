// src/modules/reviews/reviews.controller.ts — D-una
import { Controller, Post, Get, Body, Param, Req } from '@nestjs/common';
import { ReviewsService }  from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  /**
   * POST /v1/reviews
   * Calificar al otro usuario tras una transacción RELEASED
   */
  @Post()
  create(@Body() dto: CreateReviewDto, @Req() req: any) {
    return this.reviewsService.create(dto, req.user.userId);
  }

  /**
   * GET /v1/reviews/user/:id
   * Ver calificaciones de un usuario
   */
  @Get('user/:id')
  findByUser(@Param('id') id: string) {
    return this.reviewsService.findByUser(id);
  }
}
