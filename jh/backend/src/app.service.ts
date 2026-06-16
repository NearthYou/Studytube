import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }

  getHealth() {
    return {
      message: 'Tail Talk API가 정상 동작 중입니다.',
      service: 'tail-talk-api',
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
