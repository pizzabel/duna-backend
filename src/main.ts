// src/main.ts — Bootstrap de D-una

import { NestFactory }            from '@nestjs/core';
import { ValidationPipe }         from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet                     from 'helmet';
import { join }                   from 'path';
import { AppModule }              from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  // ── Seguridad HTTP ─────────────────────────────────────────
  app.use(helmet({
    contentSecurityPolicy: false, // desactivado para el cliente de prueba
    hsts: { maxAge: 31_536_000, includeSubDomains: true },
  }));

  app.set('trust proxy', 1);

  app.enableCors({ origin: '*', credentials: true });

  // ── Archivos estáticos (cliente de prueba del chat) ────────
  app.useStaticAssets(join(__dirname, '..', 'public'));

  // ── Prefijo global de versión ──────────────────────────────
  app.setGlobalPrefix('v1', {
    exclude: ['/'],  // excluir la raíz para archivos estáticos
  });

  // ── Validación global de DTOs ──────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ── Arranque ───────────────────────────────────────────────
  const port = parseInt(process.env.PORT ?? '3000');
  await app.listen(port);
  console.log(`🚀 D-una API corriendo en http://localhost:${port}/v1`);
  console.log(`💬 Chat test client en http://localhost:${port}/chat-test.html`);
}

bootstrap();
