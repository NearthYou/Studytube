# 2026년 6월 11일 목요일 학습 문서

> 주제: NestJS에서 회원가입, 로그인, JWT 인증, 작성자 권한 처리 구현  
> 목표: “왜 이렇게 만드는지” 이해하면서, 그대로 따라 쳐서 인증 기능을 붙인다.

---

# 0. 오늘 만드는 것

오늘 만드는 것은 게시판의 인증 기능이다.

한 문장으로 말하면:

```text
로그인한 사용자가 자기 계정으로 게시글을 작성하고,
자기가 쓴 글만 수정/삭제할 수 있게 만든다.
```

오늘 최종 흐름은 이렇다.

```text
회원가입
  ↓
로그인
  ↓
JWT accessToken 발급
  ↓
게시글 작성 요청에 token 포함
  ↓
백엔드가 token 검사
  ↓
token 안의 userId를 authorId로 저장
  ↓
수정/삭제할 때 authorId와 userId 비교
```

오늘 추가할 API:

```text
POST /auth/signup
POST /auth/login
GET  /auth/me
```

오늘 수정할 API:

```text
POST   /posts
PATCH  /posts/:id
DELETE /posts/:id
```

---

# 1. 왜 인증을 붙여야 하나?

현재 게시글 CRUD는 된다.

하지만 아직 이런 문제가 있다.

```text
백엔드가 “이 글을 누가 썼는지” 제대로 구분하지 못한다.
```

지금은 개발 편의를 위해 `demo@board.local`이라는 임시 사용자가 글을 쓰는 구조다.

이건 게시글 저장 기능을 먼저 만들 때는 괜찮다.

하지만 운동 기록 서비스에서는 곧 문제가 된다.

예를 들어 AI가 이렇게 분석해야 한다고 해보자.

```text
이 사용자의 지난 벤치프레스 기록은?
이번 기록이 지난번보다 좋아졌나?
다음 운동에서 무게를 올려도 되나?
```

이 질문에 답하려면 게시글이 실제 사용자와 연결되어 있어야 한다.

그래서 오늘은 `demo user`를 제거하고, 로그인한 사용자의 `id`를 게시글의 `authorId`로 저장한다.

---

# 2. 인증과 인가

오늘은 두 가지를 같이 다룬다.

```text
인증(Authentication)
인가(Authorization)
```

## 2.1 인증

인증은 “너 누구야?”를 확인하는 것이다.

예:

```text
이메일과 비밀번호가 맞다.
그러면 이 사람은 test@example.com 사용자다.
```

로그인이 인증이다.

## 2.2 인가

인가는 “너 이 작업 해도 돼?”를 확인하는 것이다.

예:

```text
1번 게시글 작성자: 철수
현재 요청한 사용자: 영희
요청: 1번 게시글 삭제
```

이 경우 백엔드는 막아야 한다.

```text
영희는 철수가 쓴 글을 삭제할 수 없다.
```

이게 인가다.

오늘은 이렇게 구현한다.

```text
로그인해서 사용자를 확인한다.          -> 인증
작성자만 수정/삭제하게 한다.          -> 인가
```

---

# 3. JWT는 무엇인가?

JWT는 로그인 성공 후 백엔드가 발급해주는 문자열이다.

대충 이런 모양이다.

