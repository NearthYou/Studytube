import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../common/types/auth-user.type';
import { AuthService } from './auth.service';
import { CheckEmailDto } from './dto/check-email.dto';
import { CheckLoginIdDto } from './dto/check-login-id.dto';
import { CheckNicknameDto } from './dto/check-nickname.dto';
import { LoginDto } from './dto/login.dto';
import { RequestEmailVerificationDto } from './dto/request-email-verification.dto';
import { SignupDto } from './dto/signup.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  async signUp(@Body() signupDto: SignupDto) {
    return this.authService.signUp(signupDto);
  }

  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
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

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout() {
    return this.authService.logout();
  }
}
