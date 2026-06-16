# 01. 미니 게시판: 개념부터 코드까지

이 문서는 클론 코딩을 처음부터 다시 하기 위한 기준 문서다. 목표는 멋진 서비스를 만드는 것이 아니라, React와 NestJS가 어떻게 연결되는지 이해하고 직접 코드를 따라 치는 것이다.

## 1. 무엇을 만들 것인가

학습용으로 아주 작은 게시판을 만든다.

```txt
글 목록 보기
글 상세 보기
글 작성하기
```

처음부터 로그인, DB, AI, 디자인을 넣지 않는다. 먼저 화면과 API 구조를 이해한다.

## 2. 왜 게시판인가

게시판은 웹 개발 기본 구조를 배우기 좋다.

```txt
목록 화면  -> 여러 데이터를 보여준다
상세 화면  -> 하나의 데이터를 보여준다
작성 화면  -> 사용자 입력을 받는다
API       -> 화면과 서버를 연결한다
```

이 구조를 이해하면 쇼핑몰, Todo 앱, 블로그, 커뮤니티도 같은 방식으로 만들 수 있다.

## 3. 전체 구조

처음 구조:

```txt
React
  -> 화면
  -> 임시 데이터
```

그다음 구조:

```txt
React
  -> HTTP 요청
  -> NestJS
       -> 임시 배열 데이터
```

나중 구조:

```txt
React
  -> NestJS
       -> PostgreSQL
```

AI 기능을 붙일 때 구조:

```txt
React
  -> NestJS
       -> PostgreSQL
       -> FastAPI
```

중요한 원칙은 이것이다.

```txt
React는 화면만 담당한다.
NestJS는 메인 백엔드를 담당한다.
FastAPI는 나중에 AI 기능만 담당한다.
PostgreSQL은 데이터를 저장한다.
```

## 4. 먼저 알아야 할 개념

### React

React는 화면을 만드는 도구다.

React에서는 화면 조각을 `Component`라고 부른다.

```tsx
function PostListPage() {
  return <h1>글 목록</h1>
}
```

컴포넌트 이름은 보통 대문자로 시작한다.

### JSX

JSX는 TypeScript 안에서 HTML처럼 쓰는 문법이다.

```tsx
return <p>안녕하세요</p>
```

변수를 화면에 보여줄 때는 `{}`를 쓴다.

```tsx
const title = '글 제목'

return <h1>{title}</h1>
```

### useState

`useState`는 화면에서 바뀌는 값을 저장한다.

```tsx
const [title, setTitle] = useState('')
```

뜻:

```txt
title = 현재 값
setTitle = 값을 바꾸는 함수
useState('') = 처음 값은 빈 문자열
```

입력창과 연결하면 이렇게 된다.

```tsx
<input
  value={title}
  onChange={(event) => setTitle(event.target.value)}
/>
```

### map

`map`은 배열을 화면 목록으로 바꾼다.

```tsx
posts.map((post) => (
  <li key={post.id}>{post.title}</li>
))
```

### find

`find`는 배열에서 조건에 맞는 하나를 찾는다.

```tsx
const post = posts.find((item) => item.id === postId)
```

### React Router

React Router는 주소에 따라 다른 화면을 보여준다.

```tsx
<Route path="/posts" element={<PostListPage />} />
<Route path="/posts/:id" element={<PostDetailPage />} />
```

`:id`는 바뀌는 값이다.

```txt
/posts/1 -> id는 1
/posts/2 -> id는 2
```

그 값은 `useParams`로 읽는다.

```tsx
const params = useParams()
const postId = Number(params.id)
```

## 5. NestJS 개념

NestJS는 백엔드 서버를 만드는 도구다.

NestJS는 보통 3개로 나눈다.

```txt
Module
Controller
Service
```

### Module

Module은 관련 기능을 묶는다.

```ts
@Module({
  controllers: [PostsController],
  providers: [PostsService],
})
export class PostsModule {}
```

게시글 기능이면 `PostsModule`, 회원 기능이면 `UsersModule`처럼 만든다.

### Controller

Controller는 HTTP 요청을 받는다.

```ts
@Controller('posts')
export class PostsController {
  @Get()
  findAll() {
    return []
  }
}
```

이 코드는 아래 API가 된다.

```txt
GET /posts
```

### Service

Service는 실제 로직을 처리한다.

```ts
@Injectable()
export class PostsService {
  findAll() {
    return this.posts
  }
}
```

Controller는 요청을 받고, Service는 일을 한다.

```txt
요청 -> Controller -> Service -> 응답
```

### DTO

DTO는 요청 body의 모양이다.

```ts
export class CreatePostDto {
  title: string
  content: string
}
```

글 작성 API에서 사용한다.

## 6. HTTP 개념

이번에 쓸 HTTP는 3개다.

```txt
GET /posts      글 목록 조회
GET /posts/:id  글 상세 조회
POST /posts     글 작성
```

뜻:

```txt
GET = 조회
POST = 생성
```

나중에 추가할 수 있는 것:

```txt
PATCH = 수정
DELETE = 삭제
```

처음에는 GET과 POST만 한다.

## 7. 설계 방법

코드를 치기 전에 항상 이 순서로 생각한다.

### 1단계: 화면 정하기

```txt
글 목록 화면
글 상세 화면
글 작성 화면
```

### 2단계: 화면에 필요한 데이터 정하기

```txt
id
title
content
author
createdAt
```

### 3단계: 데이터 타입 만들기

```ts
type Post = {
  id: number
  title: string
  content: string
  author: string
  createdAt: string
}
```

### 4단계: API 정하기

```txt
글 목록 화면 -> GET /posts
글 상세 화면 -> GET /posts/:id
글 작성 화면 -> POST /posts
```

### 5단계: 파일 나누기

React:

```txt
data/posts.ts
pages/PostListPage.tsx
pages/PostDetailPage.tsx
pages/PostNewPage.tsx
App.tsx
```

NestJS:

```txt
posts/post.type.ts
posts/create-post.dto.ts
posts/posts.service.ts
posts/posts.controller.ts
posts/posts.module.ts
app.module.ts
```

## 8. 이번 학습 순서

```txt
1. React에서 임시 데이터로 게시판 화면 만들기
2. NestJS에서 임시 배열 데이터로 API 만들기
3. React 임시 데이터를 NestJS API 호출로 바꾸기
4. 나중에 배열 데이터를 DB로 바꾸기
```

지금은 1번과 2번만 한다.

## 9. 꼭 기억할 것

처음부터 완성하려고 하면 어렵다.

그래서 이렇게 나눈다.

```txt
화면 먼저
API 다음
DB 나중
AI 마지막
```

이 순서가 무너지면 디버깅하기 어려워진다.
