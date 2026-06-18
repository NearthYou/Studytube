import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'node:crypto';
import { Repository } from 'typeorm';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { MailService } from '../mail/mail.service';
import type { PublicUser } from '../users/users.service';
import { UsersService } from '../users/users.service';
import { CheckEmailDto } from './dto/check-email.dto';
import { CheckNicknameDto } from './dto/check-nickname.dto';
import { ConfirmEmailVerificationDto } from './dto/confirm-email-verification.dto';
import { LoginDto } from './dto/login.dto';
import { RequestEmailVerificationDto } from './dto/request-email-verification.dto';
import { SignupDto } from './dto/signup.dto';
import { SocialAuthQueryDto } from './dto/social-auth-query.dto';
import { SocialCallbackQueryDto } from './dto/social-callback-query.dto';
import { EmailVerificationEntity } from './email-verification.entity';
import { SocialAccountEntity } from './social-account.entity';

interface EmailVerification {
  code: string;
  expiresAt: Date;
}

interface EmailVerificationTokenPayload {
  email?: unknown;
  purpose?: unknown;
}

type SocialProvider = 'google' | 'kakao' | 'naver';

interface SocialProviderConfig {
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  clientId: string;
  clientSecret?: string;
  scope?: string;
}

interface SocialStatePayload {
  purpose?: unknown;
  provider?: unknown;
  redirect?: unknown;
}

