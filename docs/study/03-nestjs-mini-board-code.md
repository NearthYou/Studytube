# 03. NestJS 미니 게시판 API 코드 따라치기

이 문서는 NestJS API를 직접 따라 치는 문서다.

목표:

```txt
GET  /posts
GET  /posts/:id
POST /posts
```

처음에는 DB 없이 배열 데이터로 만든다.

## 0. 실행

터미널에서 실행한다.

```powershell
npm.cmd run dev:api
```

확인:

```txt
http://localhost:3000/health
```

## 1. 폴더 만들기

폴더 생성:

```txt
api/src/posts
```

## 2. 타입 만들기

파일 생성:

```txt
api/src/posts/post.type.ts
```

코드:

```ts
export type Post = {
  id: number
  title: string
  content: string
  author: string
  createdAt: string
}
```

설명:

```txt
Post는 글 하나의 데이터 모양이다.
```

## 3. DTO 만들기

파일 생성:

```txt
api/src/posts/create-post.dto.ts
```

코드:

```ts
export class CreatePostDto {
  title: string
  content: string
}
```

설명:

```txt
CreatePostDto는 POST /posts 요청 body의 모양이다.
```

## 4. Service 만들기

파일 생성:

```txt
api/src/posts/posts.service.ts
```

코드:

```ts
import { Injectable, NotFoundException } from '@nestjs/common'
import { CreatePostDto } from './create-post.dto'
import { Post } from './post.type'

@Injectable()
export class PostsService {
  private posts: Post[] = [
    {
      id: 1,
      title: 'React 화면 연습',
      content: 'React에서 목록과 상세 화면을 만들었습니다.',
      author: 'student',
      createdAt: '2026-06-06',
    },
  ]

  findAll() {
    return this.posts
  }

  findOne(id: number) {
    const post = this.posts.find((item) => item.id === id)

    if (!post) {
      throw new NotFoundException('Post not found')
    }

    return post
  }

  create(createPostDto: CreatePostDto) {
    const post: Post = {
      id: this.posts.length + 1,
      title: createPostDto.title,
      content: createPostDto.content,
      author: 'student',
      createdAt: new Date().toISOString().slice(0, 10),
    }

    this.posts.push(post)

    return post
  }
}
```

설명:

```txt
posts 배열은 임시 데이터다.
findAll은 전체 글을 반환한다.
findOne은 id로 글 하나를 찾는다.
create는 새 글을 배열에 추가한다.
```

## 5. Controller 만들기

파일 생성:

```txt
api/src/posts/posts.controller.ts
```

코드:

```ts
import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { CreatePostDto } from './create-post.dto'
import { PostsService } from './posts.service'

@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Get()
  findAll() {
    return this.postsService.findAll()
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.postsService.findOne(Number(id))
  }

  @Post()
  create(@Body() createPostDto: CreatePostDto) {
    return this.postsService.create(createPostDto)
  }
}
```

설명:

```txt
@Controller('posts')는 /posts 주소를 뜻한다.
@Get()은 GET /posts를 뜻한다.
@Get(':id')는 GET /posts/1 같은 주소를 뜻한다.
@Post()는 POST /posts를 뜻한다.
```

## 6. Module 만들기

파일 생성:

```txt
api/src/posts/posts.module.ts
```

코드:

```ts
import { Module } from '@nestjs/common'
import { PostsController } from './posts.controller'
import { PostsService } from './posts.service'

@Module({
  controllers: [PostsController],
  providers: [PostsService],
})
export class PostsModule {}
```

설명:

```txt
PostsModule은 posts 기능에 필요한 Controller와 Service를 묶는다.
```

## 7. AppModule에 연결하기

파일:

```txt
api/src/app.module.ts
```

위쪽 import에 추가한다.

```ts
import { PostsModule } from './posts/posts.module'
```

`imports` 배열에 `PostsModule`을 추가한다.

```ts
imports: [
  ConfigModule.forRoot({
    isGlobal: true,
    envFilePath: ['api/.env', '.env'],
  }),
  HttpModule,
  PostsModule,
],
```

설명:

```txt
AppModule에 PostsModule을 연결해야 NestJS가 posts API를 알 수 있다.
```

## 8. 확인

브라우저:

```txt
http://localhost:3000/posts
http://localhost:3000/posts/1
```

PowerShell에서 POST 확인:

```powershell
Invoke-RestMethod `
  -Uri http://localhost:3000/posts `
  -Method Post `
  -ContentType 'application/json' `
  -Body '{"title":"API 연습","content":"POST 요청을 만들었습니다."}'
```

성공 기준:

```txt
GET /posts가 배열을 반환한다.
GET /posts/1이 글 하나를 반환한다.
POST /posts가 새 글을 만든다.
```

## 9. 다음 단계

이제 React의 임시 데이터 파일을 지우고, React가 NestJS API를 호출하게 바꿀 수 있다.

다음 구조:

```txt
React -> GET /posts -> NestJS
React -> POST /posts -> NestJS
```
