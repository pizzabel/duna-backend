import { IsUUID, IsString, IsIn, IsEmail } from 'class-validator';

export class CreateTransactionDto {
  @IsUUID()
  postId: string;

  @IsString()
  @IsIn(['card', 'pse', 'nequi', 'daviplata'])
  paymentMethod: string;

  @IsEmail()
  buyerEmail: string;
}
