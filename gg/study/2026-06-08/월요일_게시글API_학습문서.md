# 2026년 6월 8일 월요일 학습 문서

> 주제: NestJS + Prisma + PostgreSQL로 운동 기록 게시글 저장/조회 흐름 만들기  
> 목표: 백엔드의 중심 구조를 세우고, 운동 기록 게시글을 DB에 저장한 뒤 다시 조회할 수 있게 한다.

---

## 0. 오늘 만드는 것

오늘 만드는 것은 완성된 서비스가 아니다.

오늘 만드는 것은 앞으로 모든 기능이 얹힐 **백엔드 중심 뼈대**다.

오늘의 핵심 흐름은 아래 하나다.

```text
HTTP client가 운동 기록 게시글 작성 요청을 보낸다.
        ↓
NestJS Controller가 요청을 받는다.
        ↓
NestJS Service가 실제 저장 로직을 실행한다.
        ↓
Prisma가 PostgreSQL에 데이터를 저장한다.
        ↓
저장된 운동 기록 게시글을 다시 조회한다.
```

오늘은 인증, 댓글, 태그, 검색, AI 기능을 하지 않는다.

오늘은 이것만 성공하면 된다.

```text
POST /posts
GET /posts
GET /posts/:id
```

---

## 1. 오늘 이슈 범위

사용자가 준 목표를 구현 단위로 바꾸면 아래와 같다.

## Backend

| 작업 | 오늘 할 것 |
| --- | --- |
| NestJS 프로젝트 세팅 | 이미 생성되어 있으므로 구조 확인 |
| Prisma 세팅 | 설치, schema 작성, client 생성 |
| PostgreSQL 연결 | Docker DB와 Prisma 연결 |
| User 모델 생성 | Prisma schema에 작성 |
| Post 모델 생성 | Prisma schema에 작성 |
| Exercise 모델 생성 | Prisma schema에 작성 |
| Set 모델 생성 | Prisma schema에 작성 |
| 기본 migration 실행 | DB 테이블 생성 |
| 게시글 작성 API 구현 | `POST /posts` |
| 게시글 목록 API 구현 | `GET /posts` |
| 게시글 상세 API 구현 | `GET /posts/:id` |

## Frontend

| 작업 | 오늘 할 것 |
| --- | --- |
| React 라우팅 정리 | 게시글 목록/작성 경로 추가 |
| 게시글 목록 페이지 뼈대 생성 | API 연결 전 화면 뼈대 |
| 게시글 작성 페이지 뼈대 생성 | API 연결 전 화면 뼈대 |

프론트엔드는 오늘 깊게 하지 않는다.

오늘의 중심은 백엔드다.

---

## 2. 공식 문서 기준

이 문서는 아래 공식 문서 흐름을 참고하되, 초보자가 따라가기 쉽게 프로젝트에 맞춰 재구성했다.

- NestJS Controllers: https://docs.nestjs.com/controllers
- NestJS Providers: https://docs.nestjs.com/providers
- NestJS Prisma Recipe: https://docs.nestjs.com/recipes/prisma
- Prisma Migrate: https://www.prisma.io/docs/orm/prisma-migrate/getting-started

주의할 점:

2026년 현재 Prisma 공식 문서는 Prisma 7 흐름을 많이 보여준다.  
Prisma 7은 generator output, module format, adapter 설정이 더 명시적으로 들어가서 처음 배우는 입장에서는 복잡하다.

이번 과제에서는 학습 안정성을 위해 아래처럼 간다.

```text
Prisma 6 고정
@prisma/client에서 PrismaClient import
NestJS PrismaService로 감싸서 사용
```

이 방식은 과제 규모에 충분하고, 처음 배우기에 훨씬 단순하다.

---

## 3. 현재 프로젝트 상태

현재 프로젝트는 아래 위치에 있다.

```bash
/Users/igyeong-geun/Documents/jungle/week15/ai-workout-board
```

