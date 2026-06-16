# 2026년 6월 10일 수요일 학습 문서

> 주제: 화요일에 못 한 게시글 CRUD 마감 + JWT 인증 + React API 연결  
> 목표: 브라우저에서 로그인한 사용자가 운동 기록을 작성하고, 목록과 상세 화면에서 확인할 수 있게 한다.

---

# 0. 오늘의 결론

현재 월요일 목표였던 게시글 생성/목록/상세 조회는 끝났다.

실제로 확인된 것:

```text
POST /posts      성공
GET /posts       성공
GET /posts/:id   성공
```

하지만 화요일 목표였던 아래 항목은 아직 코드에 없다.

```text
PATCH /posts/:id
DELETE /posts/:id
운동 기록 표 저장 보완
```

그래서 오늘 수요일은 원래 수요일 목표였던 인증과 React 연결을 바로 시작하지 않고, 먼저 화요일에 못 한 게시글 CRUD 마감을 앞에 붙인다.

오늘 작업 순서는 아래처럼 간다.

```text
1. 게시글 수정 API 추가
2. 게시글 삭제 API 추가
3. User seed / demo user 구조 정리
4. 회원가입 API 추가
5. 로그인 API 추가
6. JWT 발급
7. JWT Guard 추가
8. 게시글 작성자를 JWT 사용자로 연결
9. 작성자만 수정/삭제 가능하게 처리
10. React에서 로그인/작성/목록 조회 연결
```

오늘 핵심은 이것이다.

```text
브라우저에서 로그인한다.
        ↓
JWT 토큰을 받는다.
        ↓
운동 기록 작성 화면에서 기록을 입력한다.
        ↓
React가 NestJS API로 POST /posts 요청을 보낸다.
        ↓
NestJS가 JWT로 사용자를 확인한다.
        ↓
Prisma가 PostgreSQL에 운동 기록을 저장한다.
        ↓
목록/상세 화면에서 저장된 기록을 확인한다.
```

---

# 1. 오늘 범위

## 1.1 화요일 작업 끌어오기

화요일 로드맵의 저녁 작업은 아래였다.

| 작업 | 현재 상태 | 오늘 처리 |
| --- | --- | --- |
| 월요일 게시글 API 보완 | 생성/조회 검증 완료 | 유지 |
| 게시글 수정 API | 없음 | 오늘 추가 |
| 게시글 삭제 API | 없음 | 오늘 추가 |
| 운동 기록 표 저장 버그 확인 | 기본 저장 성공 | 수정 API에서 같이 점검 |

## 1.2 수요일 원래 작업

수요일 로드맵의 원래 목표는 인증과 React 연결이다.

## Backend

| 작업 | 오늘 할 것 |
| --- | --- |
| 회원가입 API | `POST /auth/signup` |
| 로그인 API | `POST /auth/login` |
| JWT 발급 | 로그인 성공 시 accessToken 반환 |
| JWT Guard | 보호된 API에 토큰 검사 적용 |
| 내 정보 조회 API | `GET /auth/me` |
| 작성자 권한 처리 | 본인 글만 수정/삭제 가능 |

## Frontend

| 작업 | 오늘 할 것 |
| --- | --- |
| 회원가입 화면 | `/signup` |
| 로그인 화면 | `/login` |
| JWT 저장 | `localStorage` |
| 게시글 목록 API 연결 | `/posts` |
| 게시글 작성 API 연결 | `/posts/new` |
| 게시글 상세 화면 연결 | `/posts/:id` |

---

# 2. 현재 프로젝트 상태

현재 프로젝트 위치:

```bash
/Users/igyeong-geun/Documents/jungle/week15/ai-workout-board
```

현재 주요 파일:

```text
backend/
  prisma/
    schema.prisma
    migrations/
  src/
    app.module.ts
    prisma/
      prisma.module.ts
      prisma.service.ts
    posts/
      dto/
        create-post.dto.ts
        create-exercise.dto.ts
        create-set.dto.ts
      posts.module.ts
      posts.controller.ts
      posts.service.ts

frontend/
  src/
    App.tsx
    pages/
      PostListPage.tsx
      PostCreatePage.tsx
```

