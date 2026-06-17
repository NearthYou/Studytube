import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';

@Injectable()
// 사용자 DB 접근(사용자 조회/생성)
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  // 이메일로 사용자 찾기(회원가입 중복 체크, 로그인 시 사용자 조회)
  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  // ID로 사용자 찾기(GET /auth/me에서 현재 사용자 조회)
  findById(id: bigint) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  // 사용자 만들기(회원가입 시 새 사용자 저장)
  create(data: { email: string; passwordHash: string; nickname: string }) {
    return this.prisma.user.create({ data });
  }

  // API 응답용 공개 사용자 객체로 변환하기(passwordHash 같은 민감한 정보를 제외하고 반환)
  toPublicUser(user: { id: bigint; email: string; nickname: string }) {
    return {
      id: user.id.toString(), // 사용자 ID(bigint) 문자열로 바꿔줌
      email: user.email,
      nickname: user.nickname,
    };
  }
}
