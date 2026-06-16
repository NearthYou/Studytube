import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHmac, timingSafeEqual } from 'crypto';
import { DatabaseService } from '../database/database.service';
import { AuthUser } from '../common/types/auth-user.type';
import { RequestEmailVerificationDto } from './dto/request-email-verification.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';
import { getJwtSecret } from '../config/security.config';

const EMAIL_VERIFICATION_TTL_MS = 10 * 60 * 1000;

type UserRow = {
  id: number;
  login_id: string;
  password_hash: string;
  name: string;
  email: string;
  nickname: string;
  bio: string | null;
  location: string | null;
  created_at: Date;
  updated_at: Date;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async signUp(signupDto: SignupDto) {
    if (signupDto.password !== signupDto.passwordConfirm) {
      throw new ConflictException('비밀번호와 비밀번호 확인이 일치하지 않습니다.');
    }

    this.assertEmailVerificationToken(
      signupDto.email,
      signupDto.emailVerificationToken,
    );

    await this.ensureSignupAvailability(signupDto);

    const passwordHash = await argon2.hash(signupDto.password);

    const result = await this.databaseService.query<UserRow>(
      `
        INSERT INTO users (
          login_id,
          password_hash,
          name,
          email,
          nickname
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING
          id,
          login_id,
          password_hash,
          name,
          email,
          nickname,
          bio,
          location,
          created_at,
          updated_at
      `,
      [
        signupDto.loginId.trim(),
        passwordHash,
        signupDto.name.trim(),
        signupDto.email.trim(),
        signupDto.nickname.trim(),
      ],
    );

    return {
      message: '회원가입이 완료되었습니다.',
      user: this.toAuthUser(result.rows[0]),
    };
  }

  async login(loginDto: LoginDto) {
    const user = await this.findUserRecordByLoginId(loginDto.loginId);

    if (!user) {
      throw new UnauthorizedException('아이디/비밀번호를 확인해주세요.');
    }

    const isPasswordValid = await argon2.verify(
      user.password_hash,
      loginDto.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('아이디/비밀번호를 확인해주세요.');
    }

    const authUser = this.toAuthUser(user);
    const payload: JwtPayload = {
      sub: authUser.id,
      loginId: authUser.loginId,
      nickname: authUser.nickname,
    };

    return {
      accessToken: await this.jwtService.signAsync(payload, {
        expiresIn: this.getJwtExpiresIn() as never,
      }),
      user: authUser,
    };
  }

  async getMe(userId: number) {
    const user = await this.findUserById(userId);

    if (!user) {
      throw new UnauthorizedException('유효하지 않은 사용자입니다.');
    }

    return {
      user,
    };
  }

  async logout() {
    return {
      message: '로그아웃되었습니다.',
    };
  }

  async requestEmailVerification(
    requestEmailVerificationDto: RequestEmailVerificationDto,
  ) {
    const isAvailable = await this.isEmailAvailable(
      requestEmailVerificationDto.email,
    );

    if (!isAvailable) {
      throw new ConflictException('이미 사용 중인 이메일입니다.');
    }

    return {
      message: '인증 메일을 발송했습니다. 메일함을 확인해주세요.',
      verified: true,
      verificationToken: this.createEmailVerificationToken(
        requestEmailVerificationDto.email,
      ),
    };
  }

  async isLoginIdAvailable(loginId: string) {
    const result = await this.databaseService.query<{ exists: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM users
          WHERE LOWER(login_id) = LOWER($1)
        ) AS exists
      `,
      [loginId.trim()],
    );

    return !result.rows[0].exists;
  }

  async isNicknameAvailable(nickname: string) {
    const result = await this.databaseService.query<{ exists: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM users
          WHERE LOWER(nickname) = LOWER($1)
        ) AS exists
      `,
      [nickname.trim()],
    );

    return !result.rows[0].exists;
  }

  async isEmailAvailable(email: string) {
    const result = await this.databaseService.query<{ exists: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM users
          WHERE LOWER(email) = LOWER($1)
        ) AS exists
      `,
      [email.trim()],
    );

    return !result.rows[0].exists;
  }

  async findUserById(userId: number): Promise<AuthUser | null> {
    const result = await this.databaseService.query<UserRow>(
      `
        SELECT
          id,
          login_id,
          password_hash,
          name,
          email,
          nickname,
          bio,
          location,
          created_at,
          updated_at
        FROM users
        WHERE id = $1
      `,
      [userId],
    );

    if (!result.rowCount) {
      return null;
    }

    return this.toAuthUser(result.rows[0]);
  }

  private async findUserRecordByLoginId(loginId: string) {
    const result = await this.databaseService.query<UserRow>(
      `
        SELECT
          id,
          login_id,
          password_hash,
          name,
          email,
          nickname,
          bio,
          location,
          created_at,
          updated_at
        FROM users
        WHERE LOWER(login_id) = LOWER($1)
      `,
      [loginId.trim()],
    );

    if (!result.rowCount) {
      return null;
    }

    return result.rows[0];
  }

  private async ensureSignupAvailability(signupDto: SignupDto) {
    if (!(await this.isLoginIdAvailable(signupDto.loginId))) {
      throw new ConflictException('이미 사용 중인 아이디입니다.');
    }

    if (!(await this.isNicknameAvailable(signupDto.nickname))) {
      throw new ConflictException('이미 사용 중인 닉네임입니다.');
    }

    if (!(await this.isEmailAvailable(signupDto.email))) {
      throw new ConflictException('이미 사용 중인 이메일입니다.');
    }
  }

  private toAuthUser(user: UserRow): AuthUser {
    return {
      id: user.id,
      loginId: user.login_id,
      name: user.name,
      email: user.email,
      nickname: user.nickname,
      bio: user.bio,
      location: user.location,
      createdAt: user.created_at.toISOString(),
      updatedAt: user.updated_at.toISOString(),
    };
  }

  getJwtSecret() {
    return getJwtSecret(this.configService);
  }

  getJwtExpiresIn() {
    return this.configService.get<string>('JWT_EXPIRES_IN') ?? '7d';
  }

  private createEmailVerificationToken(email: string) {
    this.assertMockEmailVerificationAllowed();

    const payload = Buffer.from(
      JSON.stringify({
        email: this.normalizeEmail(email),
        exp: Date.now() + EMAIL_VERIFICATION_TTL_MS,
      }),
    ).toString('base64url');
    const signature = this.signEmailVerificationPayload(payload);

    return `${payload}.${signature}`;
  }

  private assertEmailVerificationToken(email: string, token?: string) {
    if (!token) {
      throw new UnauthorizedException('이메일 인증을 먼저 완료해 주세요.');
    }

    const [payload, signature] = token.split('.');
    if (!payload || !signature) {
      throw new UnauthorizedException('유효하지 않은 이메일 인증입니다.');
    }

    const expectedSignature = this.signEmailVerificationPayload(payload);
    if (!this.safeEqual(signature, expectedSignature)) {
      throw new UnauthorizedException('유효하지 않은 이메일 인증입니다.');
    }

    try {
      const decoded = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      ) as {
        email?: unknown;
        exp?: unknown;
      };

      if (
        decoded.email !== this.normalizeEmail(email) ||
        typeof decoded.exp !== 'number' ||
        decoded.exp < Date.now()
      ) {
        throw new UnauthorizedException('이메일 인증이 만료되었습니다.');
      }
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      throw new UnauthorizedException('유효하지 않은 이메일 인증입니다.');
    }
  }

  private signEmailVerificationPayload(payload: string) {
    const secret =
      this.configService.get<string>('EMAIL_VERIFICATION_SECRET')?.trim() ||
      this.getJwtSecret();

    return createHmac('sha256', secret).update(payload).digest('base64url');
  }

  private safeEqual(left: string, right: string) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);

    if (leftBuffer.length !== rightBuffer.length) {
      return false;
    }

    return timingSafeEqual(leftBuffer, rightBuffer);
  }

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  private assertMockEmailVerificationAllowed() {
    const isProduction =
      this.configService.get<string>('NODE_ENV')?.toLowerCase() === 'production';
    const mockEnabled =
      this.configService
        .get<string>('EMAIL_VERIFICATION_MOCK_ENABLED')
        ?.toLowerCase() === 'true';

    if (isProduction && !mockEnabled) {
      throw new ServiceUnavailableException(
        'Email verification provider is not configured.',
      );
    }
  }
}
