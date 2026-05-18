// src/modules/feed/feed.service.ts — D-una
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { FeedQueryDto } from './dto/feed-query.dto';

export interface FeedItem {
  id: string;
  title: string;
  priceCop: number;
  condition: string;
  distKm: number;
  score: number;
  images: string[];
  seller: {
    id: string;
    username: string;
    avatarUrl: string | null;
    ratingAvg: number;
  };
  createdAt: Date;
}

const CACHE_TTL_SECONDS = 90;

@Injectable()
export class FeedService {
  private readonly logger = new Logger(FeedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) { }

  async getFeed(query: FeedQueryDto, userId: string): Promise<FeedItem[]> {
    const {
      lat, lng,
      radiusKm = 5,
      categoryId,
      cursor = 0,
      limit = 30,
    } = query;

    const latB = lat.toFixed(3);
    const lngB = lng.toFixed(3);
    const catB = categoryId ?? 'all';
    const cacheKey = `feed:${latB}:${lngB}:${catB}:${Math.floor(cursor / limit)}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      this.logger.debug(`Feed desde caché: ${cacheKey}`);
      return JSON.parse(cached);
    }

    const categoryFilter = categoryId
      ? `AND p."categoryId" = '${categoryId}'::uuid`
      : '';

    const radiusMeters = radiusKm * 1000;

    const rows = await this.prisma.$queryRawUnsafe<any[]>(`
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
        ) AS "distKm",
        ROUND((
            0.45 * (1.0 / (1.0 + ST_Distance(p.location, ST_MakePoint(${lng}, ${lat})::geography) / 1000.0))
          + 0.30 * EXP(-EXTRACT(EPOCH FROM (NOW() - p."createdAt")) / 3600.0 / 48.0)
          + 0.15 * (LN(1.0 + COALESCE(p."viewCount", 0)) / 10.0)
          + 0.10 * (COALESCE(u."ratingAvg", 3) / 5.0)
        )::numeric, 4) AS score,
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
              ${radiusMeters}
            )
        AND u.status = 'ACTIVE'
        AND u."riskScore" < 70
        ${categoryFilter}
      ORDER BY score DESC
      LIMIT  ${limit}
      OFFSET ${cursor}
    `);

    const ids = rows.map(r => r.id);
    if (ids.length > 0) {
      this.prisma.post
        .updateMany({ where: { id: { in: ids } }, data: { viewCount: { increment: 1 } } })
        .catch(e => this.logger.error('Error incrementando view_count', e));
    }

    const items: FeedItem[] = rows.map(r => ({
      id: r.id,
      title: r.title,
      priceCop: Number(r.priceCop),
      condition: r.condition,
      distKm: Number(r.distKm),
      score: Number(r.score),
      images: r.images ?? [],
      seller: {
        id: r.sellerId,
        username: r.sellerUsername,
        avatarUrl: r.sellerAvatar,
        ratingAvg: Number(r.sellerRating ?? 0),
      },
      createdAt: r.createdAt,
    }));

    await this.redis.set(cacheKey, JSON.stringify(items), CACHE_TTL_SECONDS);

    return items;
  }

  async search(
    q: string,
    lat: number,
    lng: number,
    radiusKm: number = 20,
    minPrice?: number,
    maxPrice?: number,
    categoryId?: string,
    cursor: number = 0,
    limit: number = 30,
  ): Promise<FeedItem[]> {
    const radiusMeters = radiusKm * 1000;
    const priceMinFilter = minPrice ? `AND p."priceCop" >= ${minPrice}` : '';
    const priceMaxFilter = maxPrice ? `AND p."priceCop" <= ${maxPrice}` : '';
    const categoryFilter = categoryId ? `AND p."categoryId" = '${categoryId}'::uuid` : '';
    const qEscaped = q.replace(/'/g, "''");

    const rows = await this.prisma.$queryRawUnsafe<any[]>(`
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
        similarity(p.title, '${qEscaped}') + similarity(p.description, '${qEscaped}') AS sim
      FROM posts p
      JOIN users u ON u.id = p."sellerId"
      WHERE p.status = 'ACTIVE'
        AND ST_DWithin(p.location, ST_MakePoint(${lng}, ${lat})::geography, ${radiusMeters})
        AND u.status = 'ACTIVE'
        AND (
          p.title       ILIKE '%${qEscaped}%'
          OR p.description ILIKE '%${qEscaped}%'
        )
        ${priceMinFilter}
        ${priceMaxFilter}
        ${categoryFilter}
      ORDER BY sim DESC, "distKm" ASC
      LIMIT ${limit} OFFSET ${cursor}
    `);

    return rows.map(r => ({
      id: r.id,
      title: r.title,
      priceCop: Number(r.priceCop),
      condition: r.condition,
      distKm: Number(r.distKm),
      score: Number(r.sim ?? 0),
      images: r.images ?? [],
      seller: {
        id: r.sellerId,
        username: r.sellerUsername,
        avatarUrl: r.sellerAvatar,
        ratingAvg: Number(r.sellerRating ?? 0),
      },
      createdAt: r.createdAt,
    }));
  }
}