현재 백엔드에 있는 API:

```text
GET  /
GET  /health
POST /posts
GET  /posts
GET  /posts/:id
```

오늘 끝나면 최소한 아래 API까지 늘어나야 한다.

```text
POST   /auth/signup
POST   /auth/login
GET    /auth/me

POST   /posts
GET    /posts
GET    /posts/:id
PATCH  /posts/:id
DELETE /posts/:id
```

---

# 3. 오늘 작업 브랜치

현재 브랜치가 이미 이슈 브랜치일 가능성이 높다.

확인:

```bash
cd /Users/igyeong-geun/Documents/jungle/week15/ai-workout-board
git branch --show-current
git status --short
```

현재 브랜치가 `feat/2-post-api`라면 그대로 진행해도 된다.

만약 새 브랜치로 나누고 싶다면:

```bash
git switch -c feat/auth-react-connect
```

하지만 지금 흐름에서는 월요일/화요일/수요일 작업이 이어져 있으므로, 아직 PR을 안 올렸다면 현재 브랜치에서 마저 닫아도 된다.

---

# 4. 필요한 패키지 설치

오늘 인증을 위해 백엔드에 패키지를 추가한다.

```bash
cd backend
npm install @nestjs/jwt bcrypt
npm install -D @types/bcrypt
```

각 패키지 의미:

| 패키지 | 의미 |
| --- | --- |
| `@nestjs/jwt` | NestJS에서 JWT 토큰을 만들고 검증하는 도구 |
| `bcrypt` | 비밀번호를 그대로 저장하지 않고 해시로 바꾸는 도구 |
| `@types/bcrypt` | TypeScript가 bcrypt 타입을 이해하게 해주는 개발용 타입 |

비밀번호는 절대 DB에 그대로 저장하지 않는다.

나쁜 예:

```text
password: "1234"
```

좋은 예:

```text
passwordHash: "$2b$10$...."
```

---

# 5. 화요일 끌어온 작업 1: 게시글 수정 API

## 5.1 수정 API 주소

게시글 수정 API는 아래처럼 만든다.

```text
PATCH /posts/:id
```

예:

```text
PATCH /posts/1
```

뜻:

```text
id가 1인 게시글을 수정한다.
```

`PATCH`는 일부 수정에 쓰는 HTTP method다.

오늘은 단순하게 간다.

```text
게시글 기본 정보만 바꾸거나,
운동 목록이 들어오면 기존 운동/세트를 지우고 새로 만든다.
```

운동 세트 하나하나를 부분 수정하는 방식은 복잡하다.  
오늘은 MVP이므로 **운동 기록 전체 교체 방식**이 더 낫다.

## 5.2 Update DTO 만들기

파일 생성:

```bash
touch backend/src/posts/dto/update-post.dto.ts
```

추천 코드:

```ts
import { PartialType } from '@nestjs/mapped-types';
import { CreatePostDto } from './create-post.dto';

export class UpdatePostDto extends PartialType(CreatePostDto) {}
```

이 코드가 안 되면 패키지를 설치한다.

```bash
cd backend
npm install @nestjs/mapped-types
```

뜻:

```text
CreatePostDto의 모든 필드를 선택 사항으로 바꾼 DTO를 만든다.
```

게시글 생성은 제목, 날짜, 운동 부위, 운동 목록이 필수다.

하지만 수정은 제목만 바꿀 수도 있다.

그래서 update DTO에서는 모든 값이 optional이어야 한다.

## 5.3 Controller에 PATCH 추가

파일:

```text
backend/src/posts/posts.controller.ts
```

추가 import:

```ts
import { Patch } from '@nestjs/common';
import { UpdatePostDto } from './dto/update-post.dto';
```

기존 import가 한 줄이면 합쳐서 정리한다.

```ts
import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
```

Controller 안에 추가:

```ts
@Patch(':id')
update(
  @Param('id', ParseIntPipe) id: number,
  @Body() updatePostDto: UpdatePostDto,
) {
  return this.postsService.update(id, updatePostDto);
}
```

