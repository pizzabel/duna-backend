import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService }    from '../../common/prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true, phone: true, fullName: true, username: true,
        avatarUrl: true, bio: true, neighborhood: true, city: true,
        kycLevel: true, ratingAvg: true, ratingCount: true,
        status: true, createdAt: true,
      },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado.');
    return user;
  }

  async findPublicProfile(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true, fullName: true, username: true,
        avatarUrl: true, bio: true, neighborhood: true, city: true,
        ratingAvg: true, ratingCount: true, createdAt: true,
      },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado.');
    return user;
  }

  async updateProfile(id: string, dto: UpdateProfileDto) {
    const data: any = {};
    if (dto.fullName)     data.fullName     = dto.fullName;
    if (dto.username)     data.username     = dto.username;
    if (dto.bio)          data.bio          = dto.bio;
    if (dto.neighborhood) data.neighborhood = dto.neighborhood;
    if (dto.city)         data.city         = dto.city;

    // Actualizar ubicación PostGIS si vienen coordenadas
    if (dto.lat !== undefined && dto.lng !== undefined) {
      await this.prisma.$executeRaw`
        UPDATE users
        SET location = ST_MakePoint(${dto.lng}, ${dto.lat})::geography,
            "updatedAt" = NOW()
        WHERE id = ${id}::uuid
      `;
    }

    return this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true, fullName: true, username: true,
        avatarUrl: true, bio: true, neighborhood: true, city: true,
      },
    });
  }
}
