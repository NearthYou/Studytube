# 05. PostgreSQL + Prisma로 데이터 저장하기

이 문서는 NestJS의 배열 데이터를 PostgreSQL 저장으로 바꾸는 단계다.

목표:

```txt
서버를 껐다 켜도 글 데이터가 남게 만들기
```

## 1. 지금까지 구조

현재 구조:

```txt
React -> NestJS -> posts 배열
```

배열은 서버 메모리에 있다. 서버를 끄면 사라진다.

바꿀 구조:

```txt
React -> NestJS -> PostgreSQL
```

## 2. DB 실행

Docker Desktop을 켠 뒤 실행한다.

```powershell
npm.cmd run db:up
```

DB 연결 확인:

```txt
http://localhost:3000/health/db
```

## 3. Prisma 모델 작성

파일:

```txt
api/prisma/schema.prisma
```

아래 모델을 추가한다.

```prisma
model Post {
  id        Int      @id @default(autoincrement())
  title     String
  content   String
  author    String
  createdAt DateTime @default(now())
}
```

전체 파일은 이런 형태가 된다.

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Post {
  id        Int      @id @default(autoincrement())
  title     String
  content   String
  author    String
  createdAt DateTime @default(now())
}
```

## 4. Migration 실행

터미널:

```powershell
npm.cmd --prefix api run prisma:migrate -- --name create_posts
```

Prisma Client 생성:

```powershell
npm.cmd --prefix api run prisma:generate
```

## 5. PrismaService 만들기

폴더 생성:

```txt
api/src/prisma
```

파일 생성:

```txt
api/src/prisma/prisma.service.ts
```

코드:

```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    await this.$connect()
  }

  async onModuleDestroy() {
    await this.$disconnect()
  }
}
```

파일 생성:

```txt
api/src/prisma/prisma.module.ts
```

코드:

```ts
import { Module } from '@nestjs/common'
import { PrismaService } from './prisma.service'

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

## 6. PostsModule에 PrismaModule 연결

파일:

```txt
api/src/posts/posts.module.ts
```

코드:

```ts
import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { PostsController } from './posts.controller'
import { PostsService } from './posts.service'

@Module({
  imports: [PrismaModule],
  controllers: [PostsController],
  providers: [PostsService],
})
export class PostsModule {}
```

## 7. PostsService를 DB 사용으로 변경

파일:

```txt
api/src/posts/posts.service.ts
```

코드:

```ts
import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreatePostDto } from './create-post.dto'

@Injectable()
export class PostsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.post.findMany({
      orderBy: {
        id: 'desc',
      },
    })
  }

  async findOne(id: number) {
    const post = await this.prisma.post.findUnique({
      where: {
        id,
      },
    })

    if (!post) {
      throw new NotFoundException('Post not found')
    }

    return post
  }

  create(createPostDto: CreatePostDto) {
    return this.prisma.post.create({
      data: {
        title: createPostDto.title,
        content: createPostDto.content,
        author: 'student',
      },
    })
  }
}
```

설명:

```txt
findMany = 여러 글 조회
findUnique = id로 글 하나 조회
create = 새 글 저장
```

## 8. 날짜 표시 맞추기

Prisma의 `createdAt`은 문자열이 아니라 Date 형태로 온다. React에서 표시할 때 아래처럼 처리할 수 있다.

```tsx
{new Date(post.createdAt).toLocaleDateString()}
```

`web/src/api/postsApi.ts`의 타입은 이렇게 바꾼다.

```ts
export type Post = {
  id: number
  title: string
  content: string
  author: string
  createdAt: string
}
```

HTTP 응답에서는 날짜가 문자열로 넘어오므로 React 타입은 string으로 둬도 된다.

## 9. 확인

API 서버 재시작:

```powershell
npm.cmd run dev:api
```

React 실행:

```powershell
npm.cmd run dev:web
```

브라우저:

```txt
http://localhost:5173/posts/new
```

글을 작성한 뒤 API 서버를 껐다 켜도 글이 남아 있으면 성공이다.

## 성공 기준

```txt
POST /posts가 DB에 저장한다.
GET /posts가 DB에서 읽어온다.
서버를 재시작해도 글이 남아 있다.
```
