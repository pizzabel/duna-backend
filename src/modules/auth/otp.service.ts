import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class OtpService {
  private readonly logger = new Logger('OTP');

  generate(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  async send(phone: string, code: string): Promise<void> {
    this.logger.log('OTP para ' + phone + ': ' + code);
  }
}
