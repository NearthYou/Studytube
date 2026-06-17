import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Optional,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  extractCookieValue,
} from './auth-cookie.utils';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { PasswordResetConfirmDto } from './dto/password-reset-confirm.dto';
import { PasswordResetRequestDto } from './dto/password-reset-request.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthService, type AuthenticatedSessionResult } from './auth.service';
import { GoogleOAuthService } from './google-oauth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { LoginRateLimitGuard } from './login-rate-limit.guard';

type SameSiteOption = CookieOptions['sameSite'];

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly googleOAuthService: GoogleOAuthService,
    @Optional() private readonly configService?: ConfigService,
  ) {}

  @Post('register')
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @UseGuards(LoginRateLimitGuard)
  async login(
    @Body() loginDto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.login(
      loginDto,
      this.getRequestContext(request),
    );
    this.setAuthCookies(response, result);

    return { user: result.user };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.refresh(
      extractCookieValue(request, REFRESH_TOKEN_COOKIE),
      this.getRequestContext(request),
    );
    this.setAuthCookies(response, result);

    return { user: result.user };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.authService.logout(
      extractCookieValue(request, REFRESH_TOKEN_COOKIE),
    );
    this.clearAuthCookies(response);

    return { ok: true };
  }

  @Get('google')
  startGoogleLogin(
    @Query('redirectTo') redirectTo: string | undefined,
    @Res() response: Response,
  ) {
    response.redirect(
      this.googleOAuthService.createAuthorizationUrl(redirectTo),
    );
  }

  @Get('google/callback')
  async finishGoogleLogin(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') oauthError: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    if (oauthError) {
      response.redirect(this.googleOAuthService.createFrontendOAuthErrorUrl());
      return;
    }

    const { redirectTo } = this.googleOAuthService.verifyState(state);
    const profile = await this.googleOAuthService.exchangeCodeForProfile(code);
    const result = await this.authService.loginWithGoogle(
      profile,
      this.getRequestContext(request),
    );

    this.setAuthCookies(response, result);
    response.redirect(
      this.googleOAuthService.createFrontendRedirectUrl(redirectTo),
    );
  }

  @Post('password-reset/request')
  @HttpCode(200)
  requestPasswordReset(@Body() dto: PasswordResetRequestDto) {
    return this.authService.requestPasswordReset(dto);
  }

  @Post('password-reset/confirm')
  @HttpCode(200)
  confirmPasswordReset(@Body() dto: PasswordResetConfirmDto) {
    return this.authService.confirmPasswordReset(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getMe(user);
  }

  @Get('check-email')
  checkEmail(@Query('email') email?: string) {
    const normalizedEmail = email?.trim();

    if (!normalizedEmail) {
      throw new BadRequestException('Email is required');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      throw new BadRequestException('Invalid email format');
    }

    return this.authService.checkEmailAvailability(normalizedEmail);
  }

  private setAuthCookies(
    response: Response,
    result: AuthenticatedSessionResult,
  ) {
    response.cookie(ACCESS_TOKEN_COOKIE, result.accessToken, {
      ...this.createBaseCookieOptions(),
      maxAge: this.getNumberConfig('AUTH_ACCESS_COOKIE_MAX_AGE_MS', 900_000),
    });
    response.cookie(REFRESH_TOKEN_COOKIE, result.refreshToken.value, {
      ...this.createBaseCookieOptions(),
      maxAge: Math.max(result.refreshToken.expiresAt.getTime() - Date.now(), 0),
    });
  }

  private clearAuthCookies(response: Response) {
    const options = this.createBaseCookieOptions();
    response.clearCookie(ACCESS_TOKEN_COOKIE, options);
    response.clearCookie(REFRESH_TOKEN_COOKIE, options);
  }

  private createBaseCookieOptions(): CookieOptions {
    const domain = this.getStringConfig('AUTH_COOKIE_DOMAIN');

    return {
      httpOnly: true,
      secure: this.getBooleanConfig(
        'AUTH_COOKIE_SECURE',
        process.env.NODE_ENV === 'production',
      ),
      sameSite: this.getSameSiteConfig(),
      path: '/',
      ...(domain ? { domain } : {}),
    };
  }

  private getRequestContext(request: Request) {
    const userAgentHeader = request.headers['user-agent'];

    return {
      ipAddress: request.ip,
      userAgent:
        request.get?.('user-agent') ??
        (Array.isArray(userAgentHeader)
          ? userAgentHeader.join(' ')
          : userAgentHeader),
    };
  }

  private getSameSiteConfig(): SameSiteOption {
    const sameSite = this.getStringConfig('AUTH_COOKIE_SAME_SITE') ?? 'lax';
    if (['lax', 'strict', 'none'].includes(sameSite)) {
      return sameSite as SameSiteOption;
    }

    return 'lax';
  }

  private getStringConfig(key: string) {
    return this.configService?.get<string>(key) ?? process.env[key];
  }

  private getNumberConfig(key: string, fallback: number) {
    const value = Number(this.getStringConfig(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private getBooleanConfig(key: string, fallback: boolean) {
    const value = this.getStringConfig(key);
    if (value === undefined) {
      return fallback;
    }

    return value === 'true';
  }
}
