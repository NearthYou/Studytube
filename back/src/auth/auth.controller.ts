import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../common/types/auth-user.type';
import {
  AUTH_COOKIE_NAME,
  getAuthCookieOptions,
  getClearAuthCookieOptions,
} from '../config/security.config';
import { AuthService } from './auth.service';
import { CheckEmailDto } from './dto/check-email.dto';
import { CheckLoginIdDto } from './dto/check-login-id.dto';
import { CheckNicknameDto } from './dto/check-nickname.dto';
import { LoginDto } from './dto/login.dto';
import { RequestEmailVerificationDto } from './dto/request-email-verification.dto';
import { SignupDto } from './dto/signup.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

type CookieResponse = {
  cookie: (name: string, value: string, options: Record<string, unknown>) => void;
  clearCookie: (name: string, options: Record<string, unknown>) => void;
};

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('signup')
  async signUp(@Body() signupDto: SignupDto) {
    return this.authService.signUp(signupDto);
  }

  @Post('login')
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) response: CookieResponse,
  ) {
    const result = await this.authService.login(loginDto);
    response.cookie(
      AUTH_COOKIE_NAME,
      result.accessToken,
      getAuthCookieOptions(this.configService),
    );

    return {
      user: result.user,
    };
  }

  @Post('email-verification/request')
  async requestEmailVerification(
    @Body() requestEmailVerificationDto: RequestEmailVerificationDto,
  ) {
    return this.authService.requestEmailVerification(
      requestEmailVerificationDto,
    );
  }

  @Get('check-login-id')
  async checkLoginId(@Query() query: CheckLoginIdDto) {
    return {
      available: await this.authService.isLoginIdAvailable(query.loginId),
    };
  }

  @Get('check-nickname')
  async checkNickname(@Query() query: CheckNicknameDto) {
    return {
      available: await this.authService.isNicknameAvailable(query.nickname),
    };
  }

  @Get('check-email')
  async checkEmail(@Query() query: CheckEmailDto) {
    return {
      available: await this.authService.isEmailAvailable(query.email),
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMe(@CurrentUser() user: AuthUser) {
    return this.authService.getMe(user.id);
  }

  @Post('logout')
  async logout(@Res({ passthrough: true }) response: CookieResponse) {
    response.clearCookie(
      AUTH_COOKIE_NAME,
      getClearAuthCookieOptions(this.configService),
    );

    return this.authService.logout();
  }
}
