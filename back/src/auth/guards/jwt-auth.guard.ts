import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthUser } from '../../common/types/auth-user.type';
import { AUTH_COOKIE_NAME } from '../../config/security.config';
import { JwtStrategy } from '../strategies/jwt.strategy';

type RequestWithUser = {
  headers: {
    authorization?: string | string[];
    cookie?: string | string[];
  };
  user?: AuthUser;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtStrategy: JwtStrategy) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token =
      this.extractBearerToken(request) ?? this.extractCookieToken(request);

    if (!token) {
      throw new UnauthorizedException('인증 토큰이 필요합니다.');
    }

    request.user = await this.jwtStrategy.validateAccessToken(token);
    return true;
  }

  private extractBearerToken(request: RequestWithUser) {
    const authorization = request.headers.authorization;

    if (!authorization || Array.isArray(authorization)) {
      return null;
    }

    const [scheme, token] = authorization.split(' ');

    if (scheme !== 'Bearer' || !token) {
      return null;
    }

    return token;
  }

  private extractCookieToken(request: RequestWithUser) {
    const cookie = request.headers.cookie;

    if (!cookie || Array.isArray(cookie)) {
      return null;
    }

    const tokenPair = cookie
      .split(';')
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith(`${AUTH_COOKIE_NAME}=`));

    if (!tokenPair) {
      return null;
    }

    const [, value] = tokenPair.split('=');
    return value ? decodeURIComponent(value) : null;
  }
}
