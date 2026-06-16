import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthenticatedRequest } from '../../common/types/authenticated-request';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';

interface AccessTokenPayload {
  sub?: unknown;
  email?: unknown;
  nickname?: unknown;
  profileImageUrl?: unknown;
  purpose?: unknown;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractBearerToken(request);

    if (!token) {
      throw new UnauthorizedException('로그인이 필요합니다.');
    }

    request.user = await this.verifyAccessToken(token);

    return true;
  }

  protected extractBearerToken(request: AuthenticatedRequest): string | null {
    const authorization = request.headers.authorization;

    if (!authorization) {
      return null;
    }

    const [type, token] = authorization.split(' ');

    if (type !== 'Bearer' || !token) {
      return null;
    }

    return token;
  }

  protected async verifyAccessToken(token: string): Promise<AuthenticatedUser> {
    try {
      const payload =
        await this.jwtService.verifyAsync<AccessTokenPayload>(token);

      if (
        payload.purpose ||
        typeof payload.sub !== 'string' ||
        typeof payload.email !== 'string' ||
        typeof payload.nickname !== 'string'
      ) {
        throw new UnauthorizedException('유효하지 않은 로그인 토큰입니다.');
      }

      return {
        id: payload.sub,
        email: payload.email,
        nickname: payload.nickname,
        profileImageUrl:
          typeof payload.profileImageUrl === 'string'
            ? payload.profileImageUrl
            : null,
      };
    } catch {
      throw new UnauthorizedException('유효하지 않은 로그인 토큰입니다.');
    }
  }
}
