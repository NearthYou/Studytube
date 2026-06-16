import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'node:crypto';
import { Repository } from 'typeorm';
import { UserEntity } from './user.entity';
import { hashPassword, verifyPassword } from './password';

export interface PublicUser {
  id: string;
  email: string;
  nickname: string;
  createdAt: Date;
  profileImageUrl: string | null;
}

interface CreateUserInput {
  email: string;
  nickname: string;
  password: string;
  profileImageUrl?: string | null;
}

interface CreateSocialUserInput {
  email: string;
  nickname: string;
  profileImageUrl?: string | null;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
  ) {}

  async existsByEmail(email: string): Promise<boolean> {
    return this.usersRepository.exists({
      where: {
        email: this.normalizeEmail(email),
      },
    });
  }

  async existsByNickname(nickname: string): Promise<boolean> {
    return this.usersRepository.exists({
      where: {
        nickname: nickname.trim(),
      },
    });
  }

  async findById(userId: string): Promise<PublicUser | null> {
    const user = await this.usersRepository.findOneBy({ id: userId });

    return user ? this.toPublicUser(user) : null;
  }

  async findByEmail(email: string): Promise<PublicUser | null> {
    const user = await this.usersRepository.findOne({
      where: {
        email: this.normalizeEmail(email),
      },
    });

    return user ? this.toPublicUser(user) : null;
  }

  async createUser(input: CreateUserInput): Promise<PublicUser> {
    const email = this.normalizeEmail(input.email);
    const nickname = input.nickname.trim();

    if (await this.existsByEmail(email)) {
      throw new ConflictException('이미 가입된 이메일입니다.');
    }

    if (await this.existsByNickname(nickname)) {
      throw new ConflictException('이미 사용 중인 닉네임입니다.');
    }

    const user = this.usersRepository.create({
      email,
      nickname,
      passwordHash: await hashPassword(input.password),
      profileImageUrl: input.profileImageUrl ?? null,
    });

    try {
      const savedUser = await this.usersRepository.save(user);

      return this.toPublicUser(savedUser);
    } catch (error) {
      if (this.isUniqueViolation(error, 'users_email_key')) {
        throw new ConflictException('이미 가입된 이메일입니다.');
      }

      if (this.isUniqueViolation(error, 'users_nickname_key')) {
        throw new ConflictException('이미 사용 중인 닉네임입니다.');
      }

      throw error;
    }
  }

  async createSocialUser(input: CreateSocialUserInput): Promise<PublicUser> {
    const nickname = await this.createAvailableNickname(input.nickname);

    return this.createUser({
      email: input.email,
      nickname,
      password: randomBytes(32).toString('hex'),
      profileImageUrl: input.profileImageUrl ?? null,
    });
  }

  async validateCredentials(
    email: string,
    password: string,
  ): Promise<PublicUser | null> {
    const user = await this.usersRepository.findOne({
      where: {
        email: this.normalizeEmail(email),
      },
    });

    if (!user) {
      return null;
    }

    const isValidPassword = await verifyPassword(password, user.passwordHash);

    if (!isValidPassword) {
      return null;
    }

    return this.toPublicUser(user);
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private async createAvailableNickname(nickname: string): Promise<string> {
    const baseNickname = this.normalizeNickname(nickname);

    if (!(await this.existsByNickname(baseNickname))) {
      return baseNickname;
    }

    for (let index = 1; index <= 20; index += 1) {
      const suffix = randomBytes(2).toString('hex');
      const candidate = `${baseNickname}-${suffix}`.slice(0, 50);

      if (!(await this.existsByNickname(candidate))) {
        return candidate;
      }
    }

    return `tailtalk-${randomBytes(8).toString('hex')}`.slice(0, 50);
  }

  private normalizeNickname(nickname: string): string {
    const normalized = nickname.trim().replace(/\s+/g, ' ').slice(0, 50);

    return normalized || `tailtalk-${randomBytes(4).toString('hex')}`;
  }

  private toPublicUser(user: UserEntity): PublicUser {
    return {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      createdAt: user.createdAt,
      profileImageUrl: user.profileImageUrl,
    };
  }

  private isUniqueViolation(error: unknown, constraint: string): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const databaseError = error as Record<string, unknown>;

    return (
      databaseError.code === '23505' && databaseError.constraint === constraint
    );
  }
}