흐름:

```text
PATCH /posts/1 요청이 들어온다.
        ↓
id 값 1을 숫자로 바꾼다.
        ↓
request body를 UpdatePostDto로 받는다.
        ↓
PostsService.update(1, body)를 실행한다.
```

## 5.4 Service에 update 추가

파일:

```text
backend/src/posts/posts.service.ts
```

추가 import:

```ts
import { UpdatePostDto } from './dto/update-post.dto';
```

기본 구조:

```ts
async update(id: number, updatePostDto: UpdatePostDto) {
  const post = await this.prisma.post.findUnique({
    where: { id },
  });

  if (!post) {
    throw new NotFoundException('게시글을 찾을 수 없습니다.');
  }

  return this.prisma.post.update({
    where: { id },
    data: {
      title: updatePostDto.title,
      date: updatePostDto.date
        ? new Date(updatePostDto.date)
        : undefined,
      bodyPart: updatePostDto.bodyPart,
      memo: updatePostDto.memo,
    },
    include: postInclude,
  });
}
```

주의:

```ts
undefined
```

Prisma update에서 `undefined`는 보통 “이 필드는 건드리지 않는다”에 가깝게 동작한다.

반대로 `null`은 “값을 비운다”는 의미가 될 수 있다.

오늘은 헷갈리면 이렇게 생각한다.

```text
undefined = 수정 안 함
null      = 비움
```

## 5.5 운동 목록까지 수정하려면

운동 목록과 세트까지 수정하려면 조금 복잡하다.

오늘은 가장 단순한 전략을 쓴다.

```text
exercises가 요청 body에 있으면
기존 exercises를 전부 삭제한다.
Exercise 삭제 시 Set도 cascade로 같이 삭제된다.
새 exercises와 sets를 다시 생성한다.
```

대략 흐름:

```ts
if (updatePostDto.exercises) {
  await this.prisma.exercise.deleteMany({
    where: { postId: id },
  });
}
```

그다음 update의 data 안에 새 exercises를 넣는다.

```ts
exercises: updatePostDto.exercises
  ? {
      create: updatePostDto.exercises.map((exercise, index) => ({
        exerciseName: exercise.exerciseName,
        normalizedName: exercise.exerciseName.trim().toLowerCase(),
        weightKg: exercise.weightKg,
        targetReps: exercise.targetReps,
        orderIndex: exercise.orderIndex ?? index,
        memo: exercise.memo,
        sets: {
          create: exercise.sets.map((set) => ({
            setNumber: set.setNumber,
            reps: set.reps,
            perceivedDifficulty: set.perceivedDifficulty,
          })),
        },
      })),
    }
  : undefined,
```

이 방식은 세밀하지는 않지만 MVP에는 충분하다.

---

# 6. 화요일 끌어온 작업 2: 게시글 삭제 API

## 6.1 삭제 API 주소

```text
DELETE /posts/:id
```

예:

```text
DELETE /posts/1
```

뜻:

```text
id가 1인 게시글을 삭제한다.
```

## 6.2 Controller에 DELETE 추가

추가 import:

```ts
import { Delete } from '@nestjs/common';
```

Controller 안에 추가:

```ts
@Delete(':id')
remove(@Param('id', ParseIntPipe) id: number) {
  return this.postsService.remove(id);
}
```

## 6.3 Service에 remove 추가

```ts
async remove(id: number) {
  const post = await this.prisma.post.findUnique({
    where: { id },
  });

  if (!post) {
    throw new NotFoundException('게시글을 찾을 수 없습니다.');
  }

  await this.prisma.post.delete({
    where: { id },
  });

  return {
    deleted: true,
    id,
  };
}
```

Prisma schema에서 관계가 아래처럼 되어 있다.

```prisma
post Post @relation(fields: [postId], references: [id], onDelete: Cascade)
```

뜻:

```text
Post가 삭제되면
연결된 Exercise도 같이 삭제된다.
Exercise가 삭제되면
연결된 Set도 같이 삭제된다.
```

