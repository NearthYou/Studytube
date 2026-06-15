import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthUser } from '../../common/types/auth-user.type';
import { JwtStrategy } from '../strategies/jwt.strategy';

type RequestWithUser = {
  headers: {
    authorization?: string | string[];
  };
  user?: AuthUser;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtStrategy: JwtStrategy) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = this.extractBearerToken(request);

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
}
