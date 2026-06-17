import { Body, Controller, Post } from '@nestjs/common';
import { AiProxyService } from './ai-proxy.service';

@Controller('ai')
export class AiController {
  constructor(private readonly aiProxyService: AiProxyService) {}

  @Post('rag/recommend')
  recommend(@Body() body: unknown) {
    return this.aiProxyService.recommend(body);
  }

  @Post('mcp/youtube')
  lookupYoutube(@Body() body: unknown) {
    return this.aiProxyService.lookupYoutube(body);
  }

  @Post('youtube/captions')
  captions(@Body() body: unknown) {
    return this.aiProxyService.captions(body);
  }

  @Post('youtube/summary')
  summary(@Body() body: unknown) {
    return this.aiProxyService.summary(body);
  }

  @Post('agent/study-plan')
  plan(@Body() body: unknown) {
    return this.aiProxyService.plan(body);
  }
}