그래서 게시글 삭제 시 운동/세트가 같이 정리된다.

---

# 7. 수요일 작업 1: AuthModule 만들기

오늘 인증 기능은 `auth` 폴더로 분리한다.

파일 구조:

```text
backend/src/auth/
  auth.module.ts
  auth.controller.ts
  auth.service.ts
  jwt-auth.guard.ts
  dto/
    signup.dto.ts
    login.dto.ts
```

생성 명령:

```bash
mkdir -p backend/src/auth/dto
touch backend/src/auth/auth.module.ts
touch backend/src/auth/auth.controller.ts
touch backend/src/auth/auth.service.ts
touch backend/src/auth/jwt-auth.guard.ts
touch backend/src/auth/dto/signup.dto.ts
touch backend/src/auth/dto/login.dto.ts
```

## 7.1 AuthModule

파일:

```text
backend/src/auth/auth.module.ts
```

코드:

```ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') ?? 'dev-secret',
        signOptions: {
          expiresIn: '1d',
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
```

중요한 부분:

```ts
JwtModule.registerAsync(...)
```

JWT 설정을 `.env`에서 읽어서 등록하는 코드다.

개발 중에는 `dev-secret`으로 fallback을 두지만, 실제로는 `.env`에 넣어야 한다.

## 7.2 AppModule에 AuthModule 등록

파일:

```text
backend/src/app.module.ts
```

추가:

```ts
import { AuthModule } from './auth/auth.module';
```

imports 배열에 추가:

```ts
imports: [
  ConfigModule.forRoot({
    isGlobal: true,
  }),
  PrismaModule,
  PostsModule,
  AuthModule,
],
```

이렇게 해야 NestJS가 auth 기능을 앱에 연결한다.

---

# 8. 수요일 작업 2: .env에 JWT_SECRET 추가

파일:

```text
backend/.env
```

추가:

```env
JWT_SECRET="dev-jwt-secret-change-later"
```

전체 예시:

```env
DATABASE_URL="postgresql://workout:workout@localhost:5432/workout_board?schema=public"
PORT=3000
JWT_SECRET="dev-jwt-secret-change-later"
```

주의:

```text
JWT_SECRET은 실제 서비스에서 절대 공개하면 안 되는 값이다.
```

지금은 개발용이라 단순하게 둔다.

---

# 9. 수요일 작업 3: 회원가입 DTO

파일:

```text
backend/src/auth/dto/signup.dto.ts
```

코드:

```ts
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class SignupDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  nickname: string;

  @IsString()
  @MinLength(6)
  password: string;
}
```

뜻:

| 필드 | 규칙 |
| --- | --- |
| `email` | 이메일 형식이어야 함 |
| `nickname` | 빈 문자열이면 안 됨 |
| `password` | 최소 6글자 |

---

# 10. 수요일 작업 4: 로그인 DTO

파일:

```text
backend/src/auth/dto/login.dto.ts
```

코드:

```ts
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;
}
```

로그인은 이메일과 비밀번호만 있으면 된다.

---

# 11. 수요일 작업 5: AuthService

파일:

```text
backend/src/auth/auth.service.ts
```

코드 구조:

```ts
import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async signup(signupDto: SignupDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: {
        email: signupDto.email,
      },
    });

    if (existingUser) {
      throw new ConflictException('이미 가입된 이메일입니다.');
    }

    const passwordHash = await bcrypt.hash(signupDto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: signupDto.email,
        nickname: signupDto.nickname,
        passwordHash,
      },
      select: {
        id: true,
        email: true,
        nickname: true,
        createdAt: true,
      },
    });

    return user;
  }

  async login(loginDto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: {
        email: loginDto.email,
      },
    });

    if (!user) {
      throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다.');
    }

    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다.');
    }

    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      nickname: user.nickname,
    });

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        nickname: user.nickname,
      },
    };
  }
}
```

핵심 흐름:

