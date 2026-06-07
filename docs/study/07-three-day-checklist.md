# 07. 3일 학습 체크리스트

이 문서는 3일 동안 무엇을 끝내야 하는지 정리한 체크리스트다.

## Day 1: 개념 + React

읽을 문서:

```txt
docs/study/01-mini-board-from-concepts-to-code.md
docs/study/02-react-mini-board-code.md
```

해야 할 일:

```txt
[ ] 전체 구조 이해
[ ] React component 이해
[ ] useState 이해
[ ] map 이해
[ ] React Router 이해
[ ] web/src/data/posts.ts 작성
[ ] PostListPage 작성
[ ] PostDetailPage 작성
[ ] PostNewPage 작성
[ ] App.tsx 라우팅 수정
```

완료 기준:

```txt
/posts에서 글 목록이 보인다.
/posts/1에서 글 상세가 보인다.
/posts/new에서 글 작성 폼이 보인다.
```

## Day 2: NestJS API

읽을 문서:

```txt
docs/study/03-nestjs-mini-board-code.md
docs/study/04-connect-react-to-nestjs.md
```

해야 할 일:

```txt
[ ] Module 개념 이해
[ ] Controller 개념 이해
[ ] Service 개념 이해
[ ] DTO 개념 이해
[ ] GET /posts 작성
[ ] GET /posts/:id 작성
[ ] POST /posts 작성
[ ] React에서 axios로 API 호출
```

완료 기준:

```txt
React 글 목록이 NestJS 데이터를 보여준다.
React 글 작성 화면에서 저장하면 NestJS POST /posts가 호출된다.
```

## Day 3: DB + FastAPI 연결

읽을 문서:

```txt
docs/study/05-prisma-postgresql-save-data.md
docs/study/06-fastapi-connection.md
```

해야 할 일:

```txt
[ ] Docker Desktop 실행
[ ] npm.cmd run db:up 실행
[ ] Prisma Post model 작성
[ ] migration 실행
[ ] PrismaService 작성
[ ] PostsService를 Prisma로 변경
[ ] FastAPI 실행
[ ] NestJS /health/ai 확인
```

완료 기준:

```txt
글이 DB에 저장된다.
서버를 재시작해도 글이 남아 있다.
NestJS가 FastAPI 상태를 보여준다.
```

## 3일 동안 하지 않을 것

```txt
로그인
JWT
회원가입
댓글
태그
검색
이미지 업로드
RAG
MCP
Agent
디자인 고도화
```

## 최종 결과

3일 뒤 목표는 이것이다.

```txt
React 화면
NestJS API
PostgreSQL 저장
FastAPI 연결 확인
```

이 4개가 되면 학습 목표는 성공이다.
