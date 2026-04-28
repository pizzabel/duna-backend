// src/modules/disputes/dto/add-evidence.dto.ts
import { IsString, IsIn, MinLength } from 'class-validator';

export class AddEvidenceDto {
  @IsString()
  @IsIn(['image', 'text', 'chat_ref'])
  type: string;

  @IsString()
  @MinLength(1)
  content: string;  // URL de imagen o texto descriptivo
}
