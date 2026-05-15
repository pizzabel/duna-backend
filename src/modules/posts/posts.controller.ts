import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Req, HttpCode, HttpStatus, Query,
} from '@nestjs/common';
import { PostsService } from './posts.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) { }

  @Get('upload-url')
  async getUploadUrl(@Query('ext') ext = 'jpg') {
    const s3 = new S3Client({
      region: process.env.AWS_REGION,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    } as any);
    const key = `posts/${randomUUID()}.${ext}`;
    const command = new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      ContentType: 'image/jpeg',
    });
    const url = await getSignedUrl(s3, command, { expiresIn: 300 });
    const publicUrl = `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
    return { url, publicUrl, key };
  }

  @Post()
  create(@Body() dto: CreatePostDto, @Req() req: any) {
    return this.postsService.create(dto, req.user.userId);
  }

  @Get('user/me')
  myPosts(@Req() req: any) {
    return this.postsService.findByUser(req.user.userId);
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
}