현재 중요한 폴더는 아래와 같다.

```text
ai-workout-board/
  backend/
  frontend/
  ai-server/
  docs/
  docker-compose.yml
  .env.example
```

현재 `backend`는 NestJS 프로젝트가 이미 생성된 상태다.

확인 명령어:

```bash
cd /Users/igyeong-geun/Documents/jungle/week15/ai-workout-board
find backend/src -maxdepth 2 -type f | sort
```

정상적으로는 아래 파일들이 보여야 한다.

```text
backend/src/app.controller.ts
backend/src/app.module.ts
backend/src/app.service.ts
backend/src/main.ts
```

---

## 4. 오늘 작업 브랜치

오늘 작업은 새 브랜치에서 한다.

아래 명령어를 입력한다.

```bash
cd /Users/igyeong-geun/Documents/jungle/week15/ai-workout-board
git switch main
git pull origin main
git switch -c feat/post-basic-api
```

이미 브랜치가 있다고 나오면:

```bash
git switch feat/post-basic-api
```

확인:

```bash
git branch --show-current
```

정상 결과:

```text
feat/post-basic-api
```

---

## 5. Docker로 PostgreSQL 실행

DB가 켜져 있어야 Prisma migration을 실행할 수 있다.

Docker Desktop을 먼저 켠 뒤 아래 명령어를 입력한다.

```bash
docker compose up -d
docker compose ps
```

정상 결과:

```text
workout-board-postgres 컨테이너가 Up 또는 healthy 상태
```

로그 확인:

```bash
docker compose logs postgres
```

로그에서 아래 문장이 보이면 좋다.

```text
database system is ready to accept connections
```

이 말은 PostgreSQL이 요청을 받을 준비가 됐다는 뜻이다.

---

## 6. 백엔드 패키지 설치

`backend` 폴더로 이동한다.

```bash
cd backend
```

오늘 필요한 패키지를 설치한다.

```bash
npm install @nestjs/config class-validator class-transformer @prisma/client@6
npm install -D prisma@6
```

각 패키지의 뜻:

| 패키지 | 뜻 |
| --- | --- |
| `@nestjs/config` | `.env` 환경 변수를 NestJS에서 읽게 해준다. |
| `class-validator` | 요청 body 값이 올바른지 검사한다. |
| `class-transformer` | 요청 body를 DTO 클래스 형태로 바꿔준다. |
| `@prisma/client@6` | 코드에서 DB에 쿼리를 보낼 수 있게 해준다. |
| `prisma@6` | migration, generate 같은 Prisma CLI 명령어를 제공한다. |

설치 후 확인:

```bash
cat package.json
```

`dependencies` 안에 아래가 있어야 한다.

```text
@nestjs/config
class-validator
class-transformer
@prisma/client
```

`devDependencies` 안에 아래가 있어야 한다.

```text
prisma
```

---

## 7. Prisma 초기화

`backend` 폴더에서 실행한다.

```bash
npx prisma init
```

정상적으로 실행되면 아래 파일이 생긴다.

```text
backend/prisma/schema.prisma
backend/.env
```

이 두 파일의 역할:

| 파일 | 역할 |
| --- | --- |
| `prisma/schema.prisma` | DB 테이블 구조를 코드로 정의한다. |
| `.env` | DB 접속 주소 같은 비밀 설정을 둔다. |

---

## 8. backend/.env 설정

`backend/.env` 파일을 열어서 아래처럼 만든다.

```env
DATABASE_URL="postgresql://workout:workout@localhost:5432/workout_board?schema=public"
PORT=3000
```

뜻:

| 조각 | 의미 |
| --- | --- |
| `postgresql://` | PostgreSQL에 연결한다. |
| `workout:workout` | 사용자 이름과 비밀번호다. |
| `localhost:5432` | 내 컴퓨터의 5432 포트에 있는 DB다. |
| `workout_board` | DB 이름이다. |
| `schema=public` | PostgreSQL의 기본 schema를 사용한다. |

