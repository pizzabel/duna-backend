import { Controller, Get, Query, Req } from '@nestjs/common';
import { FeedService }   from './feed.service';
import { FeedQueryDto }  from './dto/feed-query.dto';

@Controller('feed')
export class FeedController {
  constructor(private readonly feedService: FeedService) {}

  @Get()
  async getFeed(@Query() query: FeedQueryDto, @Req() req: any) {
    return this.feedService.getFeed(query, req.user.userId);
  }

  @Get('search')
  async search(
    @Query('q')          q:          string,
    @Query('lat')        lat:        string,
    @Query('lng')        lng:        string,
    @Query('radiusKm')   radiusKm:   string,
    @Query('minPrice')   minPrice:   string,
    @Query('maxPrice')   maxPrice:   string,
    @Query('categoryId') categoryId: string,
    @Query('cursor')     cursor:     string,
  ) {
    return this.feedService.search(
      q, parseFloat(lat), parseFloat(lng),
      radiusKm   ? parseFloat(radiusKm)  : 20,
      minPrice   ? parseInt(minPrice)    : undefined,
      maxPrice   ? parseInt(maxPrice)    : undefined,
      categoryId || undefined,
      cursor     ? parseInt(cursor)      : 0,
    );
  }
}
