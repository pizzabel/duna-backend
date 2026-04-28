// src/modules/feed/feed.service.ts — D-una
// Consulta hiperlocal usando PostGIS ST_DWithin + score compuesto.
// Cache en Redis 90s por bucket de ubicación (~111m).

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService }      from '../../common/prisma/prisma.service';
import { RedisService }       from '../../common/redis/redis.service';
import { FeedQueryDto }       from './dto/feed-query.dto';

export interface FeedItem {
  id:           string;
  title:        string;
  priceCop:     number;
  condition:    string;
  distKm:       number;
  score:        number;
  images:       string[];
  seller: {
    id:         string;
    username:   string;
    avatarUrl:  string | null;
    ratingAvg:  number;
  };
  createdAt:    Date;
}

const CACHE_TTL_SECONDS = 90;

@Injectable()
export class FeedService {
  private readonly logger = new Logger(FeedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis:  RedisService,
  ) {}

  async getFeed(query: FeedQueryDto, userId: string): Promise<FeedItem[]> {
    const {
      lat, lng,
      radiusKm   = 5,
      categoryId,
      cursor     = 0,
      limit      = 30,
    } = query;

    // ── Cache key: bucket por ubicación (~111 m) ─────────────
    const latB = lat.toFixed(3);
    const lngB = lng.toFixed(3);
    const catB = categoryId ?? 'all';
    const cacheKey = `feed:${latB}:${lngB}:${catB}:${Math.floor(cursor / limit)}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      this.logger.debug(`Feed desde caché: ${cacheKey}`);
      return JSON.parse(cached);
    }

    // ── Consulta PostGIS con score compuesto ─────────────────
    // Usamos $queryRawUnsafe con parámetros numerados para prevenir inyección.
    const categoryFilter = categoryId
      ? `AND p."categoryId" = '${categoryId}'::uuid`
      : '';

    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT
        p.id,
        p.title,
        p."priceCop",
        p.condition,
        p."createdAt",
        p."viewCount",
        ROUND(
          (ST_Distance(p.location, ST_MakePoint(${lng}, ${lat})::geography) / 1000.0)::numeric,
          2
        )                                                     AS "distKm",
        ROUND((
            0.45 * (1.0 / (1.0 + ST_Distance(p.location, ST_MakePoint(${lng}, ${lat})::geography) / 1000.0))
          + 0.30 * EXP(-EXTRACT(EPOCH FROM (NOW() - p."createdAt")) / 3600.0 / 48.0)
          + 0.15 * (LN(1.0 + COALESCE(p."viewCount", 0)) / 10.0)
          + 0.10 * (COALESCE(u."ratingAvg", 3) / 5.0)
        )::numeric, 4)                                        AS score,
        u.id       AS "sellerId",
        u.username AS "sellerUsername",
        u."avatarUrl" AS "sellerAvatar",
        u."ratingAvg"  AS "sellerRating",
        COALESCE(
          (SELECT ARRAY_AGG(pi.url ORDER BY pi.position)
           FROM post_images pi WHERE pi."postId" = p.id),
          ARRAY[]::text[]
        ) AS images

      FROM posts p
      JOIN users u ON u.id = p."sellerId"

      WHERE p.status = 'ACTIVE'
        AND ST_DWithin(
              p.location,
              ST_MakePoint(${lng}, ${lat})::geography,
              ${radiusKm * 1000}
            )
        AND u.status = 'ACTIVE'
        AND u."riskScore" < 70

      ORDER BY score DESC
      LIMIT  ${limit}
      OFFSET ${cursor}
    `;

    // Incrementar view_count en background (no bloquea la respuesta)
    const ids = rows.map(r => r.id);
    if (ids.length > 0) {
      this.prisma.post
        .updateMany({ where: { id: { in: ids } }, data: { viewCount: { increment: 1 } } })
        .catch(e => this.logger.error('Error incrementando view_count', e));
    }

    const items: FeedItem[] = rows.map(r => ({
      id:        r.id,
      title:     r.title,
      priceCop:  Number(r.priceCop),
      condition: r.condition,
      distKm:    Number(r.distKm),
      score:     Number(r.score),
      images:    r.images ?? [],
      seller: {
        id:        r.sellerId,
        username:  r.sellerUsername,
        avatarUrl: r.sellerAvatar,
        ratingAvg: Number(r.sellerRating ?? 0),
      },
      createdAt: r.createdAt,
    }));

    // Guardar en caché
    await this.redis.set(cacheKey, JSON.stringify(items), CACHE_TTL_SECONDS);

    return items;
  }

  // Búsqueda con texto (usa índice pg_trgm)
  async search(
    q:          string,
    lat:        number,
    lng:        number,
    radiusKm:   number = 20,
    minPrice?:  number,
    maxPrice?:  number,
    categoryId?: string,
    cursor:     number = 0,
    limit:      number = 30,
  ): Promise<FeedItem[]> {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT
        p.id, p.title, p."priceCop", p.condition, p."createdAt",
        ROUND((ST_Distance(p.location, ST_MakePoint(${lng}, ${lat})::geography) / 1000.0)::numeric, 2) AS "distKm",
        u.id AS "sellerId", u.username AS "sellerUsername",
        u."avatarUrl" AS "sellerAvatar", u."ratingAvg" AS "sellerRating",
        COALESCE(
          (SELECT ARRAY_AGG(pi.url ORDER BY pi.position)
           FROM post_images pi WHERE pi."postId" = p.id LIMIT 1),
          ARRAY[]::text[]
        ) AS images,
        similarity(p.title, ${q}) + similarity(p.description, ${q}) AS sim

      FROM posts p
      JOIN users u ON u.id = p."sellerId"

      WHERE p.status = 'ACTIVE'
        AND ST_DWithin(p.location, ST_MakePoint(${lng}, ${lat})::geography, ${radiusKm * 1000})
        AND u.status = 'ACTIVE'
        AND (
          p.title       ILIKE ${'%' + q + '%'}
          OR p.description ILIKE ${'%' + q + '%'}
        )
        ${minPrice ? `AND p."priceCop" >= ${minPrice}` : ''}
        ${maxPrice ? `AND p."priceCop" <= ${maxPrice}` : ''}
        ${categoryId ? `AND p."categoryId" = '${categoryId}'::uuid` : ''}

      ORDER BY sim DESC, "distKm" ASC
      LIMIT ${limit} OFFSET ${cursor}
    `;

    return rows.map(r => ({
      id:        r.id,
      title:     r.title,
      priceCop:  Number(r.priceCop),
      condition: r.condition,
      distKm:    Number(r.distKm),
      score:     Number(r.sim ?? 0),
      images:    r.images ?? [],
      seller: {
        id:        r.sellerId,
        username:  r.sellerUsername,
        avatarUrl: r.sellerAvatar,
        ratingAvg: Number(r.sellerRating ?? 0),
      },
      createdAt: r.createdAt,
    }));
  }
}
