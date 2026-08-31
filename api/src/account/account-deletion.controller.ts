import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthCookiePolicy } from '../auth/auth-cookie';
import { AuthHttpException } from '../auth/auth-http.exception';
import type { AuthenticatedRequest } from '../auth/session.guard';
import { AccountErasureService } from './account-erasure.service';

@Controller()
export class AccountDeletionController {
  constructor(
    private readonly erasure: AccountErasureService,
    private readonly cookies: AuthCookiePolicy,
  ) {}

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAccount(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const result = await this.erasure.eraseAccount({
      userId: request.principal.userId,
      sessionId: request.principal.sessionId,
    });
    if (result.status === 'reauth_required') {
      throw new AuthHttpException(
        'ACCOUNT_REAUTH_REQUIRED',
        'Recent Google authentication is required',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (result.status === 'not_found') {
      throw new AuthHttpException(
        'ACCOUNT_NOT_FOUND',
        'Account was not found',
        HttpStatus.NOT_FOUND,
      );
    }
    this.cookies.clearSessionCookie(response);
  }
}
