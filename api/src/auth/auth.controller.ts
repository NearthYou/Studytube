import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthCookiePolicy } from './auth-cookie';
import {
  CompleteRegistrationDto,
  ConsumeVerificationDto,
  LoginDto,
  ResendVerificationDto,
  SignupDto,
} from './auth.dto';
import { AuthHttpException } from './auth-http.exception';
import { ClientAddressResolver } from './client-address.resolver';
import { Public } from './public.decorator';
import type { AuthenticatedRequest } from './session.guard';
import { AuthService } from './auth.service';

@Controller()
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly cookies: AuthCookiePolicy,
    private readonly clientAddresses: ClientAddressResolver,
  ) {}

  @Public()
  @Post('auth/signup')
  @HttpCode(HttpStatus.ACCEPTED)
  async signup(@Body() body: SignupDto, @Req() request: Request) {
    const result = await this.authService.signup(
      { email: body.email },
      this.clientAddresses.resolve(request),
    );
    this.rejectRateLimit(result);
    return { status: 'accepted' as const };
  }

  @Public()
  @Post('auth/email-verifications/resend')
  @HttpCode(HttpStatus.ACCEPTED)
  async resend(@Body() body: ResendVerificationDto, @Req() request: Request) {
    const result = await this.authService.resend(
      { email: body.email },
      this.clientAddresses.resolve(request),
    );
    this.rejectRateLimit(result);
    return { status: 'accepted' as const };
  }

  @Public()
  @Post('auth/email-verifications/consume')
  @HttpCode(HttpStatus.NO_CONTENT)
  async consumeVerification(
    @Body() body: ConsumeVerificationDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const result = await this.authService.consumeVerification(
      { verificationToken: body.verificationToken },
      this.clientAddresses.resolve(request),
    );
    this.rejectRateLimit(result);
    if (result.status !== 'verified') {
      throw new AuthHttpException(
        'INVALID_VERIFICATION',
        'Verification token is invalid or expired',
        HttpStatus.UNAUTHORIZED,
      );
    }
    this.cookies.setEnrollmentCookie(response, result.enrollmentToken);
  }

  @Public()
  @Get('auth/registrations/current')
  async registrationReadiness(@Req() request: Request) {
    const enrollmentToken = this.cookies.readEnrollmentCookie(
      request.headers.cookie,
    );
    if (!enrollmentToken) {
      throw this.invalidEnrollment();
    }
    const result =
      await this.authService.getRegistrationReadiness(enrollmentToken);
    if (result.status !== 'ready') {
      throw this.invalidEnrollment();
    }
    return { status: 'ready' as const };
  }

  @Public()
  @Post('auth/registrations/complete')
  async completeRegistration(
    @Body() body: CompleteRegistrationDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const enrollmentToken = this.cookies.readEnrollmentCookie(
      request.headers.cookie,
    );
    if (!enrollmentToken) {
      throw this.invalidEnrollment();
    }
    const result = await this.authService.completeRegistration(
      {
        enrollmentToken,
        name: body.name,
        password: body.password,
      },
      this.clientAddresses.resolve(request),
    );
    this.rejectRateLimit(result);
    if (result.status === 'conflict') {
      throw new AuthHttpException(
        'REGISTRATION_CONFLICT',
        'Registration can no longer be completed',
        HttpStatus.CONFLICT,
      );
    }
    if (result.status !== 'completed') {
      throw this.invalidEnrollment();
    }
    this.cookies.setSessionCookie(response, result.sessionToken);
    this.cookies.clearEnrollmentCookie(response);
    return { user: result.user };
  }

  @Public()
  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.login(
      { email: body.email, password: body.password },
      this.clientAddresses.resolve(request),
    );
    this.rejectRateLimit(result);
    if (result.status !== 'authenticated') {
      throw new AuthHttpException(
        'INVALID_CREDENTIALS',
        'Invalid email or password',
        HttpStatus.UNAUTHORIZED,
      );
    }
    this.cookies.setSessionCookie(response, result.sessionToken);
    return { user: result.user };
  }

  @Public()
  @Post('auth/logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const sessionToken = this.cookies.readSessionCookie(request.headers.cookie);
    try {
      if (sessionToken) {
        await this.authService.logout(sessionToken);
      }
    } finally {
      this.cookies.clearSessionCookie(response);
    }
  }

  @Get('me')
  getMe(@Req() request: AuthenticatedRequest) {
    return request.principal.user;
  }

  private rejectRateLimit(result: {
    status: string;
    retryAfterSeconds?: number;
  }) {
    if (result.status !== 'rate_limited') {
      return;
    }
    throw new AuthHttpException(
      'RATE_LIMITED',
      'Too many requests',
      HttpStatus.TOO_MANY_REQUESTS,
      result.retryAfterSeconds,
    );
  }

  private invalidEnrollment(): AuthHttpException {
    return new AuthHttpException(
      'INVALID_ENROLLMENT',
      'Enrollment is invalid or expired',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
