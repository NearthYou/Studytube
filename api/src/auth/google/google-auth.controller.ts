import { Controller, Get, HttpStatus, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthCookiePolicy } from '../auth-cookie';
import { Public } from '../public.decorator';
import { GoogleAuthService } from './google-auth.service';

@Controller()
export class GoogleAuthController {
  constructor(
    private readonly googleAuth: GoogleAuthService,
    private readonly cookies: AuthCookiePolicy,
  ) {}

  @Public()
  @Get('auth/google/start')
  async start(
    @Query('returnTo') returnPath: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    try {
      const started = await this.googleAuth.startLogin({ returnPath });
      response.redirect(HttpStatus.FOUND, started.authorizationUrl);
    } catch {
      response.redirect(HttpStatus.FOUND, googleErrorRedirect('unavailable'));
    }
  }

  @Public()
  @Get('auth/google/callback')
  async callback(
    @Query('state') state: string | undefined,
    @Query('code') code: string | undefined,
    @Query('error') error: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    if (error) {
      response.redirect(
        HttpStatus.FOUND,
        googleErrorRedirect(
          error === 'access_denied' ? 'cancelled' : 'unavailable',
        ),
      );
      return;
    }
    if (!state || !code) {
      response.redirect(HttpStatus.FOUND, googleErrorRedirect('expired'));
      return;
    }
    try {
      const completed = await this.googleAuth.completeLogin({ state, code });
      if (completed.status !== 'authenticated') {
        response.redirect(HttpStatus.FOUND, googleErrorRedirect('expired'));
        return;
      }
      this.cookies.setSessionCookie(response, completed.sessionToken);
      const query = new URLSearchParams({
        new: completed.newUser ? '1' : '0',
        returnTo: completed.newUser ? '/tutorial' : completed.returnPath,
      });
      response.redirect(
        HttpStatus.FOUND,
        `/auth/google/complete?${query.toString()}`,
      );
    } catch {
      response.redirect(HttpStatus.FOUND, googleErrorRedirect('unavailable'));
    }
  }
}

function googleErrorRedirect(
  error: 'cancelled' | 'expired' | 'unavailable',
): string {
  return `/login?googleError=${error}`;
}
