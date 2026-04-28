// src/modules/disputes/dto/create-dispute.dto.ts
import { IsUUID, IsString, IsIn, MinLength } from 'class-validator';

export class CreateDisputeDto {
  @IsUUID()
  transactionId: string;

  @IsString()
  @IsIn(['NOT_DELIVERED', 'DIFFERENT_ITEM', 'DAMAGED', 'COUNTERFEIT', 'OTHER'])
  reason: string;

  @IsString()
  @MinLength(20, { message: 'Describe el problema con al menos 20 caracteres.' })
  description: string;
}
