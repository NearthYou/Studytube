import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthPublicUser } from './auth.types';
import { AuthCookiePolicy } from './auth-cookie';
import { IS_PUBLIC_ROUTE } from './public.decorator';
import { AuthService } from './auth.service';

export type SessionPrincipal = Readonly<{
  sessionId: string;
  userId: number;
  user: Readonly<AuthPublicUser>;
}>;

export type AuthenticatedRequest = Request & {
  principal: SessionPrincipal;
};

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
    private readonly cookies: AuthCookiePolicy,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_ROUTE,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic && !isAlwaysAuthenticatedPath(request.path)) {
      return true;
    }

    const sessionToken = this.cookies.readSessionCookie(request.headers.cookie);
    if (!sessionToken) {
      throw new UnauthorizedException('Authentication required');
    }

    const result = await this.authService.authenticateSession(sessionToken);
    if (result.status !== 'authenticated') {
      throw new UnauthorizedException('Authentication required');
    }

    const user = Object.freeze({ ...result.user });
    request.principal = Object.freeze({ ...result.principal, user });
    return true;
  }
}

function isAlwaysAuthenticatedPath(path: string | undefined): boolean {
  return /^(?:\/ai|\/learning|\/courses)(?:\/|$)/u.test(path ?? '');
}
