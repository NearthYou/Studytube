import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { PrismaService } from 'src/database/prisma.service';
import { UsersService } from 'src/users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import {
  buildRefreshCookieValue,
  parseRefreshCookieValue,
} from './auth-cookie.utils';
import type { GoogleOAuthProfile } from './google-oauth.service';
import { JwtPaylaod } from './interfaces/jwt-payload.interface';

export type AuthRequestContext = {
  ipAddress?: string;
  userAgent?: string;
};

export type AuthenticatedSessionResult = {
  accessToken: string;
  refreshToken: {
    value: string;
    expiresAt: Date;
  };
  user: {
    id: string;
    email: string;
    nickname: string;
  };
};

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async register(registerDto: RegisterDto) {
    const existingUser = await this.usersService.findByEmail(registerDto.email);

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    const passwordHash = await bcrypt.hash(registerDto.password, 10);

    const user = await this.usersService.create({
      email: registerDto.email,
      passwordHash,
      nickname: registerDto.nickname,
    });

    return this.usersService.toPublicUser(user);
  }

  async login(
    loginDto: LoginDto,
    context: AuthRequestContext = {},
  ): Promise<AuthenticatedSessionResult> {
    const user = await this.usersService.findByEmail(loginDto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordMatches = await bcrypt.compare(
      loginDto.password,
      user.passwordHash,
    );
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return {
      accessToken: await this.signAccessToken(user),
      refreshToken: await this.createRefreshSession(user.id, context),
      user: this.usersService.toPublicUser(user),
    };
  }

  async loginWithGoogle(
    profile: GoogleOAuthProfile,
    context: AuthRequestContext = {},
  ): Promise<AuthenticatedSessionResult> {
    if (!profile.emailVerified) {
      throw new UnauthorizedException('Google account email is not verified');
    }

    const email = profile.email.trim().toLowerCase();
    if (!email) {
      throw new UnauthorizedException('Google account email is required');
    }

    const user =
      (await this.usersService.findByEmail(email)) ??
      (await this.usersService.create({
        email,
        passwordHash: await bcrypt.hash(this.createOAuthPasswordSecret(), 10),
        nickname: this.createGoogleNickname(profile),
      }));

    return {
      accessToken: await this.signAccessToken(user),
      refreshToken: await this.createRefreshSession(user.id, context),
      user: this.usersService.toPublicUser(user),
    };
  }

  async refresh(
    refreshCookieValue: string | undefined,
    context: AuthRequestContext = {},
  ): Promise<AuthenticatedSessionResult> {
    const parsedRefreshToken = parseRefreshCookieValue(refreshCookieValue);
    if (!parsedRefreshToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const session = await this.prisma.authSession.findUnique({
      where: { id: parsedRefreshToken.sessionId },
      include: { user: true },
    });

    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const secretMatches = await bcrypt.compare(
      parsedRefreshToken.secret,
      session.refreshTokenHash,
    );
    if (!secretMatches) {
      await this.prisma.authSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Invalid refresh token');
    }

    const nextSecret = this.createRefreshSecret();
    await this.prisma.authSession.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: await bcrypt.hash(nextSecret, 10),
        lastUsedAt: new Date(),
        ipAddress: context.ipAddress,
        userAgent: this.truncateUserAgent(context.userAgent),
      },
    });

    return {
      accessToken: await this.signAccessToken(session.user),
      refreshToken: {
        value: buildRefreshCookieValue(session.id, nextSecret),
        expiresAt: session.expiresAt,
      },
      user: this.usersService.toPublicUser(session.user),
    };
  }

  async logout(refreshCookieValue: string | undefined) {
    const parsedRefreshToken = parseRefreshCookieValue(refreshCookieValue);
    if (!parsedRefreshToken) {
      return { revoked: false };
    }

    await this.prisma.authSession.updateMany({
      where: { id: parsedRefreshToken.sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return { revoked: true };
  }

  async requestPasswordReset(request: { email: string }) {
    const user = await this.usersService.findByEmail(request.email);
    if (!user) {
      return { ok: true };
    }

    const tokenId = randomUUID();
    const secret = this.createRefreshSecret();
    const expiresAt = this.createPasswordResetExpiry();

    await this.prisma.passwordResetToken.create({
      data: {
        id: tokenId,
        userId: user.id,
        tokenHash: await bcrypt.hash(secret, 10),
        expiresAt,
      },
    });

    if (this.isProduction()) {
      return { ok: true };
    }

    return {
      ok: true,
      resetToken: buildRefreshCookieValue(tokenId, secret),
    };
  }

  async confirmPasswordReset(request: { token: string; newPassword: string }) {
    const parsedToken = parseRefreshCookieValue(request.token);
    if (!parsedToken) {
      throw new UnauthorizedException('Invalid password reset token');
    }

    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { id: parsedToken.sessionId },
    });
    if (
      !resetToken ||
      resetToken.usedAt ||
      resetToken.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException('Invalid password reset token');
    }

    const secretMatches = await bcrypt.compare(
      parsedToken.secret,
      resetToken.tokenHash,
    );
    if (!secretMatches) {
      throw new UnauthorizedException('Invalid password reset token');
    }

    await this.prisma.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash: await bcrypt.hash(request.newPassword, 10) },
    });
    await this.prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    });
    await this.prisma.authSession.updateMany({
      where: { userId: resetToken.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return { ok: true };
  }

  async getMe(currentUser: AuthenticatedUser) {
    const user = await this.usersService.findById(BigInt(currentUser.id));
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    return this.usersService.toPublicUser(user);
  }

  async checkEmailAvailability(email: string) {
    const user = await this.usersService.findByEmail(email);

    return { available: !user };
  }

  private async signAccessToken(user: { id: bigint; email: string }) {
    const payload: JwtPaylaod = {
      sub: user.id.toString(),
      email: user.email,
    };

    return this.jwtService.signAsync(payload);
  }

  private async createRefreshSession(
    userId: bigint,
    context: AuthRequestContext,
  ) {
    const sessionId = randomUUID();
    const secret = this.createRefreshSecret();
    const expiresAt = this.createRefreshExpiry();

    await this.prisma.authSession.create({
      data: {
        id: sessionId,
        userId,
        refreshTokenHash: await bcrypt.hash(secret, 10),
        expiresAt,
        ipAddress: context.ipAddress,
        userAgent: this.truncateUserAgent(context.userAgent),
      },
    });

    return {
      value: buildRefreshCookieValue(sessionId, secret),
      expiresAt,
    };
  }

  private createRefreshSecret() {
    return randomBytes(48).toString('base64url');
  }

  private createOAuthPasswordSecret() {
    return `google-oauth:${randomBytes(64).toString('base64url')}`;
  }

  private createGoogleNickname(profile: GoogleOAuthProfile) {
    const nickname =
      profile.name?.trim() ||
      profile.email.split('@')[0]?.trim() ||
      'Google User';

    return nickname.slice(0, 40);
  }

  private createRefreshExpiry() {
    const ttlDays = Number(
      this.configService.get<string>('AUTH_REFRESH_TOKEN_TTL_DAYS') ?? '14',
    );
    const safeTtlDays = Number.isFinite(ttlDays) && ttlDays > 0 ? ttlDays : 14;

    return new Date(Date.now() + safeTtlDays * 24 * 60 * 60 * 1000);
  }

  private createPasswordResetExpiry() {
    const ttlMinutes = Number(
      this.configService.get<string>('PASSWORD_RESET_TOKEN_TTL_MINUTES') ??
        '30',
    );
    const safeTtlMinutes =
      Number.isFinite(ttlMinutes) && ttlMinutes > 0 ? ttlMinutes : 30;

    return new Date(Date.now() + safeTtlMinutes * 60 * 1000);
  }

  private truncateUserAgent(userAgent: string | undefined) {
    return userAgent ? userAgent.slice(0, 512) : undefined;
  }

  private isProduction() {
    return (
      (this.configService.get<string>('NODE_ENV') ?? process.env.NODE_ENV) ===
      'production'
    );
  }
}