```text
회원가입:
email 중복 확인
        ↓
password를 bcrypt로 hash
        ↓
User 생성
        ↓
passwordHash는 응답에서 제외

로그인:
email로 사용자 조회
        ↓
bcrypt.compare로 비밀번호 확인
        ↓
JWT accessToken 생성
        ↓
토큰과 사용자 정보 반환
```

---

# 12. 수요일 작업 6: AuthController

파일:

```text
backend/src/auth/auth.controller.ts
```

코드:

```ts
import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

type AuthenticatedRequest = Request & {
  user: {
    userId: number;
    email: string;
    nickname: string;
  };
};

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  signup(@Body() signupDto: SignupDto) {
    return this.authService.signup(signupDto);
  }

  @Post('login')
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMe(@Req() request: AuthenticatedRequest) {
    return request.user;
  }
}
```

주소:

```text
POST /auth/signup
POST /auth/login
GET  /auth/me
```

`GET /auth/me`는 로그인한 사용자의 정보를 확인하는 API다.

---

# 13. 수요일 작업 7: JwtAuthGuard

파일:

```text
backend/src/auth/jwt-auth.guard.ts
```

코드:

```ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('인증 토큰이 없습니다.');
    }

    try {
      const payload = await this.jwtService.verifyAsync(token);

      request['user'] = {
        userId: payload.sub,
        email: payload.email,
        nickname: payload.nickname,
      };
    } catch {
      throw new UnauthorizedException('유효하지 않은 토큰입니다.');
    }

    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
```

JWT 요청 형식:

```http
Authorization: Bearer <accessToken>
```

예:

```bash
curl http://localhost:3000/auth/me \
  -H "Authorization: Bearer 여기에_토큰"
```

흐름:

```text
요청 header에서 Authorization을 꺼낸다.
        ↓
Bearer 토큰인지 확인한다.
        ↓
JWT_SECRET으로 토큰을 검증한다.
        ↓
payload에서 userId/email/nickname을 꺼낸다.
        ↓
request.user에 저장한다.
        ↓
Controller에서 request.user를 사용할 수 있다.
```

---

# 14. 수요일 작업 8: 게시글 작성자를 JWT 사용자로 바꾸기

현재 `PostsService.create()`는 내부에서 데모 사용자를 만든다.

현재 흐름:

```text
POST /posts
        ↓
getDemoUser()
        ↓
demo@board.local 사용자로 글 작성
```

인증을 붙이면 이 흐름은 바뀌어야 한다.

목표 흐름:

```text
POST /posts
Authorization: Bearer token
        ↓
JwtAuthGuard가 토큰 확인
        ↓
request.user.userId 확인
        ↓
해당 userId로 게시글 작성
```

## 14.1 PostsController 수정

필요 import:

```ts
import { Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
```

타입:

```ts
type AuthenticatedRequest = Request & {
  user: {
    userId: number;
    email: string;
    nickname: string;
  };
};
```

create 수정:

```ts
@UseGuards(JwtAuthGuard)
@Post()
create(
  @Req() request: AuthenticatedRequest,
  @Body() createPostDto: CreatePostDto,
) {
  return this.postsService.create(request.user.userId, createPostDto);
}
```

## 14.2 PostsService 수정

기존:

```ts
async create(createPostDto: CreatePostDto) {
  const author = await this.getDemoUser();

  return this.prisma.post.create({
    data: {
      authorId: author.id,
      ...
    },
  });
}
```

변경:

```ts
async create(authorId: number, createPostDto: CreatePostDto) {
  return this.prisma.post.create({
    data: {
      authorId,
      ...
    },
  });
}
```

이제 데모 유저가 아니라 로그인한 사용자의 id로 게시글이 생성된다.

---

# 15. 수요일 작업 9: 수정/삭제 권한 처리

수정/삭제는 작성자만 가능해야 한다.

예:

```text
1번 사용자가 작성한 글을
2번 사용자가 삭제하면 안 된다.
```

Service에 권한 검사를 넣는다.

필요 import:

```ts
import { ForbiddenException } from '@nestjs/common';
```

검사 흐름:

