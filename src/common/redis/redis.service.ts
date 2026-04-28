// src/common/redis/redis.service.ts — D-una
import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;
  private readonly logger = new Logger(RedisService.name);

  constructor(config: ConfigService) {
    this.client = new Redis(config.getOrThrow('REDIS_URL'), {
      lazyConnect:        true,
      maxRetriesPerRequest: 3,
    });
    this.client.on('error', err => this.logger.error('Redis error', err));
    this.client.connect().catch(e => this.logger.error('Redis conexión fallida', e));
  }

  async get(key: string): Promise<string | null>  { return this.client.get(key); }
  async set(key: string, value: string, ttl?: number): Promise<void> {
    if (ttl) await this.client.setex(key, ttl, value);
    else     await this.client.set(key, value);
  }
  async del(key: string): Promise<void>   { await this.client.del(key); }
  async incr(key: string): Promise<number> { return this.client.incr(key); }
  async expire(key: string, seconds: number): Promise<void> {
    await this.client.expire(key, seconds);
  }

  onModuleDestroy() { this.client.quit(); }
}
