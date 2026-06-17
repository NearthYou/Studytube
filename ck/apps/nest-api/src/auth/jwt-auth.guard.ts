import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
// 라우트가 JWT 인증이 필요하다는 것을 선언하는 Guard 파일
export class JwtAuthGuard extends AuthGuard('jwt') {}

// 실제 JWT 검증 규칙을 JwtStrategy에 있음
// Guard는 해당 전략을 사용해서 막으라는 연결 역할
