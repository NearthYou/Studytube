import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';

// 이미 존재하는 `request.user`를 사람이 읽기 좋은 형태로 꺼내 쓰게 도와주는 도구
export const CurrentUser = createParamDecorator(
  // `ctx: ExecutionContext`: 현재 들어온 요청 문맥 전체
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx
      .switchToHttp() // HTTP 요청 객체 변환
      // 실제 Express의 `request` 객체 꺼냄
      // 요청 객체에 `user`도 들어있다고 알려줌
      .getRequest<Request & { user: AuthenticatedUser }>();

    return request.user; // JwtStrategy가 미리 넣어둔 `request.user`를 그대로 꺼내서 컨트롤러 파라미터로 넘김
  },
);