```text
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

쉽게 말하면:

```text
로그인 성공 증명서
```

로그인할 때마다 이메일/비밀번호를 계속 보내는 것은 좋지 않다.

그래서 흐름을 이렇게 만든다.

```text
1. 사용자가 이메일/비밀번호로 로그인한다.
2. 백엔드가 비밀번호를 확인한다.
3. 맞으면 JWT를 발급한다.
4. 프론트엔드는 JWT를 저장한다.
5. 이후 요청부터 JWT를 같이 보낸다.
6. 백엔드는 JWT를 보고 사용자를 알아낸다.
```

JWT 안에는 보통 이런 정보가 들어간다.

```json
{
  "sub": 1,
  "email": "test@example.com"
}
```

여기서 `sub`는 subject의 줄임말이다.

실무에서는 보통 `sub`에 사용자 id를 넣는다.

즉:

```text
sub = 이 token의 주인 userId
```

---

# 4. Authorization Header

프론트엔드는 인증이 필요한 요청을 보낼 때 HTTP Header에 token을 넣는다.

형식은 이렇다.

```http
Authorization: Bearer accessToken
```

예:

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

의미는 이렇다.

```text
나 로그인한 사용자야.
증거로 이 token을 같이 보낼게.
```

백엔드는 이 header에서 token을 꺼내고 검증한다.

---

# 5. 오늘 만들 파일 구조

오늘 추가할 폴더와 파일은 이렇다.

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

각 파일 역할:

| 파일 | 역할 |
| --- | --- |
| `auth.module.ts` | Auth 기능 묶음을 NestJS에 등록 |
| `auth.controller.ts` | `/auth` 요청을 받음 |
| `auth.service.ts` | 회원가입, 로그인 실제 작업 |
| `jwt-auth.guard.ts` | JWT token 검사 |
| `signup.dto.ts` | 회원가입 요청 body 규칙 |
| `login.dto.ts` | 로그인 요청 body 규칙 |

기존 게시글 파일도 바뀐다.

```text
backend/src/posts/posts.controller.ts
backend/src/posts/posts.service.ts
backend/src/app.module.ts
```

---

# 6. 패키지 확인

오늘 필요한 패키지는 이 세 개다.

```text
@nestjs/jwt
bcrypt
@types/bcrypt
```

의미:

| 패키지 | 역할 |
| --- | --- |
| `@nestjs/jwt` | JWT를 만들고 검증하는 NestJS 도구 |
| `bcrypt` | 비밀번호를 hash로 만들고 비교하는 도구 |
| `@types/bcrypt` | TypeScript가 bcrypt 타입을 알 수 있게 해주는 도구 |

설치가 안 되어 있다면 백엔드 폴더에서 실행한다.

```bash
cd /Users/igyeong-geun/Documents/jungle/week15/ai-workout-board/backend

npm install @nestjs/jwt bcrypt
npm install -D @types/bcrypt
```

이미 설치되어 있으면 다시 하지 않아도 된다.

---

# 7. 환경변수 추가

JWT를 만들 때는 비밀 문자열이 필요하다.

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

`JWT_SECRET`은 도장 같은 역할이다.

백엔드가 token을 만들 때 이 값으로 서명한다.

나중에 token이 들어오면 같은 값으로 검증한다.

```text
이 token은 우리 서버가 만든 것이 맞나?
중간에 조작되지 않았나?
```

---

# 8. Auth 폴더 생성

먼저 파일을 만든다.

루트 폴더에서 실행한다.

```bash
mkdir -p backend/src/auth/dto
touch backend/src/auth/auth.module.ts
touch backend/src/auth/auth.controller.ts
touch backend/src/auth/auth.service.ts
touch backend/src/auth/jwt-auth.guard.ts
touch backend/src/auth/dto/signup.dto.ts
touch backend/src/auth/dto/login.dto.ts
```

이 명령어는 코드를 작성하는 것이 아니라, 빈 파일을 만드는 것이다.

---

# 9. SignupDto 작성

DTO는 요청 body의 모양을 정하는 클래스다.

회원가입 요청은 이런 모양으로 들어올 예정이다.

```json
{
  "email": "test@example.com",
  "password": "12345678",
  "nickname": "테스트"
}
```

이 요청 body의 규칙을 `SignupDto`로 만든다.

파일:

```text
backend/src/auth/dto/signup.dto.ts
```

코드:

```ts
import { IsEmail, IsString, MinLength } from 'class-validator';

