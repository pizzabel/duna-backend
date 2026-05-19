import {
  Controller, Get, Patch, Post, Body, Req, Param, UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('v1/users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) { }

  @Get('me')
  getMe(@Req() req: any) {
    return this.usersService.findById(req.user.userId);
  }

  @Patch('me')
  updateMe(@Body() dto: UpdateProfileDto, @Req() req: any) {
    return this.usersService.updateProfile(req.user.userId, dto);
  }

  @Post('push-token')
  savePushToken(@Body() body: { token: string }, @Req() req: any) {
    return this.usersService.savePushToken(req.user.userId, body.token);
  }

  @Get(':id')
  getProfile(@Param('id') id: string) {
    return this.usersService.findPublicProfile(id);
  }
}