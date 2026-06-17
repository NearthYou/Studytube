# 2026년 6월 12일 금요일 학습 문서

> 주제: PR 정리, OpenAI 특강 메모, React에서 NestJS 백엔드 API 연결하기, 제목/운동명 검색 구현  
> 목표: 금요일 로드맵에 맞춰 PR을 정리하고, 특강에서 필요한 내용을 챙긴 뒤, 브라우저에서 회원가입/로그인/게시글 작성/조회/검색 흐름을 연결한다.

---

# 0. 오늘 하는 것

오늘은 크게 세 가지를 한다.

```text
1. #4, #5 PR 정리
2. OpenAI 특강에서 AI 기능에 필요한 내용 메모
3. React에서 백엔드 API 연결
4. 제목/운동명 검색 구현
```

이 문서에서 가장 길게 다루는 것은 3번과 4번이다.

백엔드에 이미 만들어둔 API를 React 화면에서 호출할 수 있게 만든다.

한 문장으로 말하면:

```text
curl로 하던 테스트를 브라우저 화면에서 할 수 있게 만든다.
```

목표 흐름:

```text
회원가입 화면에서 가입한다.
        ↓
로그인 화면에서 로그인한다.
        ↓
백엔드가 accessToken을 준다.
        ↓
React가 accessToken을 저장한다.
        ↓
게시글 작성 화면에서 운동 기록을 입력한다.
        ↓
React가 accessToken을 header에 넣어 POST /posts 요청을 보낸다.
        ↓
게시글 목록 화면에서 저장된 글을 확인한다.
        ↓
게시글 상세 화면에서 운동 기록을 확인한다.
        ↓
게시글 목록에서 제목이나 운동명으로 검색한다.
```

오늘 연결할 백엔드 API:

```text
POST /auth/signup
POST /auth/login
GET  /auth/me
GET  /posts
GET  /posts?keyword=벤치프레스
POST /posts
GET  /posts/:id
```

오늘 하지 않는 것:

```text
댓글
태그
페이징
AI 분석 구현
```

위 기능들은 뒤 일정으로 보낸다.

오늘은 브라우저에서 기본 게시판 흐름과 검색 흐름을 여는 데 집중한다.

---

# 1. 금요일 로드맵 기준 범위

구현로드맵의 금요일 범위는 아래다.

```text
5.2 PR 정리
5.3 OpenAI 특강
5.4 React API 연결
5.5 제목/운동명 검색 구현 + React 마감 체크
```

즉 오늘의 핵심 완료 기준은 이것이다.

```text
브라우저에서 회원가입
-> 로그인
-> 글 작성
-> 목록 확인
-> 상세 확인
-> 제목/운동명 검색
```

검색은 금요일 목표다.

댓글, 태그, 페이징은 금요일 목표가 아니다.

---

# 2. PR 정리에서 확인할 것

PR 정리는 코드를 새로 짜는 시간이 아니다.

지금까지 한 작업을 한 덩어리로 설명할 수 있게 정리하는 시간이다.

확인할 것:

```text
#4 게시글 CRUD 범위가 들어갔는가?
#5 인증/JWT 범위가 들어갔는가?
npm run build가 통과했는가?
백엔드 수동 테스트가 끝났는가?
PR description이 지금 구현 내용과 맞는가?
Closes #4, Closes #5가 들어갔는가?
```

PR 설명에 들어갈 핵심 문장:

```text
게시글 CRUD API에 JWT 인증과 작성자 권한 검사를 추가했습니다.
로그인한 사용자만 게시글을 작성할 수 있고,
작성자만 자신의 게시글을 수정/삭제할 수 있습니다.
```

---

# 3. OpenAI 특강에서 메모할 것

특강을 들을 때 모든 내용을 다 적으려고 하지 않는다.

우리 과제에 바로 쓸 수 있는 내용만 표시한다.

메모할 질문:

```text
Function Calling은 tool을 어떻게 정의하는가?
Agent가 tool을 선택한다는 말은 실제로 어떤 코드 흐름인가?
MCP와 일반 API 호출은 무엇이 다른가?
운동 기록 분석에서 tool로 뺄 수 있는 작업은 무엇인가?
RAG에서 검색된 데이터를 prompt에 어떻게 넣으면 좋은가?
```

