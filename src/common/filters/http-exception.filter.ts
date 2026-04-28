// src/common/filters/http-exception.filter.ts — D-una
// Intercepta todos los errores HTTP y los formatea como { data, error, meta }.

import {
  ExceptionFilter, Catch, ArgumentsHost,
  HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx      = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request  = ctx.getRequest<Request>();

    let status  = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Error interno del servidor';
    let code    = 'INTERNAL_ERROR';

    if (exception instanceof HttpException) {
      status  = exception.getStatus();
      const res = exception.getResponse();
      message = typeof res === 'string'
        ? res
        : (res as any)?.message ?? message;
      code    = (res as any)?.error ?? HttpStatus[status];
    } else {
      this.logger.error('Excepción no controlada', exception);
    }

    response.status(status).json({
      data:  null,
      error: { code, message, statusCode: status },
      meta:  { timestamp: new Date().toISOString(), path: request.url },
    });
  }
}
