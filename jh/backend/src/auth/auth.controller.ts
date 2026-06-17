import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { unlink } from 'node:fs/promises';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { reencodeImageFileToWebp } from '../common/upload/image-upload';
import { toUploadPublicPath } from '../common/upload/upload-paths';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { CheckEmailDto } from './dto/check-email.dto';
import { CheckNicknameDto } from './dto/check-nickname.dto';
import { ConfirmEmailVerificationDto } from './dto/confirm-email-verification.dto';
import { LoginDto } from './dto/login.dto';
import { RequestEmailVerificationDto } from './dto/request-email-verification.dto';
import { SignupDto } from './dto/signup.dto';
import { SocialAuthQueryDto } from './dto/social-auth-query.dto';
import { SocialCallbackQueryDto } from './dto/social-callback-query.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { profileImageUploadOptions } from './profile-image-upload.options';

const PROFILE_IMAGE_MAX_DIMENSION = 512;
const PROFILE_IMAGE_MAX_INPUT_PIXELS = 12_000_000;
const PROFILE_IMAGE_WEBP_QUALITY = 82;

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post(['email-verification/request', 'email/code'])
  requestEmailVerification(@Body() dto: RequestEmailVerificationDto) {
    return this.authService.requestEmailVerification(dto);
  }

  @Post(['email-verification/confirm', 'email/verify'])
  confirmEmailVerification(@Body() dto: ConfirmEmailVerificationDto) {
    return this.authService.confirmEmailVerification(dto);
  }

  @Post('nickname/check')
  checkNickname(@Body() dto: CheckNicknameDto) {
    return this.authService.checkNickname(dto);
  }

  @Get('email/check')
  checkEmailByQuery(@Query() dto: CheckEmailDto) {
    return this.authService.checkEmail(dto);
  }

  @Get('nickname/check')
  checkNicknameByQuery(@Query() dto: CheckNicknameDto) {
    return this.authService.checkNickname(dto);
  }

  @Post('signup')
  @UseInterceptors(FileInterceptor('profileImage', profileImageUploadOptions))
  async signup(
    @Body() dto: SignupDto,
    @UploadedFile() profileImage?: Express.Multer.File,
  ) {
    try {
      if (profileImage) {
        await reencodeImageFileToWebp(profileImage.path, {
          maxHeight: PROFILE_IMAGE_MAX_DIMENSION,
          maxInputPixels: PROFILE_IMAGE_MAX_INPUT_PIXELS,
          maxWidth: PROFILE_IMAGE_MAX_DIMENSION,
          quality: PROFILE_IMAGE_WEBP_QUALITY,
        });
      }

      const profileImageUrl = profileImage
        ? toUploadPublicPath('profiles', profileImage.filename)
        : null;

      return await this.authService.signup(dto, profileImageUrl);
    } catch (error) {
      if (profileImage) {
        await unlink(profileImage.path).catch(() => undefined);
      }

      throw error;
    }
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  logout(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.logout(user);
  }

  @Get('social/:provider')
  async socialAuth(
    @Param('provider') provider: string,
    @Query() dto: SocialAuthQueryDto,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const authorizationUrl = await this.authService.getSocialAuthorizationUrl(
      provider,
      dto,
      this.getRequestOrigin(request),
    );

    return response.redirect(authorizationUrl);
  }

  @Get('social/:provider/callback')
  async socialCallback(
    @Param('provider') provider: string,
    @Query() dto: SocialCallbackQueryDto,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const callbackUrl = new URL(
      this.authService.getSocialFrontendCallbackUrl(),
    );

    try {
      const result = await this.authService.handleSocialCallback(
        provider,
        dto,
        this.getRequestOrigin(request),
      );
      const hash = new URLSearchParams({
        accessToken: result.accessToken,
        user: JSON.stringify(result.user),
        redirect: result.redirect,
        message: result.message,
      });

      callbackUrl.hash = hash.toString();
    } catch (error) {
      callbackUrl.searchParams.set('error', this.getErrorMessage(error));
    }

    return response.redirect(callbackUrl.toString());
  }

  private getRequestOrigin(request: Request): string {
    const forwardedProto = request.headers['x-forwarded-proto'];
    const forwardedHost = request.headers['x-forwarded-host'];
    const proto = Array.isArray(forwardedProto)
      ? forwardedProto[0]
      : forwardedProto || request.protocol || 'http';
    const host = Array.isArray(forwardedHost)
      ? forwardedHost[0]
      : forwardedHost || request.headers.host || 'localhost:3000';

    return `${proto}://${host}`;
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof HttpException) {
      const response = error.getResponse();

      if (response && typeof response === 'object') {
        const message = (response as Record<string, unknown>).message;

        if (Array.isArray(message)) {
          return message.join('\n');
        }

        if (typeof message === 'string') {
          return message;
        }
      }

      if (typeof response === 'string') {
        return response;
      }
    }

    return '소셜 로그인 처리 중 오류가 발생했습니다.';
  }
}
