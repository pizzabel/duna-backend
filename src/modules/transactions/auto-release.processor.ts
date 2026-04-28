// src/modules/transactions/auto-release.processor.ts — D-una
// Job que corre cada 5 minutos buscando transacciones en DELIVERED
// con autoReleaseAt <= NOW() para liberar el pago automáticamente.
// Usa FOR UPDATE SKIP LOCKED para evitar procesamiento doble en multi-instancia.

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService }        from '../../common/prisma/prisma.service';
import { TransactionsService }  from './transactions.service';

@Injectable()
export class AutoReleaseProcessor implements OnModuleInit {
  private readonly logger = new Logger(AutoReleaseProcessor.name);
  private interval: NodeJS.Timeout;

  constructor(
    private readonly prisma:        PrismaService,
    private readonly transactions:  TransactionsService,
  ) {}

  onModuleInit() {
    // Correr cada 5 minutos
    this.interval = setInterval(() => this.run(), 5 * 60 * 1000);
    this.logger.log('Auto-release job iniciado (cada 5 min)');
  }

  async run(): Promise<void> {
    this.logger.debug('Ejecutando auto-release job...');

    // Usar $queryRaw para FOR UPDATE SKIP LOCKED (no soportado por Prisma ORM)
    const due = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM transactions
      WHERE status = 'DELIVERED'
        AND "autoReleaseAt" <= NOW()
      FOR UPDATE SKIP LOCKED
      LIMIT 50
    `;

    if (due.length === 0) return;

    this.logger.log(`Auto-release: procesando ${due.length} transacciones`);

    const results = await Promise.allSettled(
      due.map(tx => this.transactions.autoRelease(tx.id)),
    );

    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length > 0) {
      this.logger.error(
        `Auto-release: ${failed.length} fallos`,
        failed.map(f => (f as PromiseRejectedResult).reason),
      );
    }
  }

  onModuleDestroy() {
    clearInterval(this.interval);
  }
}
