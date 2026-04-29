import { Module }                  from '@nestjs/common';
import { TransactionsController, WebhooksController } from './transactions.controller';
import { TransactionsService }     from './transactions.service';
import { WompiService }            from './wompi.service';
import { MercadoPagoService }      from './mercadopago.service';
import { AutoReleaseProcessor }    from './auto-release.processor';
import { NotificationsModule }     from '../notifications/notifications.module';

@Module({
  imports:     [NotificationsModule],
  controllers: [TransactionsController, WebhooksController],
  providers:   [TransactionsService, WompiService, MercadoPagoService, AutoReleaseProcessor],
  exports:     [TransactionsService],
})
export class TransactionsModule {}
