import {
  Injectable, NotFoundException, ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';

@Injectable()
export class PostsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePostDto, sellerId: string) {
    // Verificar que el usuario tenga ubicación o que venga en el DTO
    const post = await this.prisma.$executeRaw`
      INSERT INTO posts (id, "sellerId", title, description, "categoryId",
                         "priceCop", condition, location, status)
      VALUES (
        gen_random_uuid(),
        ${sellerId}::uuid,
        ${dto.title},
        ${dto.description},
        ${dto.categoryId}::uuid,
        ${BigInt(dto.priceCop)},
        ${dto.condition}::"PostCondition",
        ST_MakePoint(${dto.lng}, ${dto.lat})::geography,
        'ACTIVE'::"PostStatus"
      )
    `;

    // Obtener el post recién creado
    const created = await this.prisma.$queryRaw<any[]>`
      SELECT id FROM posts
      WHERE "sellerId" = ${sellerId}::uuid
      ORDER BY "createdAt" DESC
      LIMIT 1
    `;

    const postId = created[0].id;

    // Insertar imágenes si vienen
    if (dto.images?.length) {
      for (let i = 0; i < dto.images.length; i++) {
        await this.prisma.postImage.create({
          data: { postId, url: dto.images[i], position: i },
        });
      }
    }

    return this.findOne(postId);
  }

  async findOne(id: string) {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT
        p.id, p.title, p.description, p."priceCop", p.condition,
        p.status, p."viewCount", p."createdAt",
        ST_X(p.location::geometry) AS lng,
        ST_Y(p.location::geometry) AS lat,
        u.id AS "sellerId", u.username, u."fullName",
        u."avatarUrl", u."ratingAvg", u."ratingCount",
        COALESCE(
          (SELECT json_agg(json_build_object('url', pi.url, 'position', pi.position)
                          ORDER BY pi.position)
           FROM post_images pi WHERE pi."postId" = p.id),
          '[]'::json
        ) AS images
      FROM posts p
      JOIN users u ON u.id = p."sellerId"
      WHERE p.id = ${id}::uuid
    `;

    if (!rows.length) throw new NotFoundException('Publicación no encontrada.');

    const r = rows[0];
    return {
      ...r,
      priceCop: Number(r.priceCop),
      seller: {
        id: r.sellerId, username: r.username, fullName: r.fullName,
        avatarUrl: r.avatarUrl, ratingAvg: Number(r.ratingAvg),
        ratingCount: r.ratingCount,
      },
    };
  }

  async update(id: string, dto: UpdatePostDto, userId: string) {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Publicación no encontrada.');
    if (post.sellerId !== userId) throw new ForbiddenException('No puedes editar esta publicación.');
    if (post.status !== 'ACTIVE') throw new BadRequestException('Solo puedes editar publicaciones activas.');

    return this.prisma.post.update({
      where: { id },
      data: {
        ...(dto.title       && { title: dto.title }),
        ...(dto.description && { description: dto.description }),
        ...(dto.priceCop    && { priceCop: BigInt(dto.priceCop) }),
        ...(dto.condition   && { condition: dto.condition as any }),
      },
    });
  }

  async remove(id: string, userId: string) {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Publicación no encontrada.');
    if (post.sellerId !== userId) throw new ForbiddenException('Sin acceso.');
    await this.prisma.post.update({ where: { id }, data: { status: 'REMOVED' } });
  }

async findByUser(userId: string) {
  const posts = await this.prisma.post.findMany({
    where:   { sellerId: userId, status: { not: 'REMOVED' } },
    include: { images: { orderBy: { position: 'asc' } } },
    orderBy: { createdAt: 'desc' },
  });
  return posts.map(p => ({ ...p, priceCop: Number(p.priceCop) }));
  }
}