export class SignupDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  nickname!: string;
}
```

코드 해석:

```text
@IsEmail()        email은 이메일 형식이어야 한다.
@IsString()       문자열이어야 한다.
@MinLength(8)     최소 8글자여야 한다.
email!: string    email은 문자열이고, 값은 요청 body에서 들어올 예정이다.
```

여기서 `!`는 TypeScript에게 이렇게 말하는 표시다.

```text
지금 이 클래스 안에서 직접 값을 넣지는 않지만,
실행 중에는 값이 들어올 거야.
```

DTO는 DB 테이블이 아니다.

DTO는 “요청으로 들어오는 데이터 규칙”이다.

---

# 10. LoginDto 작성

로그인 요청은 이런 모양으로 들어온다.

```json
{
  "email": "test@example.com",
  "password": "12345678"
}
```

파일:

```text
backend/src/auth/dto/login.dto.ts
```

코드:

```ts
import { IsEmail, IsString } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}
```

회원가입에는 `nickname`이 필요하다.

로그인에는 `email`, `password`만 있으면 된다.

그래서 DTO도 다르다.

---

# 11. AuthService 작성

Service는 실제 작업을 처리하는 곳이다.

`AuthService`는 인증 관련 작업을 맡는다.

오늘 필요한 기능:

```text
signup()    회원가입
login()     로그인
```

회원가입 흐름:

```text
email 중복 확인
  ↓
비밀번호 hash
  ↓
User 생성
  ↓
사용자 정보 반환
```

로그인 흐름:

```text
email로 User 찾기
  ↓
비밀번호 비교
  ↓
JWT 생성
  ↓
accessToken 반환
```

파일:

```text
backend/src/auth/auth.service.ts
```

코드:

```ts
import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';

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
      throw new BadRequestException('이미 가입된 이메일입니다.');
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

    const payload = {
      sub: user.id,
      email: user.email,
    };

    const accessToken = await this.jwtService.signAsync(payload);

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

중요한 부분 해석:

```ts
const existingUser = await this.prisma.user.findUnique(...)
```

DB에서 같은 이메일을 가진 사용자가 있는지 찾는다.

```ts
throw new BadRequestException(...)
```

이미 가입된 이메일이면 400 에러를 낸다.

```ts
const passwordHash = await bcrypt.hash(signupDto.password, 10);
```

비밀번호 원문을 hash로 바꾼다.

DB에는 원본 비밀번호를 저장하지 않는다.

```ts
select: {
  id: true,
  email: true,
  nickname: true,
  createdAt: true,
}
```

응답에 포함할 필드만 고른다.

`passwordHash`는 절대 응답으로 보내면 안 된다.

```ts
const payload = {
  sub: user.id,
  email: user.email,
};
```

JWT 안에 넣을 정보다.

`sub`에는 사용자 id를 넣는다.

```ts
const accessToken = await this.jwtService.signAsync(payload);
```

JWT를 만든다.

---

# 12. AuthController 작성

Controller는 HTTP 요청을 받는 입구다.

`AuthController`는 `/auth`로 시작하는 요청을 담당한다.

파일:

```text
backend/src/auth/auth.controller.ts
```

코드:

```ts
import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

type AuthenticatedRequest = Request & {
  user: {
    id: number;
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

코드 해석:

```ts
@Controller('auth')
```

이 Controller는 `/auth`로 시작하는 주소를 담당한다.

```ts
@Post('signup')
```

`POST /auth/signup` 요청을 받는다.

```ts
@Body() signupDto: SignupDto
```

요청 body를 `SignupDto` 모양으로 받는다.

```ts
return this.authService.signup(signupDto);
```

실제 회원가입 작업은 Service에게 맡긴다.

```ts
@UseGuards(JwtAuthGuard)
@Get('me')
```

`GET /auth/me`는 token 검사를 통과해야 실행된다.

```ts
return request.user;
```

Guard가 token을 확인한 뒤 `request.user`에 넣어둔 사용자 정보를 반환한다.

---

# 13. AuthModule 작성

Module은 기능 묶음 등록표다.

파일을 만들었다고 NestJS가 자동으로 쓰는 것이 아니다.

Controller와 Service를 Module에 등록해야 한다.

파일:

```text
backend/src/auth/auth.module.ts
```

코드:

```ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: '1d',
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [AuthService],
})
export class AuthModule {}
```

코드 해석:

```ts
imports: [PrismaModule, JwtModule.registerAsync(...)]
```

Auth 기능 안에서 Prisma와 JwtModule을 쓰겠다는 뜻이다.

```ts
controllers: [AuthController]
```

`AuthController`를 HTTP 요청 담당자로 등록한다.

```ts
providers: [AuthService, JwtAuthGuard]
```

NestJS가 만들어서 주입해줄 작업 객체들을 등록한다.

```ts
exports: [AuthService]
```

다른 모듈에서도 `AuthService`가 필요하면 사용할 수 있게 공개한다.

---

# 14. AppModule에 AuthModule 등록

AuthModule을 만들었더라도 아직 앱 전체에 연결한 것은 아니다.

루트 모듈인 `AppModule`에 import해야 한다.

파일:

```text
backend/src/app.module.ts
```

기존 import에 추가:

```ts
import { AuthModule } from './auth/auth.module';
```

`imports` 배열에 추가:

```ts
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    PostsModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

