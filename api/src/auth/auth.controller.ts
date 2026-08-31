import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthCookiePolicy } from './auth-cookie';
import { UpdateProfileDto } from './auth.dto';
import { AuthHttpException } from './auth-http.exception';
import { Public } from './public.decorator';
import type { AuthenticatedRequest } from './session.guard';
import { AuthService } from './auth.service';

@Controller()
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly cookies: AuthCookiePolicy,
  ) {}

  @Public()
  @Post('auth/logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const sessionToken = this.cookies.readSessionCookie(request.headers.cookie);
    try {
      if (sessionToken) await this.authService.logout(sessionToken);
    } finally {
      this.cookies.clearSessionCookie(response);
    }
  }

  @Get('me')
  getMe(@Req() request: AuthenticatedRequest) {
    return request.principal.user;
  }

  @Put('me')
  @HttpCode(HttpStatus.OK)
  async updateProfile(
    @Body() body: UpdateProfileDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const result = await this.authService.updateProfile(
      {
        sessionId: request.principal.sessionId,
        user: request.principal.user,
      },
      {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.preferences !== undefined
          ? { preferences: body.preferences }
          : {}),
      },
    );
    if (result.status === 'not_found') {
      throw new AuthHttpException(
        'PROFILE_NOT_FOUND',
        'Profile was not found',
        HttpStatus.NOT_FOUND,
      );
    }
    if (result.status !== 'updated') {
      throw new AuthHttpException(
        'INVALID_PROFILE_UPDATE',
        'Profile update is invalid',
        HttpStatus.BAD_REQUEST,
      );
    }
    return result.user;
  }
}
