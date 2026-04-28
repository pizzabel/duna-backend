import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Req, HttpCode, HttpStatus,
} from '@nestjs/common';
import { PostsService }     from './posts.service';
import { CreatePostDto }    from './dto/create-post.dto';
import { UpdatePostDto }    from './dto/update-post.dto';

@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Post()
  create(@Body() dto: CreatePostDto, @Req() req: any) {
    return this.postsService.create(dto, req.user.userId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.postsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePostDto, @Req() req: any) {
    return this.postsService.update(id, dto, req.user.userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @Req() req: any) {
    return this.postsService.remove(id, req.user.userId);
  }

  @Get('user/me')
  myPosts(@Req() req: any) {
    return this.postsService.findByUser(req.user.userId);
  }
}
