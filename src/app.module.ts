// src/app.module.ts — D-una raíz de la aplicación

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';

import { PrismaModule }        from './common/prisma/prisma.module';
import { RedisModule }         from './common/redis/redis.module';
import { AuthModule }          from './modules/auth/auth.module';
import { UsersModule }         from './modules/users/users.module';
import { PostsModule }         from './modules/posts/posts.module';
import { FeedModule }          from './modules/feed/feed.module';
import { ChatModule }          from './modules/chat/chat.module';
import { TransactionsModule }  from './modules/transactions/transactions.module';
import { DisputesModule }      from './modules/disputes/disputes.module';
import { AntifraudModule }     from './modules/antifraud/antifraud.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ReviewsModule }       from './modules/reviews/reviews.module';

import { JwtAuthGuard }              from './common/guards/jwt-auth.guard';
import { ThrottlerBehindProxyGuard } from './common/guards/throttler-proxy.guard';
import { HttpExceptionFilter }       from './common/filters/http-exception.filter';
import { ResponseInterceptor }       from './common/interceptors/response.interceptor';
import { LoggingInterceptor }        from './common/interceptors/logging.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => [
        { ttl: 60_000, limit: parseInt(cfg.get('RATE_LIMIT_MAX', '300')) },
      ],
    }),
    PrismaModule,
    RedisModule,
    AuthModule,
    UsersModule,
    PostsModule,
    FeedModule,
    ChatModule,
    TransactionsModule,
    DisputesModule,
    AntifraudModule,
    NotificationsModule,
    ReviewsModule,
  ],
  providers: [
    { provide: APP_GUARD,       useClass: JwtAuthGuard },
    { provide: APP_GUARD,       useClass: ThrottlerBehindProxyGuard },
    { provide: APP_FILTER,      useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule {}