이 값은 루트의 `docker-compose.yml`과 맞아야 한다.

루트 `docker-compose.yml`에는 아래 값이 들어 있다.

```yaml
POSTGRES_USER: workout
POSTGRES_PASSWORD: workout
POSTGRES_DB: workout_board
```

그래서 `DATABASE_URL`도 `workout`, `workout`, `workout_board`를 사용한다.

---

## 9. Prisma schema 작성

`backend/prisma/schema.prisma` 파일을 아래 코드로 교체한다.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id           Int           @id @default(autoincrement())
  email        String        @unique
  nickname     String
  passwordHash String
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt

  posts Post[]
}

model Post {
  id          Int               @id @default(autoincrement())
  authorId    Int
  title       String
  date DateTime
  bodyPart    String
  memo        String?
  createdAt   DateTime          @default(now())
  updatedAt   DateTime          @updatedAt

  author      User              @relation(fields: [authorId], references: [id])
  exercises   Exercise[]

  @@index([authorId])
  @@index([date])
  @@index([bodyPart])
}

model Exercise {
  id             Int          @id @default(autoincrement())
  postId         Int
  exerciseName   String
  normalizedName String?
  weightKg       Float
  targetReps     Int?
  orderIndex     Int          @default(0)
  memo           String?

  post           Post  @relation(fields: [postId], references: [id], onDelete: Cascade)
  sets           Set[]

  @@index([postId])
  @@index([exerciseName])
}

model Set {
  id                  Int             @id @default(autoincrement())
  exerciseId           Int
  setNumber            Int
  reps                 Int
  perceivedDifficulty  Int?

  exercise             Exercise @relation(fields: [exerciseId], references: [id], onDelete: Cascade)

  @@index([exerciseId])
}
```

## 이 schema의 뜻

### User

사용자를 저장한다.

아직 로그인은 만들지 않지만, 게시글에는 작성자가 필요하므로 `User`가 먼저 필요하다.

```text
User 1명은 Post 여러 개를 작성할 수 있다.
```

### Post

운동 기록 게시글이다.

예:

```text
제목: 오늘 가슴 운동
운동 날짜: 2026-06-08
운동 부위: 가슴
메모: 마지막 세트가 힘들었다.
```

### Exercise

게시글 안에 들어가는 운동 종목이다.

예:

```text
벤치프레스 60kg
인클라인 덤벨프레스 20kg
```

게시글 하나에는 여러 운동 종목이 들어갈 수 있다.

### Set

운동 종목 하나에 대한 세트 기록이다.

예:

```text
벤치프레스
- 1세트 8회
- 2세트 8회
- 3세트 7회
```

---

## 10. migration 실행

`backend` 폴더에서 실행한다.

```bash
npx prisma migrate dev --name init_posts
```

이 명령어가 하는 일:

```text
schema.prisma를 읽는다.
        ↓
PostgreSQL에 만들 테이블을 계산한다.
        ↓
SQL migration 파일을 만든다.
        ↓
PostgreSQL에 실제 테이블을 생성한다.
        ↓
Prisma Client를 생성한다.
```

정상 결과:

```text
The following migration(s) have been created and applied
Generated Prisma Client
```

확인:

```bash
npx prisma studio
```

브라우저에서 Prisma Studio가 열리면 테이블을 볼 수 있다.

Prisma Studio를 끄려면 터미널에서 `Control + C`를 누른다.

---

## 11. NestJS main.ts 설정

`backend/src/main.ts`를 아래처럼 바꾼다.

```ts
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: 'http://localhost:5173',
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
```

## 이 코드의 뜻

### `ValidationPipe`

요청 body가 DTO 규칙에 맞는지 검사한다.

예를 들어 게시글 작성 요청에 `title`이 없으면 나중에 에러를 낼 수 있다.

### `whitelist: true`

DTO에 정의하지 않은 값은 제거한다.

예:

```json
{
  "title": "오늘 운동",
  "hackerField": "이상한 값"
}
```

`hackerField`는 DTO에 없으면 제거된다.

### `transform: true`

요청으로 들어온 값을 DTO 클래스에 맞게 변환한다.

예를 들어 URL param으로 들어온 `"1"` 같은 문자열을 숫자로 바꾸는 데 도움을 준다.

### `enableCors`

React 개발 서버는 보통 `http://localhost:5173`에서 뜬다.