```ts
const post = await this.prisma.post.findUnique({
  where: { id },
});

if (!post) {
  throw new NotFoundException('게시글을 찾을 수 없습니다.');
}

if (post.authorId !== authorId) {
  throw new ForbiddenException('본인이 작성한 게시글만 수정할 수 있습니다.');
}
```

수정:

```ts
async update(
  id: number,
  authorId: number,
  updatePostDto: UpdatePostDto,
) {
  ...
}
```

삭제:

```ts
async remove(id: number, authorId: number) {
  ...
}
```

Controller도 request.user.userId를 넘기도록 바꾼다.

```ts
@UseGuards(JwtAuthGuard)
@Patch(':id')
update(
  @Req() request: AuthenticatedRequest,
  @Param('id', ParseIntPipe) id: number,
  @Body() updatePostDto: UpdatePostDto,
) {
  return this.postsService.update(id, request.user.userId, updatePostDto);
}

@UseGuards(JwtAuthGuard)
@Delete(':id')
remove(
  @Req() request: AuthenticatedRequest,
  @Param('id', ParseIntPipe) id: number,
) {
  return this.postsService.remove(id, request.user.userId);
}
```

---

# 16. 수요일 작업 10: API 테스트 순서

## 16.1 회원가입

```bash
curl -X POST http://localhost:3000/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user1@example.com",
    "nickname": "운동초보",
    "password": "password123"
  }'
```

정상 결과:

```json
{
  "id": 2,
  "email": "user1@example.com",
  "nickname": "운동초보",
  "createdAt": "..."
}
```

## 16.2 로그인

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user1@example.com",
    "password": "password123"
  }'
```

정상 결과:

```json
{
  "accessToken": "긴.jwt.문자열",
  "user": {
    "id": 2,
    "email": "user1@example.com",
    "nickname": "운동초보"
  }
}
```

토큰을 변수에 저장할 수 있다.

```bash
TOKEN="여기에_accessToken_붙여넣기"
```

## 16.3 내 정보 조회

```bash
curl http://localhost:3000/auth/me \
  -H "Authorization: Bearer $TOKEN"
```

정상 결과:

```json
{
  "userId": 2,
  "email": "user1@example.com",
  "nickname": "운동초보"
}
```

## 16.4 로그인한 사용자로 게시글 작성

```bash
curl -X POST http://localhost:3000/posts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "title": "오늘 가슴 운동",
    "date": "2026-06-10",
    "bodyPart": "가슴",
    "memo": "마지막 세트가 힘들었다.",
    "exercises": [
      {
        "exerciseName": "벤치프레스",
        "weightKg": 60,
        "targetReps": 8,
        "sets": [
          { "setNumber": 1, "reps": 8 },
          { "setNumber": 2, "reps": 8 },
          { "setNumber": 3, "reps": 7 }
        ]
      }
    ]
  }'
```

정상 결과:

```text
author.id가 로그인한 사용자 id와 같아야 한다.
```

## 16.5 게시글 수정

```bash
curl -X PATCH http://localhost:3000/posts/1 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "memo": "수정된 메모"
  }'
```

## 16.6 게시글 삭제

```bash
curl -X DELETE http://localhost:3000/posts/1 \
  -H "Authorization: Bearer $TOKEN"
```

정상 결과:

```json
{
  "deleted": true,
  "id": 1
}
```

---

# 17. React 연결 전략

오늘 프론트엔드는 예쁘게 만들지 않는다.

목표는 API 연결이다.

필요한 화면:

```text
/signup       회원가입
/login        로그인
/posts        게시글 목록
/posts/new    게시글 작성
/posts/:id    게시글 상세
```

## 17.1 API helper 만들기

파일:

```text
frontend/src/api/client.ts
```

생성:

```bash
mkdir -p frontend/src/api
touch frontend/src/api/client.ts
```

코드:

```ts
const API_BASE_URL = 'http://localhost:3000';

export function getAccessToken() {
  return localStorage.getItem('accessToken');
}

export function saveAccessToken(token: string) {
  localStorage.setItem('accessToken', token);
}

