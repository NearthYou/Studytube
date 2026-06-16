// Guard를 만들 때 필요한 NestJS 기본 도구들을 가져온다.
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt'; // token이 우리 서버에서 만든 정상 token인지 확인할 때 사용한다.
import { Request } from 'express'; // 지금 들어온 HTTP 요청의 타입을 표현할 때 사용한다.
import { PrismaService } from '../prisma/prisma.service'; // token에서 꺼낸 userId로 실제 사용자를 DB에서 찾을 때 사용한다.

// 기본 Request에 Guard가 붙여줄 user 정보를 추가한 요청 타입이다.
type AuthenticatedRequest = Request & {
  user?: {
    id: number;
    email: string;
    nickname: string;
  };
};

// JWT token 안에 들어있다고 기대하는 사용자 정보의 모양이다.
type JwtPayload = {
  sub: number;
  email: string;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>(); // 현재 들어온 HTTP 요청 객체를 꺼낸다.
    const token = this.extractTokenFromHeader(request); // 요청 header에서 JWT token만 분리해서 꺼낸다.

    if (!token) {
      throw new UnauthorizedException('로그인이 필요합니다.'); // token이 없으면 로그인하지 않은 요청이므로 막는다.
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token); // token이 유효한지 확인하고 token 안의 사용자 정보를 꺼낸다.

      // token 안의 userId로 DB에서 실제 사용자를 찾고, 필요한 정보만 가져온다.
      const user = await this.prisma.user.findUnique({
        where: {
          id: payload.sub,
        },
        select: {
          id: true,
          email: true,
          nickname: true,
        },
      });

      if (!user) {
        throw new UnauthorizedException('사용자를 찾을 수 없습니다.'); // token은 있지만 DB에 사용자가 없으면 요청을 막는다.
      }

      request.user = user; // 뒤에서 Controller가 로그인한 사용자를 알 수 있도록 요청 객체에 붙인다.

      return true; // Guard 검사를 통과했으므로 Controller 실행을 허용한다.
    } catch {
      throw new UnauthorizedException('유효하지 않은 토큰입니다.'); // token 검증 중 문제가 생기면 잘못된 token으로 보고 막는다.
    }
  }

  private extractTokenFromHeader(request: Request) {
    const [type, token] = request.headers.authorization?.split(' ') ?? []; // Authorization 값을 "Bearer"와 token 부분으로 나눈다.

    return type === 'Bearer' ? token : undefined; // Bearer 형식이면 token을 반환하고, 아니면 token이 없는 것으로 처리한다.
  }
}