우리 프로젝트에 연결할 후보:

```text
RAG: 이전 운동 기록 검색 후 prompt에 포함
MCP: 운동명 정규화 tool
Agent: 게시글 조회 -> tool 호출 -> 이전 기록 조회 -> AI 분석
```

---

# 4. 지금 프론트 상태

현재 프론트에는 페이지 뼈대가 있다.

```text
frontend/src/App.tsx
frontend/src/pages/PostListPage.tsx
frontend/src/pages/PostCreatePage.tsx
frontend/src/pages/UserPage.tsx
frontend/src/pages/HomePage.tsx
```

현재 라우팅:

```text
/           HomePage
/posts      PostListPage
/posts/new  PostCreatePage
/about      AboutPage
/users      UserPage
```

아직 부족한 것:

```text
회원가입 페이지
로그인 페이지
게시글 상세 페이지
백엔드 API 호출 코드
accessToken 저장
Authorization header 처리
```

---

# 5. React API 연결이란?

백엔드 API는 이미 있다.

예:

```text
POST http://localhost:3000/auth/login
GET  http://localhost:3000/posts
POST http://localhost:3000/posts
```

지금까지는 curl로 요청했다.

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"12345678"}'
```

React에서는 curl 대신 `fetch`를 쓴다.

```ts
const response = await fetch('http://localhost:3000/auth/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    email: 'test@example.com',
    password: '12345678',
  }),
});
```

즉 오늘 하는 일은:

```text
curl 명령어를 React 코드로 바꾸는 것
```

## 5.1 검색 API는 백엔드부터 고친다

검색은 React 화면만 만든다고 되는 게 아니다.

React는 검색어를 백엔드에 보내고, 백엔드는 그 검색어로 DB를 조회해야 한다.

우리가 만들 검색 주소는 이렇게 잡는다.

```text
GET /posts
GET /posts?keyword=벤치프레스
```

해석:

```text
GET /posts
-> 검색어 없이 전체 게시글 조회

GET /posts?keyword=벤치프레스
-> 제목 또는 운동명에 "벤치프레스"가 들어간 게시글 조회
```

먼저 `posts.controller.ts`에서 `Query`를 import한다.

```ts
import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Delete,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
```

그리고 `findAll()`을 이렇게 바꾼다.

```ts
@Get()
findAll(@Query('keyword') keyword?: string) {
  return this.postsService.findAll(keyword);
}
```

해석:

```text
@Query('keyword')
-> URL 뒤의 ?keyword=값 을 꺼낸다.

keyword?: string
-> keyword가 있을 수도 있고 없을 수도 있다.

this.postsService.findAll(keyword)
-> 검색어를 service로 넘긴다.
```

그다음 `posts.service.ts`의 `findAll()`을 검색 가능하게 바꾼다.

```ts
async findAll(keyword?: string) {
  const trimmedKeyword = keyword?.trim();

  return this.prisma.post.findMany({
    where: trimmedKeyword
      ? {
          OR: [
            {
              title: {
                contains: trimmedKeyword,
                mode: 'insensitive',
              },
            },
            {
              exercises: {
                some: {
                  exerciseName: {
                    contains: trimmedKeyword,
                    mode: 'insensitive',
                  },
                },
              },
            },
            {
              exercises: {
                some: {
                  normalizedName: {
                    contains: trimmedKeyword.toLowerCase(),
                  },
                },
              },
            },
          ],
        }
      : undefined,
    orderBy: {
      createdAt: 'desc',
    },
    include: postInclude,
  });
}
```

해석:

```text
검색어가 없으면:
where: undefined
-> 전체 게시글 조회

검색어가 있으면:
title contains keyword
또는 exerciseName contains keyword
또는 normalizedName contains keyword
-> 조건에 맞는 게시글 조회
```

여기서 `OR`는 셋 중 하나만 맞아도 된다는 뜻이다.

```text
제목이 맞거나
운동명이 맞거나
정규화된 운동명이 맞으면
검색 결과에 포함한다.
```

`some`은 연결된 운동 목록 중 하나라도 조건에 맞는지 확인한다는 뜻이다.

```text
게시글 1개
  exercises 여러 개