interface SocialProfile {
  provider: SocialProvider;
  providerUserId: string;
  email: string;
  nickname: string;
  profileImageUrl: string | null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    @InjectRepository(EmailVerificationEntity)
    private readonly emailVerificationsRepository: Repository<EmailVerificationEntity>,
    @InjectRepository(SocialAccountEntity)
    private readonly socialAccountsRepository: Repository<SocialAccountEntity>,
  ) {}

  async requestEmailVerification(dto: RequestEmailVerificationDto) {
    const email = this.normalizeEmail(dto.email);

    if (await this.usersService.existsByEmail(email)) {
      throw new ConflictException('이미 가입된 이메일입니다.');
    }

    const verification = this.createEmailVerificationCode();

    await this.mailService.sendEmailVerificationCode(
      email,
      verification.code,
      verification.expiresAt,
    );

    await this.emailVerificationsRepository.save({
      email,
      code: verification.code,
      expiresAt: verification.expiresAt,
      verifiedAt: null,
      verifiedExpiresAt: null,
    });

    return {
      message: '인증 이메일 요청을 접수했습니다.',
      email,
    };
  }

  async confirmEmailVerification(dto: ConfirmEmailVerificationDto) {
    const email = this.normalizeEmail(dto.email);
    const verification = await this.emailVerificationsRepository.findOneBy({
      email,
    });

    if (!verification) {
      throw new BadRequestException('인증번호를 먼저 요청해주세요.');
    }

    if (verification.expiresAt < new Date()) {
      await this.emailVerificationsRepository.delete({ email });
      throw new BadRequestException('인증번호가 만료되었습니다.');
    }

    if (verification.code !== dto.code) {
      throw new BadRequestException('인증번호가 일치하지 않습니다.');
    }

    await this.emailVerificationsRepository.save({
      ...verification,
      verifiedAt: new Date(),
      verifiedExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    const emailVerificationToken = await this.jwtService.signAsync(
      {
        email,
        purpose: 'email_verification',
      },
      {
        expiresIn: 30 * 60,
      },
    );

    return {
      message: '이메일 인증이 완료되었습니다.',
      email,
      emailVerificationToken,
    };
  }

  async isEmailVerified(email: string): Promise<boolean> {
    const normalizedEmail = this.normalizeEmail(email);
    const verifiedEmail = await this.emailVerificationsRepository.findOneBy({
      email: normalizedEmail,
    });

    if (!verifiedEmail?.verifiedAt || !verifiedEmail.verifiedExpiresAt) {
      return false;
    }

    if (verifiedEmail.verifiedExpiresAt < new Date()) {
      await this.emailVerificationsRepository.delete({
        email: normalizedEmail,
      });
      return false;
    }

    return true;
  }

  checkNickname(dto: CheckNicknameDto) {
    const nickname = dto.nickname.trim();

    return this.checkNicknameAvailability(nickname);
  }

  async checkEmail(dto: CheckEmailDto) {
    const email = this.normalizeEmail(dto.email);

    if (await this.usersService.existsByEmail(email)) {
      throw new ConflictException('이미 가입된 이메일입니다.');
    }

    return {
      message: '사용 가능한 이메일입니다.',
      email,
    };
  }

  async checkNicknameAvailability(nickname: string) {
    if (await this.usersService.existsByNickname(nickname)) {
      throw new ConflictException('이미 사용 중인 닉네임입니다.');
    }

    return {
      message: '사용 가능한 닉네임입니다.',
      nickname,
    };
  }

  async signup(dto: SignupDto, profileImageUrl?: string | null) {
    const email = this.normalizeEmail(dto.email);
    const nickname = dto.nickname.trim();

    await this.verifyEmailVerificationToken(email, dto.emailVerificationToken);

    if (!(await this.isEmailVerified(email))) {
      throw new BadRequestException('이메일 인증을 완료해주세요.');
    }

    if (dto.password !== dto.passwordConfirm) {
      throw new BadRequestException('비밀번호 확인이 일치하지 않습니다.');
    }

    if (!dto.termsAccepted) {
      throw new BadRequestException('이용약관에 동의해주세요.');
    }

    const user = await this.usersService.createUser({
      email,
      nickname,
      password: dto.password,
      profileImageUrl,
    });

    await this.emailVerificationsRepository.delete({ email });

    return {
      message: '회원가입이 완료되었습니다.',
      user,
    };
  }

  async login(dto: LoginDto) {
    const email = this.normalizeEmail(dto.email);
    const user = await this.usersService.validateCredentials(
      email,
      dto.password,
    );

    if (!user) {
      throw new UnauthorizedException(
        '이메일 또는 비밀번호가 일치하지 않습니다.',
      );
    }

    const accessToken = await this.issueAccessToken(user);

    return {
      message: '로그인에 성공했습니다.',
      accessToken,
      user,
    };
  }

  logout(user: AuthenticatedUser) {
    return {
      message: '로그아웃되었습니다.',
      userId: user.id,
    };
  }

  async getSocialAuthorizationUrl(
    providerInput: string,
    dto: SocialAuthQueryDto,
    requestOrigin: string,
  ) {
    const provider = this.assertSocialProvider(providerInput);
    const config = this.getSocialProviderConfig(provider);
    const redirectUri = this.getSocialCallbackUrl(provider, requestOrigin);
    const redirect = this.sanitizeRedirect(dto.redirect);
    const state = await this.jwtService.signAsync(
      {
        purpose: 'social_oauth_state',
        provider,
        redirect,
        nonce: randomBytes(12).toString('hex'),
      },
      {
        expiresIn: 10 * 60,
      },
    );
    const authorizationUrl = new URL(config.authorizationUrl);

    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('client_id', config.clientId);
    authorizationUrl.searchParams.set('redirect_uri', redirectUri);
    authorizationUrl.searchParams.set('state', state);

    if (config.scope) {
      authorizationUrl.searchParams.set('scope', config.scope);
    }

    return authorizationUrl.toString();
  }

  async handleSocialCallback(
    providerInput: string,
    dto: SocialCallbackQueryDto,
    requestOrigin: string,
  ) {
    const provider = this.assertSocialProvider(providerInput);

    if (dto.error) {
      throw new BadRequestException(
        dto.error_description || '소셜 로그인이 취소되었습니다.',
      );
    }

    if (!dto.code || !dto.state) {
      throw new BadRequestException('소셜 로그인 콜백 정보가 부족합니다.');
    }

    const redirect = await this.verifySocialState(provider, dto.state);
    const token = await this.exchangeSocialCode(
      provider,
      dto.code,
      dto.state,
      requestOrigin,
    );
    const profile = await this.fetchSocialProfile(provider, token);
    const { user, isNewUser } = await this.findOrCreateSocialUser(profile);
    const accessToken = await this.issueAccessToken(user);

    return {
      message: isNewUser
        ? '소셜 회원가입이 완료되었습니다.'
        : '소셜 로그인에 성공했습니다.',
      accessToken,
      user,
      provider,
      isNewUser,
      redirect,
    };
  }

  private async verifyEmailVerificationToken(email: string, token: string) {
    try {
      const payload =
        await this.jwtService.verifyAsync<EmailVerificationTokenPayload>(token);

      if (payload.email !== email || payload.purpose !== 'email_verification') {
        throw new BadRequestException('이메일 인증 토큰이 유효하지 않습니다.');
      }
    } catch {
      throw new BadRequestException('이메일 인증 토큰이 유효하지 않습니다.');
    }
  }

  private createEmailVerificationCode(): EmailVerification {
    const code = this.generateVerificationCode();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    return {
      code,
      expiresAt,
    };
  }

  private generateVerificationCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private async issueAccessToken(user: PublicUser) {
    return this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      nickname: user.nickname,
      profileImageUrl: user.profileImageUrl,
    });
  }

  private assertSocialProvider(provider: string): SocialProvider {
    if (['google', 'kakao', 'naver'].includes(provider)) {
      return provider as SocialProvider;
    }

    throw new BadRequestException('지원하지 않는 소셜 로그인입니다.');
  }

  private getSocialProviderConfig(
    provider: SocialProvider,
  ): SocialProviderConfig {
    const configs: Record<SocialProvider, SocialProviderConfig> = {
      google: {
        authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
        clientId: this.getConfig('GOOGLE_CLIENT_ID'),
        clientSecret: this.getConfig('GOOGLE_CLIENT_SECRET'),
        scope: 'openid email profile',
      },
      kakao: {
        authorizationUrl: 'https://kauth.kakao.com/oauth/authorize',
        tokenUrl: 'https://kauth.kakao.com/oauth/token',
        userInfoUrl: 'https://kapi.kakao.com/v2/user/me',
        clientId:
          this.getConfig('KAKAO_CLIENT_ID') ||
          this.getConfig('KAKAO_REST_API_KEY'),
        clientSecret: this.getConfig('KAKAO_CLIENT_SECRET'),
        scope: 'profile_nickname,profile_image',
      },
      naver: {
        authorizationUrl: 'https://nid.naver.com/oauth2.0/authorize',
        tokenUrl: 'https://nid.naver.com/oauth2.0/token',
        userInfoUrl: 'https://openapi.naver.com/v1/nid/me',
        clientId: this.getConfig('NAVER_CLIENT_ID'),
        clientSecret: this.getConfig('NAVER_CLIENT_SECRET'),
      },
    };
    const config = configs[provider];

    if (!config.clientId || (provider !== 'kakao' && !config.clientSecret)) {
      throw new ServiceUnavailableException(
        `${this.getSocialProviderLabel(provider)} 로그인 설정이 필요합니다.`,
      );
    }

    return config;
  }

  private getConfig(key: string): string {
    return this.configService.get<string>(key, '').trim();
  }

  private getSocialProviderLabel(provider: SocialProvider) {
    const labels: Record<SocialProvider, string> = {
      google: '구글',
      kakao: '카카오',
      naver: '네이버',
    };

    return labels[provider];
  }

  private getSocialCallbackUrl(
    provider: SocialProvider,
    requestOrigin: string,
  ) {
    const baseUrl =
      this.getConfig('SOCIAL_AUTH_BACKEND_URL') ||
      this.getConfig('BACKEND_PUBLIC_URL') ||
      requestOrigin;

    return `${baseUrl.replace(/\/$/, '')}/api/auth/social/${provider}/callback`;
  }

  getSocialFrontendCallbackUrl() {
    const frontendUrl =
      this.getConfig('SOCIAL_AUTH_FRONTEND_URL') ||
      this.getConfig('FRONTEND_URL') ||
      'http://127.0.0.1:5174';

    return `${frontendUrl.replace(/\/$/, '')}/social/callback`;
  }

  private sanitizeRedirect(redirect?: string) {
    if (redirect?.startsWith('/') && !redirect.startsWith('//')) {
      return redirect;
    }

    return '/';
  }

  private async verifySocialState(
    provider: SocialProvider,
    state: string,
  ): Promise<string> {
    try {
      const payload =
        await this.jwtService.verifyAsync<SocialStatePayload>(state);

      if (
        payload.purpose !== 'social_oauth_state' ||
        payload.provider !== provider
      ) {
        throw new BadRequestException(
          '소셜 로그인 상태값이 유효하지 않습니다.',
        );
      }

      return this.sanitizeRedirect(
        typeof payload.redirect === 'string' ? payload.redirect : undefined,
      );
    } catch {
      throw new BadRequestException('소셜 로그인 상태값이 유효하지 않습니다.');
    }
  }

  private async exchangeSocialCode(
    provider: SocialProvider,
    code: string,
    state: string,
    requestOrigin: string,
  ) {
    const config = this.getSocialProviderConfig(provider);
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.clientId,
      redirect_uri: this.getSocialCallbackUrl(provider, requestOrigin),
      code,
    });

    if (config.clientSecret) {
      body.set('client_secret', config.clientSecret);
    }

    if (provider === 'naver') {
      body.set('state', state);
    }

    const { response, payload } = await this.fetchSocialJson(
      provider,
      config.tokenUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      },
      'token exchange',
    );

    if (!response.ok || typeof payload?.access_token !== 'string') {
      const providerError = this.getSocialTokenErrorMessage(payload);

      this.logger.warn(
        `${this.getSocialProviderLabel(provider)} token exchange failed: ${providerError}`,
      );

      throw new BadRequestException(
        `소셜 로그인 토큰 발급에 실패했습니다. (${providerError})`,
      );
    }

    return payload.access_token;
  }

  private async fetchSocialProfile(
    provider: SocialProvider,
    accessToken: string,
  ): Promise<SocialProfile> {
    const config = this.getSocialProviderConfig(provider);
    const { response, payload } = await this.fetchSocialJson(
      provider,
      config.userInfoUrl,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      'profile fetch',
    );

    if (!response.ok || !payload) {
      throw new BadRequestException('소셜 계정 정보를 가져오지 못했습니다.');
    }

    return this.normalizeSocialProfile(provider, payload);
  }

  private normalizeSocialProfile(
    provider: SocialProvider,
    payload: Record<string, unknown>,
  ): SocialProfile {
    if (provider === 'google') {
      const profile = {
        provider,
        providerUserId: this.getString(payload.sub),
        email: this.normalizeEmail(this.getString(payload.email)),
        nickname: this.getString(payload.name) || 'Google User',
        profileImageUrl: this.getNullableString(payload.picture),
      };

      return this.assertSocialProfile(profile);
    }

    if (provider === 'kakao') {
      const account = this.getRecord(payload.kakao_account);
      const profile = this.getRecord(account.profile);
      const properties = this.getRecord(payload.properties);
      const providerUserId = this.getString(payload.id);
      const kakaoEmail = this.normalizeEmail(this.getString(account.email));

      return this.assertSocialProfile({
        provider,
        providerUserId,
        email:
          kakaoEmail ||
          this.createSocialFallbackEmail(provider, providerUserId),
        nickname:
          this.getString(profile.nickname) ||
          this.getString(properties.nickname) ||
          'Kakao User',
        profileImageUrl:
          this.getNullableString(profile.profile_image_url) ??
          this.getNullableString(properties.profile_image),
      });
    }

    const response = this.getRecord(payload.response);

    return this.assertSocialProfile({
      provider,
      providerUserId: this.getString(response.id),
      email: this.normalizeEmail(this.getString(response.email)),
      nickname: this.getString(response.nickname) || 'Naver User',
      profileImageUrl: this.getNullableString(response.profile_image),
    });
  }

  private assertSocialProfile(profile: SocialProfile): SocialProfile {
    if (!profile.providerUserId) {
      throw new BadRequestException('소셜 계정 식별자를 가져오지 못했습니다.');
    }

    if (!profile.email) {
      throw new BadRequestException(
        '소셜 계정에서 이메일 정보를 받을 수 없습니다. 이메일 제공 동의를 확인해주세요.',
      );
    }

    return profile;
  }

  private createSocialFallbackEmail(
    provider: SocialProvider,
    providerUserId: string,
  ) {
    if (!providerUserId) {
      return '';
    }

    const safeProviderUserId = providerUserId
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '_');

    return `${provider}_${safeProviderUserId}@tailtalk.social.local`;
  }

  private async findOrCreateSocialUser(profile: SocialProfile) {
    const linkedAccount = await this.socialAccountsRepository.findOne({
      where: {
        provider: profile.provider,
        providerUserId: profile.providerUserId,
      },
    });

    if (linkedAccount) {
      await this.updateSocialAccountProfile(linkedAccount, profile);
      const user = await this.usersService.findById(linkedAccount.userId);

      if (!user) {
        throw new BadRequestException('연결된 사용자를 찾을 수 없습니다.');
      }

      return { user, isNewUser: false };
    }

    const existingUser = await this.usersService.findByEmail(profile.email);
    const user =
      existingUser ??
      (await this.usersService.createSocialUser({
        email: profile.email,
        nickname: profile.nickname,
        profileImageUrl: profile.profileImageUrl,
      }));

    await this.socialAccountsRepository.save(
      this.socialAccountsRepository.create({
        userId: user.id,
        provider: profile.provider,
        providerUserId: profile.providerUserId,
        email: profile.email,
        profileImageUrl: profile.profileImageUrl,
      }),
    );

    return { user, isNewUser: !existingUser };
  }

  private async updateSocialAccountProfile(
    account: SocialAccountEntity,
    profile: SocialProfile,
  ) {
    account.email = profile.email;
    account.profileImageUrl = profile.profileImageUrl;
    await this.socialAccountsRepository.save(account);
  }

  private getRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  }

  private getSocialTokenErrorMessage(payload: Record<string, unknown> | null) {
    if (!payload) {
      return 'empty_response';
    }

    const errorCode =
      this.getString(payload.error) ||
      this.getString(payload.error_code) ||
      this.getString(payload.code);
    const errorDescription =
      this.getString(payload.error_description) ||
      this.getString(payload.error_message) ||
      this.getString(payload.msg);

    return (
      [errorCode, errorDescription].filter(Boolean).join(': ') ||
      'unknown_error'
    );
  }

  private getString(value: unknown): string {
    if (value === undefined || value === null) {
      return '';
    }

    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    ) {
      return String(value);
    }

    return '';
  }

  private getNullableString(value: unknown): string | null {
    const text = this.getString(value);

    return text || null;
  }

  private async fetchSocialJson(
    provider: SocialProvider,
    url: string,
    init: RequestInit,
    operation: string,
  ) {
    let response: Response;

    try {
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(this.getSocialRequestTimeoutMs()),
      });
    } catch (error) {
      this.logger.warn(
        `${this.getSocialProviderLabel(provider)} ${operation} request failed: ${this.toErrorMessage(error)}`,
      );
      throw new ServiceUnavailableException(
        '소셜 로그인 제공자 응답이 지연되고 있습니다. 잠시 후 다시 시도해주세요.',
      );
    }

    const payload = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;

    if (!payload && response.ok) {
      throw new BadGatewayException('소셜 로그인 응답을 해석할 수 없습니다.');
    }

    return { response, payload };
  }

  private getSocialRequestTimeoutMs() {
    const timeoutMs = Number(
      this.configService.get<string>('SOCIAL_AUTH_TIMEOUT_MS'),
    );

    return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10000;
  }

  private toErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : 'Unknown error';
  }
}
