import { IsString, IsUUID, MinLength, MaxLength } from 'class-validator';

export class SendMessageDto {
  @IsUUID()
  chatId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body: string;
}