exercises 중 하나라도 "벤치프레스"면
그 게시글을 검색 결과에 포함
```

---

# 6. 오늘 추가할 파일 구조

추천 구조:

```text
frontend/src/
  api/
    client.ts
    auth.ts
    posts.ts
  types/
    auth.ts
    post.ts
  pages/
    SignupPage.tsx
    LoginPage.tsx
    PostListPage.tsx
    PostCreatePage.tsx
    PostDetailPage.tsx
```

역할:

| 파일 | 역할 |
| --- | --- |
| `api/client.ts` | fetch 공통 함수 |
| `api/auth.ts` | 회원가입, 로그인, 내 정보 API |
| `api/posts.ts` | 게시글 목록, 작성, 상세 API |
| `types/auth.ts` | 인증 관련 타입 |
| `types/post.ts` | 게시글 관련 타입 |
| `SignupPage.tsx` | 회원가입 화면 |
| `LoginPage.tsx` | 로그인 화면 |
| `PostListPage.tsx` | 게시글 목록 화면 |
| `PostCreatePage.tsx` | 게시글 작성 화면 |
| `PostDetailPage.tsx` | 게시글 상세 화면 |

---

# 7. 프론트 환경변수

백엔드 주소를 코드에 직접 계속 쓰면 불편하다.

프론트 폴더에 `.env`를 만든다.

파일:

```text
frontend/.env
```

내용:

```env
VITE_API_BASE_URL=http://localhost:3000
```

Vite에서는 브라우저에 노출할 환경변수 이름이 `VITE_`로 시작해야 한다.

React 코드에서는 이렇게 읽는다.

```ts
import.meta.env.VITE_API_BASE_URL
```

---

# 8. 타입 정의

React에서 백엔드 응답을 다룰 때 타입을 미리 정하면 덜 헷갈린다.

## 8.1 인증 타입

파일:

```text
frontend/src/types/auth.ts
```

코드:

```ts
export type User = {
  id: number;
  email: string;
  nickname: string;
};

export type SignupRequest = {
  email: string;
  password: string;
  nickname: string;
};

export type LoginRequest = {
  email: string;
  password: string;
};

export type LoginResponse = {
  accessToken: string;
  user: User;
};
```

해석:

```text
User            백엔드가 돌려주는 사용자 정보
SignupRequest   회원가입 요청 body
LoginRequest    로그인 요청 body
LoginResponse   로그인 성공 응답
```

## 8.2 게시글 타입

파일:

```text
frontend/src/types/post.ts
```

코드:

```ts
import type { User } from './auth';

export type ExerciseSet = {
  id: number;
  setNumber: number;
  reps: number;
  perceivedDifficulty?: number;
};

export type Exercise = {
  id: number;
  exerciseName: string;
  normalizedName?: string;
  weightKg: number;
  targetReps?: number;
  orderIndex: number;
  memo?: string;
  sets: ExerciseSet[];
};

export type Post = {
  id: number;
  authorId: number;
  title: string;
  date: string;
  bodyPart: string;
  memo?: string;
  createdAt: string;
  updatedAt: string;
  author: User;
  exercises: Exercise[];
};

export type CreatePostRequest = {
  title: string;
  date: string;
  bodyPart: string;
  memo?: string;
  exercises: {
    exerciseName: string;
    weightKg: number;
    targetReps?: number;
    sets: {
      setNumber: number;
      reps: number;
      perceivedDifficulty?: number;
    }[];
  }[];
};
```

주의:

```text
Post는 백엔드에서 받아오는 응답 타입
CreatePostRequest는 백엔드로 보내는 요청 타입
```

응답에는 `id`, `createdAt`, `author` 같은 값이 있다.

요청에는 아직 DB에 저장되기 전이라 그런 값이 없다.

---

# 9. API 공통 함수 만들기

매번 `fetch`를 직접 쓰면 코드가 길어진다.

그래서 공통 함수를 만든다.

파일:

```text
frontend/src/api/client.ts
```

코드:

```ts
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

