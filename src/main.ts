// src/main.ts â€” Bootstrap de D-una

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

  // â”€â”€ Seguridad HTTP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  app.use(helmet({
    contentSecurityPolicy: false, // desactivado para el cliente de prueba
    hsts: { maxAge: 31_536_000, includeSubDomains: true },
  }));

  app.set('trust proxy', 1);

  app.enableCors({ origin: '*', credentials: true });

  // â”€â”€ Archivos estÃ¡ticos (cliente de prueba del chat) â”€â”€â”€â”€â”€â”€â”€â”€
  app.useStaticAssets(join(__dirname, '..', 'public'));

  // â”€â”€ Prefijo global de versiÃ³n â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  app.setGlobalPrefix('v1', {
    exclude: ['/'],  // excluir la raÃ­z para archivos estÃ¡ticos
  });

  // â”€â”€ ValidaciÃ³n global de DTOs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // â”€â”€ Arranque â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const port = parseInt(process.env.PORT ?? '3000');
  await app.listen(port, '0.0.0.0');
  console.log(`ðŸš€ D-una API corriendo en http://localhost:${port}/v1`);
  console.log(`ðŸ’¬ Chat test client en http://localhost:${port}/chat-test.html`);
}

bootstrap();