이렇게 해야 NestJS 앱에 `/auth/signup`, `/auth/login`, `/auth/me`가 실제로 열린다.

---

# 15. JwtAuthGuard 작성

Guard는 Controller가 실행되기 전에 요청을 검사한다.

JWT Guard는 이런 일을 한다.

```text
Authorization header 확인
  ↓
Bearer token 꺼내기
  ↓
JWT 검증
  ↓
userId로 사용자 조회
  ↓
request.user에 사용자 정보 넣기
  ↓
Controller 실행 허용
```

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
import { PrismaService } from '../prisma/prisma.service';

type AuthenticatedRequest = Request & {
  user?: {
    id: number;
    email: string;
    nickname: string;
  };
};

type JwtPayload = {
  sub: number;
  email: string;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('로그인이 필요합니다.');
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);

      const user = await this.prisma.user.findUnique({
        where: {
          id: payload.sub,
        },
        select: {
          id: true,
          email: true,
          nickname: true,
        },
      });

      if (!user) {
        throw new UnauthorizedException('사용자를 찾을 수 없습니다.');
      }

      request.user = user;

      return true;
    } catch {
      throw new UnauthorizedException('유효하지 않은 토큰입니다.');
    }
  }

  private extractTokenFromHeader(request: Request) {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];

    return type === 'Bearer' ? token : undefined;
  }
}
```

코드 해석:

```ts
export class JwtAuthGuard implements CanActivate
```

이 클래스는 Guard 역할을 한다.

`CanActivate`는 “이 요청을 통과시킬 수 있는지 판단하는 기능”이라고 보면 된다.

```ts
const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
```

현재 HTTP 요청 객체를 꺼낸다.

```ts
const token = this.extractTokenFromHeader(request);
```

`Authorization: Bearer ...`에서 token만 꺼낸다.

```ts
const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
```

JWT가 정상인지 검증한다.

```ts
id: payload.sub
```

JWT 안의 `sub`가 사용자 id다.

```ts
request.user = user;
```

요청 객체에 사용자 정보를 붙인다.

이 덕분에 Controller에서 `request.user.id`를 사용할 수 있다.

---

# 16. PostsController에 인증 적용

이제 게시글 작성, 수정, 삭제에 인증을 붙인다.

현재는 이런 흐름이다.

```text
body만 받아서 게시글 작성
```

인증을 붙이면 이렇게 바뀐다.

```text
token 검사
  ↓
request.user.id 확인
  ↓
body와 userId를 Service에 전달
```

파일:

```text
backend/src/posts/posts.controller.ts
```

전체 코드 예시:

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { PostsService } from './posts.service';

type AuthenticatedRequest = Request & {
  user: {
    id: number;
    email: string;
    nickname: string;
  };
};

@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Body() createPostDto: CreatePostDto,
  ) {
    return this.postsService.create(request.user.id, createPostDto);
  }

  @Get()
  findAll() {
    return this.postsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.postsService.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() updatePostDto: UpdatePostDto,
  ) {
    return this.postsService.update(request.user.id, id, updatePostDto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.postsService.remove(request.user.id, id);
  }
}
```