type RequestOptions = {
  method?: string;
  body?: unknown;
  token?: string | null;
};

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'API 요청에 실패했습니다.');
  }

  return response.json() as Promise<T>;
}

export function getStoredToken() {
  return localStorage.getItem('accessToken');
}

export function storeToken(accessToken: string) {
  localStorage.setItem('accessToken', accessToken);
}

export function clearToken() {
  localStorage.removeItem('accessToken');
}
```

중요한 부분:

```ts
headers.Authorization = `Bearer ${options.token}`;
```

로그인이 필요한 API에 token을 붙인다.

```ts
body: options.body ? JSON.stringify(options.body) : undefined
```

JavaScript 객체를 JSON 문자열로 바꿔서 보낸다.

```ts
if (!response.ok) {
  throw new Error(...)
}
```

백엔드가 400, 401, 403, 404 같은 에러를 보내면 React에서도 에러로 처리한다.

---

# 10. Auth API 함수 만들기

파일:

```text
frontend/src/api/auth.ts
```

코드:

```ts
import { apiRequest, getStoredToken } from './client';
import type {
  LoginRequest,
  LoginResponse,
  SignupRequest,
  User,
} from '../types/auth';

export function signup(data: SignupRequest) {
  return apiRequest<User>('/auth/signup', {
    method: 'POST',
    body: data,
  });
}

export function login(data: LoginRequest) {
  return apiRequest<LoginResponse>('/auth/login', {
    method: 'POST',
    body: data,
  });
}

export function getMe() {
  return apiRequest<User>('/auth/me', {
    token: getStoredToken(),
  });
}
```

해석:

```text
signup()   POST /auth/signup 요청
login()    POST /auth/login 요청
getMe()    GET /auth/me 요청
```

`getMe()`는 token이 필요하므로 `getStoredToken()`을 사용한다.

---

# 11. Posts API 함수 만들기

파일:

```text
frontend/src/api/posts.ts
```

코드:

```ts
import { apiRequest, getStoredToken } from './client';
import type { CreatePostRequest, Post } from '../types/post';

export function getPosts(keyword?: string) {
  const trimmedKeyword = keyword?.trim();
  const path = trimmedKeyword
    ? `/posts?keyword=${encodeURIComponent(trimmedKeyword)}`
    : '/posts';

  return apiRequest<Post[]>(path);
}

export function getPost(id: number) {
  return apiRequest<Post>(`/posts/${id}`);
}

export function createPost(data: CreatePostRequest) {
  return apiRequest<Post>('/posts', {
    method: 'POST',
    body: data,
    token: getStoredToken(),
  });
}
```

해석:

```text
getPosts()     게시글 목록 조회
getPosts('벤치프레스') 제목/운동명 검색
getPost(id)    게시글 상세 조회
createPost()   token을 넣고 게시글 작성
```

게시글 작성은 로그인한 사용자만 가능하므로 token을 같이 보낸다.

검색어에 한글이나 공백이 들어갈 수 있으므로 `encodeURIComponent()`를 사용한다.

예:

```text
벤치 프레스
-> %EB%B2%A4%EC%B9%98%20%ED%94%84%EB%A0%88%EC%8A%A4
```

브라우저 주소에 안전하게 넣기 위한 변환이라고 보면 된다.

---

# 12. 라우팅 추가

회원가입, 로그인, 상세 페이지를 라우팅에 추가한다.

파일:

```text
frontend/src/App.tsx
```

예시 코드:

```tsx
import './App.css';
import { Link, Route, Routes } from 'react-router';
import AboutPage from './pages/AboutPage';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import NotFoundPage from './pages/NotFoundPage';
import PostCreatePage from './pages/PostCreatePage';
import PostDetailPage from './pages/PostDetailPage';
import PostListPage from './pages/PostListPage';
import SignupPage from './pages/SignupPage';
import UserPage from './pages/UserPage';