NestJS는 `http://localhost:3000`에서 뜬다.

브라우저는 서로 다른 포트의 요청을 막을 수 있다.

그래서 NestJS가 React 요청을 허용하도록 CORS를 켠다.

---

## 12. ConfigModule 등록

`backend/src/app.module.ts`를 아래처럼 바꾼다.

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

이 단계에서는 아직 `PostsModule`을 등록하지 않는다.

먼저 PrismaModule과 PostsModule을 만든 뒤 다시 수정한다.

---

## 13. PrismaModule 만들기

폴더를 만든다.

```bash
mkdir -p src/prisma
```

`backend/src/prisma/prisma.service.ts` 파일을 만든다.

```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

## PrismaService의 뜻

`PrismaClient`는 DB에 쿼리를 보내는 객체다.

그런데 NestJS 안에서 그냥 직접 만들면 관리가 어렵다.

그래서 `PrismaService`로 감싸서 NestJS가 관리하게 만든다.

```text
NestJS가 서버를 켠다.
        ↓
PrismaService가 생성된다.
        ↓
onModuleInit이 실행된다.
        ↓
PostgreSQL에 연결한다.
```

`backend/src/prisma/prisma.module.ts` 파일을 만든다.

```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

## PrismaModule의 뜻

`PrismaService`를 다른 모듈에서도 사용할 수 있게 등록하는 모듈이다.

`@Global()`을 붙였기 때문에 다른 곳에서 매번 import하지 않아도 사용할 수 있다.

처음 배우는 단계에서는 이렇게 이해하면 된다.

```text
PrismaModule = DB 연결 도구 상자
PrismaService = 실제 DB에 쿼리 보내는 도구
```

---

## 14. PostsModule 만들기

게시글 관련 코드는 `posts` 폴더에 모은다.

```bash
mkdir -p src/posts/dto
```

오늘 만들 파일:

```text
src/posts/dto/create-set.dto.ts
src/posts/dto/create-exercise.dto.ts
src/posts/dto/create-post.dto.ts
src/posts/posts.controller.ts
src/posts/posts.service.ts
src/posts/posts.module.ts
```

역할:

| 파일 | 역할 |
| --- | --- |
| DTO | 요청 body 모양을 정의한다. |
| Controller | API 주소를 만든다. |
| Service | 실제 저장/조회 로직을 처리한다. |
| Module | posts 관련 파일을 하나로 묶는다. |

---

## 15. DTO 작성

DTO는 "요청 body는 이런 모양이어야 한다"라고 정하는 클래스다.

## 15.1 세트 DTO

`backend/src/posts/dto/create-set.dto.ts`

```ts
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class CreateSetDto {
  @IsInt()
  @Min(1)
  setNumber: number;

  @IsInt()
  @Min(0)
  reps: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  perceivedDifficulty?: number;
}
```

뜻:

| 필드 | 의미 |
| --- | --- |
| `setNumber` | 몇 번째 세트인지 |
| `reps` | 반복 횟수 |
| `perceivedDifficulty` | 체감 난이도, 선택값 |

---

## 15.2 운동 종목 DTO

`backend/src/posts/dto/create-exercise.dto.ts`

```ts
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreateSetDto } from './create-set.dto';

export class CreateExerciseDto {
  @IsString()
  @IsNotEmpty()
  exerciseName: string;

  @IsNumber()
  @Min(0)
  weightKg: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  targetReps?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  orderIndex?: number;

  @IsOptional()
  @IsString()
  memo?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSetDto)
  sets: CreateSetDto[];
}
```