코드 해석:

```ts
@UseGuards(JwtAuthGuard)
```

이 API는 먼저 JWT 검사를 통과해야 한다.

```ts
@Req() request: AuthenticatedRequest
```

HTTP 요청 전체를 받는다.

Guard가 `request.user`를 붙여두었기 때문에 여기서 로그인한 사용자를 알 수 있다.

```ts
request.user.id
```

현재 로그인한 사용자의 id다.

```ts
this.postsService.create(request.user.id, createPostDto)
```

게시글 내용뿐 아니라 작성자 id도 같이 Service로 보낸다.

---

# 17. PostsService에서 demo user 제거

이제 `demo@board.local`을 사용할 필요가 없다.

게시글 작성자는 token에서 온 `userId`로 정한다.

파일:

```text
backend/src/posts/posts.service.ts
```

먼저 import에 `ForbiddenException`을 추가한다.

```ts
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
```

`getDemoUser()` 함수는 제거한다.

기존:

```ts
private async getDemoUser() {
  return this.prisma.user.upsert({
    where: {
      email: 'demo@board.local',
    },
    update: {},
    create: {
      email: 'demo@board.local',
      nickname: '데모 사용자',
      passwordHash: 'not-used-yet',
    },
  });
}
```

이제 필요 없다.

`create()` 함수는 이렇게 바꾼다.

```ts
async create(userId: number, createPostDto: CreatePostDto) {
  return this.prisma.post.create({
    data: {
      authorId: userId,
      title: createPostDto.title,
      date: new Date(createPostDto.date),
      bodyPart: createPostDto.bodyPart,
      memo: createPostDto.memo,
      exercises: {
        create: createPostDto.exercises.map((exercise, index) => ({
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
      },
    },
    include: postInclude,
  });
}
```

핵심 변화:

```ts
authorId: userId
```

이제 작성자가 demo user가 아니라 로그인한 사용자다.

---

# 18. PostsService에서 작성자 권한 검사

수정과 삭제는 작성자만 할 수 있어야 한다.

검사 기준은 단순하다.

```text
post.authorId === userId
```

같으면 허용한다.

다르면 막는다.

## 18.1 update 변경

`update()` 함수는 이렇게 바꾼다.

```ts
async update(userId: number, id: number, updatePostDto: UpdatePostDto) {
  const post = await this.prisma.post.findUnique({
    where: { id },
  });

  if (!post) {
    throw new NotFoundException('게시글을 찾을 수 없습니다.');
  }

  if (post.authorId !== userId) {
    throw new ForbiddenException('게시글을 수정할 권한이 없습니다.');
  }

  if (updatePostDto.exercises) {
    await this.prisma.exercise.deleteMany({
      where: { postId: id },
    });
  }

  return this.prisma.post.update({
    where: { id },
    data: {
      title: updatePostDto.title,
      date: updatePostDto.date ? new Date(updatePostDto.date) : undefined,
      bodyPart: updatePostDto.bodyPart,
      memo: updatePostDto.memo,
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
    },
    include: postInclude,
  });
}
```

중요한 부분:

```ts
if (post.authorId !== userId) {
  throw new ForbiddenException('게시글을 수정할 권한이 없습니다.');
}
```

로그인은 했지만 작성자가 아니면 `403 Forbidden`을 보낸다.

## 18.2 remove 변경

`remove()` 함수는 이렇게 바꾼다.

```ts
async remove(userId: number, id: number) {
  const post = await this.prisma.post.findUnique({
    where: { id },
  });

  if (!post) {
    throw new NotFoundException('게시글을 찾을 수 없습니다.');
  }

  if (post.authorId !== userId) {
    throw new ForbiddenException('게시글을 삭제할 권한이 없습니다.');
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

삭제도 수정과 같은 방식이다.

```text
게시글 찾기
  ↓
없으면 404
  ↓