function App() {
  return (
    <>
      <header>
        <nav>
          <Link to="/">Home</Link> {' | '}
          <Link to="/signup">회원가입</Link> {' | '}
          <Link to="/login">로그인</Link> {' | '}
          <Link to="/posts">운동 기록</Link> {' | '}
          <Link to="/posts/new">기록 작성</Link> {' | '}
          <Link to="/about">About</Link> {' | '}
          <Link to="/users">Users</Link>
        </nav>
      </header>

      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/posts" element={<PostListPage />} />
        <Route path="/posts/new" element={<PostCreatePage />} />
        <Route path="/posts/:id" element={<PostDetailPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/users" element={<UserPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}

export default App;
```

핵심:

```text
/signup      회원가입
/login       로그인
/posts/:id   게시글 상세
```

---

# 13. 회원가입 페이지

파일:

```text
frontend/src/pages/SignupPage.tsx
```

코드:

```tsx
import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { signup } from '../api/auth';

export default function SignupPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    try {
      await signup({
        email,
        password,
        nickname,
      });

      navigate('/login');
    } catch (error) {
      setError(error instanceof Error ? error.message : '회원가입에 실패했습니다.');
    }
  }

  return (
    <main>
      <h1>회원가입</h1>

      <form onSubmit={handleSubmit}>
        <label>
          이메일
          <input value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>

        <label>
          비밀번호
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        <label>
          닉네임
          <input value={nickname} onChange={(event) => setNickname(event.target.value)} />
        </label>

        <button type="submit">가입하기</button>
      </form>

      {error && <p>{error}</p>}
    </main>
  );
}
```

흐름:

```text
input에 입력
        ↓
useState에 값 저장
        ↓
form 제출
        ↓
signup API 호출
        ↓
성공하면 /login으로 이동
```

---

# 14. 로그인 페이지

파일:

```text
frontend/src/pages/LoginPage.tsx
```

코드:

```tsx
import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { login } from '../api/auth';
import { storeToken } from '../api/client';

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    try {
      const result = await login({
        email,
        password,
      });

      storeToken(result.accessToken);
      navigate('/posts');
    } catch (error) {
      setError(error instanceof Error ? error.message : '로그인에 실패했습니다.');
    }
  }

  return (
    <main>
      <h1>로그인</h1>

      <form onSubmit={handleSubmit}>
        <label>
          이메일
          <input value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>

        <label>
          비밀번호
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        <button type="submit">로그인</button>
      </form>

      {error && <p>{error}</p>}
    </main>
  );
}
```

핵심:

```ts
storeToken(result.accessToken);
```

로그인 성공 후 받은 accessToken을 브라우저의 `localStorage`에 저장한다.

나중에 게시글 작성할 때 이 token을 꺼내서 header에 넣는다.

---

# 15. 게시글 목록 페이지

파일:

```text
frontend/src/pages/PostListPage.tsx
```

코드:

```tsx
import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { getPosts } from '../api/posts';
import type { Post } from '../types/post';