뜻:

게시글 안의 운동 한 줄을 의미한다.

예:

```json
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
```

---

## 15.3 게시글 DTO

`backend/src/posts/dto/create-post.dto.ts`

```ts
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreateExerciseDto } from './create-exercise.dto';

export class CreatePostDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsDateString()
  date: string;

  @IsString()
  @IsNotEmpty()
  bodyPart: string;

  @IsOptional()
  @IsString()
  memo?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateExerciseDto)
  exercises: CreateExerciseDto[];
}
```

뜻:

`POST /posts` 요청 body 전체 모양이다.

오늘은 인증이 없기 때문에 작성자는 임시 demo user로 처리한다.

---

## 16. PostsService 작성

`backend/src/posts/posts.service.ts`

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { CreatePostDto } from './dto/create-post.dto';
import { PrismaService } from '../prisma/prisma.service';

const postInclude = {
  author: {
    select: {
      id: true,
      email: true,
      nickname: true,
    },
  },
  exercises: {
    orderBy: {
      orderIndex: 'asc' as const,
    },
    include: {
      sets: {
        orderBy: {
          setNumber: 'asc' as const,
        },
      },
    },
  },
};

@Injectable()
export class PostsService {
  constructor(private readonly prisma: PrismaService) {}

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

  async create(createPostDto: CreatePostDto) {
    const author = await this.getDemoUser();

    return this.prisma.post.create({
      data: {
        authorId: author.id,
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

  async findAll() {
    return this.prisma.post.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      include: postInclude,
    });
  }

  async findOne(id: number) {
    const post = await this.prisma.post.findUnique({
      where: {
        id,
      },
      include: postInclude,
    });

    if (!post) {
      throw new NotFoundException('게시글을 찾을 수 없습니다.');
    }

    return post;
  }
}
```

## 이 코드의 핵심

### `getDemoUser`

아직 로그인 기능이 없으므로, 임시 작성자를 만든다.

```text
demo@board.local 사용자가 있으면 재사용
없으면 생성
```

이 기능은 나중에 JWT 인증이 붙으면 제거하거나 바뀐다.

### `create`

게시글, 운동 종목, 세트 기록을 한 번에 저장한다.

Prisma의 nested create를 사용한다.

```text
Post 생성
  └─ Exercise 여러 개 생성
      └─ Set 여러 개 생성
```

### `findAll`

게시글 목록을 최신순으로 조회한다.

### `findOne`

게시글 하나를 ID로 조회한다.

없으면 404 에러를 낸다.

---

## 17. PostsController 작성

`backend/src/posts/posts.controller.ts`

```ts
import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { CreatePostDto } from './dto/create-post.dto';
import { PostsService } from './posts.service';

@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Post()
  create(@Body() createPostDto: CreatePostDto) {
    return this.postsService.create(createPostDto);
  }

  @Get()
  findAll() {
    return this.postsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.postsService.findOne(id);
  }
}
```

## 이 코드의 뜻

| 코드 | 의미 |
| --- | --- |
| `@Controller('posts')` | `/posts`로 시작하는 API 묶음 |
| `@Post()` | `POST /posts` |
| `@Get()` | `GET /posts` |
| `@Get(':id')` | `GET /posts/1` 같은 상세 조회 |
| `@Body()` | 요청 body를 꺼냄 |
| `@Param('id')` | URL의 id 값을 꺼냄 |
| `ParseIntPipe` | 문자열 id를 숫자로 바꿈 |

---

## 18. PostsModule 작성

`backend/src/posts/posts.module.ts`

```ts
import { Module } from '@nestjs/common';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';

@Module({
  controllers: [PostsController],
  providers: [PostsService],
})
export class PostsModule {}
```

뜻:

```text
PostsController와 PostsService를 posts 기능 묶음으로 등록한다.
```

---

## 19. AppModule에 PrismaModule과 PostsModule 등록

`backend/src/app.module.ts`

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PostsModule } from './posts/posts.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    PostsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

뜻:

```text
이 NestJS 앱은 ConfigModule, PrismaModule, PostsModule을 사용한다.
```

이제 NestJS가 `PostsController`를 알게 되고, `/posts` API가 열린다.

---

## 20. 서버 실행

`backend` 폴더에서 실행한다.

```bash
npm run start:dev
```

정상 결과:

```text
Nest application successfully started
```

서버는 기본적으로 아래 주소에서 열린다.

```text
http://localhost:3000
```

다른 터미널에서 health check:

```bash
curl http://localhost:3000/health
```

정상 응답:

```json
{
  "status": "ok",
  "service": "backend",
  "timestamp": "..."
}
```

---

## 21. 게시글 작성 API 테스트

다른 터미널에서 실행한다.

```bash
curl -X POST http://localhost:3000/posts \
  -H "Content-Type: application/json" \
  -d '{
    "title": "오늘 가슴 운동",
    "date": "2026-06-08",
    "bodyPart": "가슴",
    "memo": "마지막 세트가 힘들었지만 지난번보다 나아진 것 같다.",
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
      },
      {
        "exerciseName": "인클라인 덤벨프레스",
        "weightKg": 20,
        "targetReps": 10,
        "sets": [
          { "setNumber": 1, "reps": 10 },
          { "setNumber": 2, "reps": 9 },
          { "setNumber": 3, "reps": 8 }
        ]
      }
    ]
  }'
