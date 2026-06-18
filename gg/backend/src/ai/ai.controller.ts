import { Controller, Get } from '@nestjs/common';
import { AiService } from './ai.service';

@Controller('ai') // /ai로 시작하는 AI 연결 확인 API를 담당한다.
export class AiController {
  constructor(private readonly aiService: AiService) {} // FastAPI 호출 작업자인 AiService를 받아온다.

  @Get('health') // GET /ai/health 요청이 오면 FastAPI 내부 health check를 실행한다.
  checkHealth() {
    return this.aiService.checkHealth(); // NestJS가 FastAPI /internal/health를 호출한 결과를 그대로 돌려준다.
  }
}
