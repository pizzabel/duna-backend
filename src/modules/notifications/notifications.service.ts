import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  async send(userId: string, type: string, payload: object): Promise<void> {
    // MVP: log en consola. Reemplazar con Expo Push / OneSignal en Sprint 5.
    this.logger.log(`PUSH → ${userId} | ${type} | ${JSON.stringify(payload)}`);
  }
}