```

정상 응답에는 아래 정보가 포함되어야 한다.

```text
id
title
date
bodyPart
author
exercises
sets
```

응답 예시:

```json
{
  "id": 1,
  "title": "오늘 가슴 운동",
  "bodyPart": "가슴",
  "author": {
    "id": 1,
    "email": "demo@board.local",
    "nickname": "데모 사용자"
  },
  "exercises": [
    {
      "exerciseName": "벤치프레스",
      "sets": [
        { "setNumber": 1, "reps": 8 },
        { "setNumber": 2, "reps": 8 },
        { "setNumber": 3, "reps": 7 }
      ]
    }
  ]
}
```

---

## 22. 게시글 목록 API 테스트

```bash
curl http://localhost:3000/posts
```

정상 응답:

```json
[
  {
    "id": 1,
    "title": "오늘 가슴 운동",
    "exercises": []
  }
]
```

실제 응답에서는 `exercises` 안에 세트 기록까지 들어 있어야 한다.

---

## 23. 게시글 상세 API 테스트

게시글 작성 응답에서 받은 `id`가 1이라고 가정한다.

```bash
curl http://localhost:3000/posts/1
```

정상 응답:

```json
{
  "id": 1,
  "title": "오늘 가슴 운동",
  "exercises": [
    {
      "exerciseName": "벤치프레스",
      "sets": [
        { "setNumber": 1, "reps": 8 },
        { "setNumber": 2, "reps": 8 },
        { "setNumber": 3, "reps": 7 }
      ]
    }
  ]
}
```

없는 게시글 조회 테스트:

```bash
curl http://localhost:3000/posts/999999
```

정상적인 실패 응답:

```json
{
  "message": "게시글을 찾을 수 없습니다.",
  "error": "Not Found",
  "statusCode": 404
}
```

---

## 24. 프론트엔드 라우팅 정리

오늘 프론트엔드는 API 연결까지 깊게 하지 않는다.

우선 라우팅과 페이지 뼈대만 만든다.

현재 `frontend`에는 이미 `react-router`가 설치되어 있다.

## 만들 페이지

```text
frontend/src/pages/PostListPage.tsx
frontend/src/pages/PostCreatePage.tsx
```

## 24.1 게시글 목록 페이지

`frontend/src/pages/PostListPage.tsx`

```tsx
export default function PostListPage() {
  return (
    <main>
      <h1>운동 기록 게시판</h1>
      <p>운동 기록 게시글 목록이 표시될 예정입니다.</p>

      <section>
        <h2>오늘 구현할 목록 화면 뼈대</h2>
        <ul>
          <li>제목</li>
          <li>운동 부위</li>
          <li>대표 운동명</li>
          <li>작성일</li>
        </ul>
      </section>
    </main>
  );
}
```

## 24.2 게시글 작성 페이지

`frontend/src/pages/PostCreatePage.tsx`

```tsx
export default function PostCreatePage() {
  return (
    <main>
      <h1>운동 기록 작성</h1>
      <p>운동 기록 작성 폼이 들어갈 예정입니다.</p>

      <section>
        <h2>작성 폼 뼈대</h2>
        <ul>
          <li>제목</li>
          <li>운동 날짜</li>
          <li>운동 부위</li>
          <li>운동명</li>
          <li>무게</li>
          <li>세트별 반복 수</li>
        </ul>
      </section>
    </main>
  );
}
```

## 24.3 App.tsx 수정

`frontend/src/App.tsx`

```tsx
import './App.css';
import { Link, Route, Routes } from 'react-router';
import AboutPage from './pages/AboutPage';
import HomePage from './pages/HomePage';
import NotFoundPage from './pages/NotFoundPage';
import PostCreatePage from './pages/PostCreatePage';
import PostListPage from './pages/PostListPage';
import UserPage from './pages/UserPage';

