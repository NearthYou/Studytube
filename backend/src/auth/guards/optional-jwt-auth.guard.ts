import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthenticatedRequest } from '../../common/types/authenticated-request';
import { JwtAuthGuard } from './jwt-auth.guard';

@Injectable()
export class OptionalJwtAuthGuard extends JwtAuthGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractBearerToken(request);

    if (!token) {
      return true;
    }

    try {
      request.user = await this.verifyAccessToken(token);
    } catch {
      request.user = undefined;
    }

    return true;
  }
}
