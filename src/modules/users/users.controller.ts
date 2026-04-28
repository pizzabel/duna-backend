import {
  Controller, Get, Patch, Body, Req, Param,
} from '@nestjs/common';
import { UsersService }    from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getMe(@Req() req: any) {
    return this.usersService.findById(req.user.userId);
  }

  @Patch('me')
  updateMe(@Body() dto: UpdateProfileDto, @Req() req: any) {
    return this.usersService.updateProfile(req.user.userId, dto);
  }

  @Get(':id')
  getProfile(@Param('id') id: string) {
    return this.usersService.findPublicProfile(id);
  }
}