function App() {
  return (
    <>
      <header>
        <nav>
          <Link to="/">Home</Link> {' | '}
          <Link to="/posts">운동 기록</Link> {' | '}
          <Link to="/posts/new">기록 작성</Link> {' | '}
          <Link to="/about">About</Link> {' | '}
          <Link to="/users">Users</Link>
        </nav>
      </header>

      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/posts" element={<PostListPage />} />
        <Route path="/posts/new" element={<PostCreatePage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/users" element={<UserPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}

export default App;
```

프론트엔드 실행:

```bash
cd frontend
npm run dev
```

브라우저에서 확인:

```text
http://localhost:5173/posts
http://localhost:5173/posts/new
```

오늘은 화면만 보이면 된다.

API 연결은 다음 단계에서 해도 된다.

---

## 25. 오늘 완료 기준

아래가 모두 되면 오늘 목표는 성공이다.

## Backend

- [ ] `docker compose up -d`로 PostgreSQL이 실행된다.
- [ ] `backend/.env`에 `DATABASE_URL`이 설정되어 있다.
- [ ] `backend/prisma/schema.prisma`에 4개 모델이 있다.
- [ ] `npx prisma migrate dev --name init_posts`가 성공한다.
- [ ] NestJS 서버가 `npm run start:dev`로 실행된다.
- [ ] `GET /health`가 성공한다.
- [ ] `POST /posts`로 운동 기록 게시글을 생성할 수 있다.
- [ ] `GET /posts`로 게시글 목록을 조회할 수 있다.
- [ ] `GET /posts/:id`로 게시글 상세를 조회할 수 있다.

## Frontend

- [ ] `/posts` 페이지가 열린다.
- [ ] `/posts/new` 페이지가 열린다.
- [ ] 네비게이션에 운동 기록, 기록 작성 링크가 보인다.

---

## 26. 오늘 하지 않는 것

오늘 하지 않는 것을 명확히 해야 길을 잃지 않는다.

- 회원가입 API
- 로그인 API
- JWT Guard
- 댓글
- 태그
- 검색
- 페이징
- AI 분석
- RAG
- MCP
- Agent
- AWS 배포
- 예쁜 UI

오늘은 게시글 저장/조회 흐름만 만든다.

---

## 27. 자주 막히는 지점

## 27.1 `Cannot find module '@prisma/client'`

원인:

```text
@prisma/client 설치가 안 됐거나 prisma generate가 안 됨
```

해결:

```bash
cd backend
npm install @prisma/client@6
npx prisma generate
```

## 27.2 `Can't reach database server`

원인:

```text
PostgreSQL Docker 컨테이너가 꺼져 있음
```

해결:

```bash
docker compose up -d
docker compose ps
```

## 27.3 `Environment variable not found: DATABASE_URL`

원인:

```text
backend/.env에 DATABASE_URL이 없거나 위치가 틀림
```

해결:

```text
backend/.env 파일을 확인한다.
```

내용:

```env
DATABASE_URL="postgresql://workout:workout@localhost:5432/workout_board?schema=public"
```

## 27.4 DTO validation이 안 먹음

원인:

```text
main.ts에 ValidationPipe를 등록하지 않음
```

해결:

`main.ts`에 아래 코드가 있어야 한다.

```ts
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,
    transform: true,
  }),
);
```

## 27.5 `Property user does not exist on type PrismaService`

원인:

```text
Prisma Client가 schema 변경 후 재생성되지 않음
```

해결:

```bash
cd backend
npx prisma generate
```

---

## 28. 커밋하기

모든 확인이 끝나면 커밋한다.

```bash
git status --short
```

변경 파일을 확인한다.

백엔드와 프론트엔드 작업을 모두 올릴 경우:

```bash
git add backend frontend docs/2026-06-08
git commit -m "feat: 운동 기록 게시글 기본 API 구현"
git push -u origin feat/post-basic-api
```

PR 제목:

```text
feat: 운동 기록 게시글 기본 API 구현
```

PR 본문:

```md
## 작업 내용

운동 기록 게시글을 DB에 저장하고 다시 조회할 수 있는 기본 API를 구현했습니다.

## 변경 사항

- Prisma 세팅
- PostgreSQL 연결
- User 모델 추가
- Post 모델 추가
- Exercise 모델 추가
- Set 모델 추가
- 기본 migration 실행
- 게시글 작성 API 추가
- 게시글 목록 API 추가
- 게시글 상세 API 추가
- React 게시글 목록/작성 페이지 뼈대 추가

## 확인 내용

- [ ] NestJS 서버 실행 확인
- [ ] Prisma migration 실행 확인
- [ ] POST /posts 동작 확인
- [ ] GET /posts 동작 확인
- [ ] GET /posts/:id 동작 확인
- [ ] React /posts 페이지 확인
- [ ] React /posts/new 페이지 확인

## 제외한 내용

- 인증
- 댓글
- 태그
- 검색
- 페이징
- AI 기능

Closes #3
Closes #4
```

이 PR이 어느 이슈를 닫는지는 실제 GitHub 이슈 운영에 맞춰 조정한다.

만약 이번 작업을 하나의 새 이슈로 만들었다면 그 이슈 번호를 적는다.

---

## 29. 최종 정리

오늘 작업의 핵심은 아래다.

```text
NestJS는 요청을 받는다.
Controller는 API 주소를 담당한다.
Service는 실제 로직을 담당한다.
PrismaService는 DB와 대화한다.
PostgreSQL은 데이터를 저장한다.
```

운동 기록 게시글 저장 흐름:

```text
POST /posts
        ↓
PostsController.create()
        ↓
PostsService.create()
        ↓
Prisma post.create()
        ↓
Post + Exercise + Set 저장
        ↓
JSON 응답 반환
```

운동 기록 게시글 조회 흐름:

```text
GET /posts
        ↓
PostsController.findAll()
        ↓
PostsService.findAll()
        ↓
Prisma post.findMany()
        ↓
게시글 목록 JSON 반환
```

상세 조회 흐름:

```text
GET /posts/1
        ↓
PostsController.findOne(1)
        ↓
PostsService.findOne(1)
        ↓
Prisma post.findUnique()
        ↓
게시글 상세 JSON 반환
```

이 흐름이 되면 AI 기능을 붙일 근거 데이터가 생긴다.

즉 오늘은 AI를 하지 않아도 AI 기능의 기반을 만드는 날이다.