작성자가 아니면 403
  ↓
작성자면 삭제
```

---

# 19. 에러 코드 이해

오늘 자주 볼 에러는 세 가지다.

| 코드 | 의미 | 예시 |
| --- | --- | --- |
| 400 | 요청 자체가 잘못됨 | 이미 가입된 이메일 |
| 401 | 로그인 안 됨 | token 없이 글 작성 |
| 403 | 권한 없음 | 남의 글 삭제 |
| 404 | 대상 없음 | 없는 게시글 수정 |

특히 401과 403을 구분해야 한다.

```text
401 = 너 누구야? 로그인부터 해.
403 = 누군지는 알겠는데, 이건 네 권한이 아니야.
```

---

# 20. 테스트 순서

서버 실행:

```bash
cd /Users/igyeong-geun/Documents/jungle/week15/ai-workout-board/backend
npm run start:dev
```

## 20.1 회원가입

```bash
curl -X POST http://localhost:3000/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"12345678","nickname":"테스트"}'
```

성공하면 사용자 정보가 나온다.

```json
{
  "id": 1,
  "email": "test@example.com",
  "nickname": "테스트",
  "createdAt": "2026-06-11T..."
}
```

## 20.2 로그인

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"12345678"}'
```

성공하면 `accessToken`이 나온다.

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 1,
    "email": "test@example.com",
    "nickname": "테스트"
  }
}
```

## 20.3 token 없이 내 정보 조회

```bash
curl http://localhost:3000/auth/me
```

예상 결과:

```text
401 Unauthorized
```

## 20.4 token으로 내 정보 조회

아래에서 `여기에_accessToken` 부분을 실제 token으로 바꾼다.

```bash
curl http://localhost:3000/auth/me \
  -H "Authorization: Bearer 여기에_accessToken"
```

예상 결과:

```json
{
  "id": 1,
  "email": "test@example.com",
  "nickname": "테스트"
}
```

## 20.5 token 없이 게시글 작성

```bash
curl -X POST http://localhost:3000/posts \
  -H "Content-Type: application/json" \
  -d '{"title":"토큰 없는 요청","date":"2026-06-11","bodyPart":"가슴","exercises":[]}'
```

예상 결과:

```text
401 Unauthorized
```

## 20.6 token으로 게시글 작성

```bash
curl -X POST http://localhost:3000/posts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 여기에_accessToken" \
  -d '{
    "title": "가슴 운동",
    "date": "2026-06-11",
    "bodyPart": "가슴",
    "memo": "벤치 마지막 세트가 힘들었다",
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

성공하면 게시글의 `authorId`가 로그인한 사용자 id로 저장된다.

---

# 21. 오늘 꼭 이해해야 하는 흐름

오늘 코드는 많아 보이지만 흐름은 하나다.

```text
로그인한다.
  ↓
token을 받는다.
  ↓
요청 header에 token을 넣는다.
  ↓
JwtAuthGuard가 token을 검사한다.
  ↓
Guard가 request.user를 만든다.
  ↓
Controller가 request.user.id를 꺼낸다.
  ↓
Service가 authorId로 저장하거나 권한을 검사한다.
```

이 흐름을 이해하면 오늘 코드가 연결된다.

---

# 22. 오늘 완료 기준

학습 기준:

```text
회원가입과 로그인의 차이를 설명할 수 있다.
JWT가 왜 필요한지 설명할 수 있다.
Authorization header의 역할을 설명할 수 있다.
Guard가 Controller보다 먼저 실행된다는 것을 이해한다.
request.user는 Guard가 붙인 값이라는 것을 이해한다.
authorId는 token에서 온 userId로 정해진다는 것을 이해한다.
401과 403의 차이를 설명할 수 있다.
```

구현 기준:

```text
POST /auth/signup 성공
POST /auth/login 성공
GET /auth/me 성공
token 없이 POST /posts 요청 시 401
token 있으면 POST /posts 성공
남의 글 수정/삭제 시 403
내 글 수정/삭제 시 성공
```

