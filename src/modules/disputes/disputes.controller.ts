// src/modules/disputes/disputes.controller.ts — D-una
import {
  Controller, Post, Get, Patch, Body, Param, Req, HttpCode, HttpStatus,
} from '@nestjs/common';
import { DisputesService }    from './disputes.service';
import { CreateDisputeDto }   from './dto/create-dispute.dto';
import { AddEvidenceDto }     from './dto/add-evidence.dto';

@Controller('disputes')
export class DisputesController {
  constructor(private readonly disputesService: DisputesService) {}

  /**
   * POST /v1/disputes
   * Abrir disputa sobre una transacción
   */
  @Post()
  create(@Body() dto: CreateDisputeDto, @Req() req: any) {
    return this.disputesService.create(dto, req.user.userId);
  }

  /**
   * GET /v1/disputes/me
   * Mis disputas abiertas y cerradas
   */
  @Get('me')
  myDisputes(@Req() req: any) {
    return this.disputesService.findByUser(req.user.userId);
  }

  /**
   * GET /v1/disputes/:id
   * Detalle de una disputa
   */
  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.disputesService.findOne(id, req.user.userId);
  }

  /**
   * POST /v1/disputes/:id/evidence
   * Subir evidencia (imagen URL o texto)
   */
  @Post(':id/evidence')
  addEvidence(
    @Param('id') id: string,
    @Body() dto: AddEvidenceDto,
    @Req() req: any,
  ) {
    return this.disputesService.addEvidence(id, dto, req.user.userId);
  }
}
