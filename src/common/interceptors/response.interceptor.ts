// src/common/interceptors/response.interceptor.ts — D-una
// Envuelve TODAS las respuestas exitosas en { data, meta }.

import {
  Injectable, NestInterceptor, ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map }        from 'rxjs/operators';

export interface ApiResponse<T> {
  data:  T;
  meta:  { timestamp: string; version: string };
  error: null;
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map(data => ({
        data:  data ?? null,
        meta:  { timestamp: new Date().toISOString(), version: '1' },
        error: null,
      })),
    );
  }
}