export default function PostListPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [keyword, setKeyword] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadPosts() {
      try {
        const data = await getPosts();
        setPosts(data);
      } catch (error) {
        setError(error instanceof Error ? error.message : '게시글 목록 조회에 실패했습니다.');
      } finally {
        setIsLoading(false);
      }
    }

    loadPosts();
  }, []);

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const data = await getPosts(keyword);
      setPosts(data);
    } catch (error) {
      setError(error instanceof Error ? error.message : '게시글 검색에 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  }

  if (isLoading) {
    return <main>게시글을 불러오는 중입니다.</main>;
  }

  return (
    <main>
      <h1>운동 기록 게시판</h1>
      <Link to="/posts/new">운동 기록 작성</Link>

      <form onSubmit={handleSearch}>
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="제목 또는 운동명 검색"
        />
        <button type="submit">검색</button>
      </form>

      {error && <p>{error}</p>}

      <ul>
        {posts.map((post) => (
          <li key={post.id}>
            <Link to={`/posts/${post.id}`}>{post.title}</Link>
            <div>{post.bodyPart}</div>
            <div>{post.author.nickname}</div>
            <div>{new Date(post.date).toLocaleDateString()}</div>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

핵심:

```ts
useEffect(() => {
  loadPosts();
}, []);
```

페이지가 처음 열릴 때 게시글 목록을 한 번 불러온다.

```tsx
<form onSubmit={handleSearch}>
```

검색 버튼을 누르면 `handleSearch()`가 실행된다.

```ts
const data = await getPosts(keyword);
```

입력한 검색어를 백엔드로 보낸다.

```tsx
posts.map((post) => ...)
```

게시글 배열을 화면의 `<li>` 목록으로 바꾼다.

---

# 16. 게시글 작성 페이지

처음부터 운동 여러 개를 동적으로 추가하는 폼은 어렵다.

오늘은 MVP용으로 운동 1개, 세트 3개를 입력하는 폼부터 만든다.

파일:

```text
frontend/src/pages/PostCreatePage.tsx
```

코드:

```tsx
import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { createPost } from '../api/posts';

export default function PostCreatePage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [bodyPart, setBodyPart] = useState('');
  const [memo, setMemo] = useState('');
  const [exerciseName, setExerciseName] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [targetReps, setTargetReps] = useState('');
  const [set1Reps, setSet1Reps] = useState('');
  const [set2Reps, setSet2Reps] = useState('');
  const [set3Reps, setSet3Reps] = useState('');
  const [error, setError] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    try {
      const post = await createPost({
        title,
        date,
        bodyPart,
        memo,
        exercises: [
          {
            exerciseName,
            weightKg: Number(weightKg),
            targetReps: targetReps ? Number(targetReps) : undefined,
            sets: [
              { setNumber: 1, reps: Number(set1Reps) },
              { setNumber: 2, reps: Number(set2Reps) },
              { setNumber: 3, reps: Number(set3Reps) },
            ],
          },
        ],
      });

      navigate(`/posts/${post.id}`);
    } catch (error) {
      setError(error instanceof Error ? error.message : '게시글 작성에 실패했습니다.');
    }
  }

  return (
    <main>
      <h1>운동 기록 작성</h1>

      <form onSubmit={handleSubmit}>
        <label>
          제목
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>

        <label>
          운동 날짜
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>

        <label>
          운동 부위
          <input value={bodyPart} onChange={(event) => setBodyPart(event.target.value)} />
        </label>

        <label>
          메모
          <textarea value={memo} onChange={(event) => setMemo(event.target.value)} />
        </label>

        <label>
          운동명
          <input value={exerciseName} onChange={(event) => setExerciseName(event.target.value)} />
        </label>

        <label>
          무게 kg
          <input value={weightKg} onChange={(event) => setWeightKg(event.target.value)} />
        </label>

        <label>
          목표 반복 수
          <input value={targetReps} onChange={(event) => setTargetReps(event.target.value)} />
        </label>

        <label>
          1세트 반복 수
          <input value={set1Reps} onChange={(event) => setSet1Reps(event.target.value)} />
        </label>

        <label>
          2세트 반복 수
          <input value={set2Reps} onChange={(event) => setSet2Reps(event.target.value)} />
        </label>

        <label>
          3세트 반복 수
          <input value={set3Reps} onChange={(event) => setSet3Reps(event.target.value)} />
        </label>

        <button type="submit">저장하기</button>
      </form>

      {error && <p>{error}</p>}
    </main>
  );
}
```

중요한 부분:

```ts
weightKg: Number(weightKg)
```

input 값은 문자열이다.

백엔드는 숫자를 기대하므로 `Number()`로 바꿔서 보낸다.

---

# 17. 게시글 상세 페이지

파일:

```text
frontend/src/pages/PostDetailPage.tsx
```

코드:

```tsx
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { getPost } from '../api/posts';
import type { Post } from '../types/post';

export default function PostDetailPage() {
  const params = useParams();
  const postId = Number(params.id);
  const [post, setPost] = useState<Post | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadPost() {
      try {
        const data = await getPost(postId);
        setPost(data);
      } catch (error) {
        setError(error instanceof Error ? error.message : '게시글 조회에 실패했습니다.');
      } finally {
        setIsLoading(false);
      }
    }

    loadPost();
  }, [postId]);

  if (isLoading) {
    return <main>게시글을 불러오는 중입니다.</main>;
  }

  if (!post) {
    return <main>{error || '게시글을 찾을 수 없습니다.'}</main>;
  }

  return (
    <main>
      <Link to="/posts">목록으로</Link>
      <h1>{post.title}</h1>
      <p>작성자: {post.author.nickname}</p>
      <p>운동 날짜: {new Date(post.date).toLocaleDateString()}</p>
      <p>운동 부위: {post.bodyPart}</p>
      {post.memo && <p>메모: {post.memo}</p>}

      <section>
        <h2>운동 기록</h2>
        {post.exercises.map((exercise) => (
          <article key={exercise.id}>
            <h3>{exercise.exerciseName}</h3>
            <p>무게: {exercise.weightKg}kg</p>
            {exercise.targetReps && <p>목표 반복 수: {exercise.targetReps}</p>}

            <ul>
              {exercise.sets.map((set) => (
                <li key={set.id}>
                  {set.setNumber}세트: {set.reps}회
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>
    </main>
  );
}
```

핵심:

```ts
const params = useParams();
const postId = Number(params.id);
```

URL의 `/posts/:id`에서 `id`를 꺼낸다.

예:

```text
/posts/7
```

이면:

```text
params.id = "7"
postId = 7
```

---

# 18. 오늘 테스트 흐름

## 18.1 백엔드 실행

```bash
cd /Users/igyeong-geun/Documents/jungle/week15/ai-workout-board
docker compose up -d

cd backend
npm run start:dev
```

## 18.2 프론트 실행

새 터미널에서:

```bash
cd /Users/igyeong-geun/Documents/jungle/week15/ai-workout-board/frontend
npm run dev
```

Vite가 알려주는 주소로 들어간다.

보통:

```text
http://localhost:5173
```

## 18.3 브라우저에서 확인

```text
1. /signup 접속
2. 회원가입
3. /login 이동
4. 로그인
5. /posts 이동
6. /posts/new 이동
7. 운동 기록 작성
8. 저장 후 /posts/:id 상세 페이지 확인
9. /posts 목록에 작성한 글이 보이는지 확인
```

---

# 19. 자주 터지는 문제

## 19.1 Failed to fetch

의미:

```text
React가 백엔드 서버에 연결하지 못했다.
```

확인:

```text
백엔드가 켜져 있는가?
백엔드 주소가 http://localhost:3000이 맞는가?
CORS가 켜져 있는가?
```

## 19.2 401 Unauthorized

의미:

```text
token이 없거나 잘못됐다.
```

확인:

```text
로그인 성공 후 accessToken이 localStorage에 저장됐는가?
POST /posts 요청에 Authorization header가 붙었는가?
```

## 19.3 400 Bad Request

의미:

```text
백엔드 DTO 규칙에 맞지 않는 body를 보냈다.
```

확인:

```text
exercises 배열이 비어 있지 않은가?
sets 배열이 비어 있지 않은가?
date가 YYYY-MM-DD 형식인가?
weightKg, reps가 숫자인가?
```

---

# 20. 오늘 마감 체크

금요일 밤에는 검색까지 확인한다.

다만 댓글, 태그, 페이징, AI 분석은 시작하지 않는다.

체크할 것:

```text
프론트 npm run build 성공
백엔드 npm run build 성공
회원가입 화면에서 가입 가능
로그인 화면에서 로그인 가능
localStorage에 accessToken 저장
게시글 작성 화면에서 운동 기록 저장 가능
게시글 목록 화면에서 저장된 글 확인 가능
게시글 상세 화면에서 저장된 운동 기록 확인 가능
게시글 목록에서 제목 검색 가능
게시글 목록에서 운동명 검색 가능
```

---

# 21. 오늘 완료 기준

오늘은 아래가 되면 성공이다.

```text
브라우저에서 회원가입 가능
브라우저에서 로그인 가능
로그인 후 accessToken 저장
브라우저에서 게시글 작성 가능
브라우저에서 게시글 목록 조회 가능
브라우저에서 게시글 상세 조회 가능
브라우저에서 제목/운동명 검색 가능
```

오늘 중요한 것은 디자인이 아니다.

일단 화면이 못생겨도 괜찮다.

핵심은:

```text
브라우저 화면과 백엔드 API가 실제로 연결되고,
제목/운동명 검색까지 되는 것
```