export async function apiFetch(path: string, options: RequestInit = {}) {
  const token = getAccessToken();

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`API 요청 실패: ${response.status}`);
  }

  return response.json();
}
```

뜻:

```text
매번 fetch에 Authorization header를 직접 쓰기 귀찮다.
apiFetch 하나로 모아서 쓴다.
```

## 17.2 로그인 페이지

파일:

```text
frontend/src/pages/LoginPage.tsx
```

역할:

```text
email/password 입력
        ↓
POST /auth/login
        ↓
accessToken 저장
        ↓
/posts로 이동
```

최소 코드 흐름:

```tsx
import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { apiFetch, saveAccessToken } from '../api/client';

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const result = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    saveAccessToken(result.accessToken);
    navigate('/posts');
  }

  return (
    <main>
      <h1>로그인</h1>
      <form onSubmit={handleSubmit}>
        <input value={email} onChange={(event) => setEmail(event.target.value)} />
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <button type="submit">로그인</button>
      </form>
    </main>
  );
}
```

## 17.3 게시글 목록 페이지

현재 `PostListPage`는 뼈대만 있다.

오늘은 `GET /posts`를 붙인다.

필요한 흐름:

```text
페이지가 열린다.
        ↓
useEffect가 실행된다.
        ↓
GET /posts 요청
        ↓
posts state에 저장
        ↓
화면에 map으로 출력
```

## 17.4 게시글 작성 페이지

오늘 작성 페이지는 복잡한 동적 폼까지 욕심내지 않는다.

처음에는 고정 입력부터 한다.

필수 입력:

```text
title
date
bodyPart
exerciseName
weightKg
set1 reps
set2 reps
set3 reps
memo
```

React가 백엔드로 보낼 JSON:

```json
{
  "title": "오늘 가슴 운동",
  "date": "2026-06-10",
  "bodyPart": "가슴",
  "memo": "마지막 세트가 힘들었다.",
  "exercises": [
    {
      "exerciseName": "벤치프레스",
      "weightKg": 60,
      "targetReps": 8,
      "sets": [
        { "setNumber": 1, "reps": 8 },
        { "setNumber": 2, "reps": 8 },
        { "setNumber": 3, "reps": 7 }
      ]
    }
  ]
}
```

처음에는 운동 하나, 세트 세 개로 고정해도 된다.

동적으로 운동 추가, 세트 추가는 나중에 한다.

---

# 18. 오늘 완료 기준

오늘 완료 기준은 아래다.

## Backend

- [ ] `PATCH /posts/:id`가 동작한다.
- [ ] `DELETE /posts/:id`가 동작한다.
- [ ] `POST /auth/signup`이 동작한다.
- [ ] `POST /auth/login`이 accessToken을 반환한다.
- [ ] `GET /auth/me`가 토큰으로 사용자 정보를 반환한다.
- [ ] 로그인한 사용자로 `POST /posts`를 작성할 수 있다.
- [ ] 본인 글만 수정/삭제할 수 있다.

## Frontend

- [ ] `/signup` 화면이 있다.
- [ ] `/login` 화면이 있다.
- [ ] 로그인하면 accessToken이 저장된다.
- [ ] `/posts`에서 게시글 목록이 보인다.
- [ ] `/posts/new`에서 게시글을 작성할 수 있다.
- [ ] 작성 후 목록 또는 상세 화면에서 확인할 수 있다.

## 검증

```bash
cd backend
npm run test -- --runInBand
npm run build

cd ../frontend
npm run build
```

둘 다 통과해야 한다.

---

# 19. 오늘 절대 하지 말 것

오늘은 욕심내면 망한다.

오늘 하지 말 것:

```text
예쁜 UI
운동 추가/삭제 동적 폼 완성
AI 분석
RAG
MCP
Agent
AWS 배포
복잡한 권한 시스템
소셜 로그인
```

오늘 목표는 단순하다.

```text
로그인한 사용자가 운동 기록을 작성하고
그 기록을 화면에서 볼 수 있게 만든다.
```

여기까지 되면 수요일 목표는 충분히 성공이다.

