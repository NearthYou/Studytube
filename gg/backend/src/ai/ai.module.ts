import { Module } from '@nestjs/common'; // NestJS 모듈 설정표를 만들기 위해 가져온다.
import { AiController } from './ai.controller';
import { AiService } from './ai.service'; // FastAPI 호출 작업자를 가져온다.

@Module({
  controllers: [AiController],
  providers: [AiService], // NestJS가 AiService 객체를 만들 수 있게 등록한다.
  exports: [AiService], // 다른 모듈에서도 AiService를 주입받을 수 있게 공개한다.
})
export class AiModule {} // AI 기능을 하나로 묶는 NestJS 모듈이다.
