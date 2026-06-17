# agentic-board

뮤지컬 관람 후기를 좌석 단위로 모아 검색하고, AI가 좌석 선택을 보조하는 게시판 서비스입니다. 사용자는 극장, 공연, 층/구역/열/번호를 기준으로 후기를 남기고 시야, 음향, 편의성, 표정, 무대 가시성을 평가할 수 있습니다. 후기에는 태그, 댓글, 대댓글, 좋아요, 신고가 붙고, 관리자는 신고된 후기와 댓글을 숨기거나 복구할 수 있습니다.

이 저장소는 프론트엔드, NestJS API, FastAPI 에이전트 서버, PostgreSQL을 한 번에 개발하기 위한 멀티 앱 워크스페이스입니다.

## 주요 기능

- 좌석 후기 작성, 수정, 삭제, 상세 조회
- 극장/공연/좌석/태그/평점 기반 후기 검색과 정렬
- 극장별 좌석 배치 UI와 공연 메타데이터 선택
- 회원가입, 로그인, JWT, refresh session, Google OAuth
- 댓글, 대댓글, 좋아요, 후기/댓글 신고
- 관리자 신고 목록, 숨김/복구/강제 삭제, 감사 로그
- 후기 문서 기반 RAG 질의 응답
- FastAPI 기반 좌석 추천 에이전트와 좌석 배치 MCP API
- Prisma migration, seed, 샘플 데이터 import/backfill 스크립트

## 아키텍처

![agentic-board architecture](docs/architecture.svg)

### 앱 구성

```text
agentic-board/
  apps/
    web-react/       React/Vite 프론트엔드
    nest-api/        NestJS 메인 백엔드 API
    fastapi-api/     FastAPI 좌석 추천/보조 API
  docker-compose.yml PostgreSQL + pgvector 로컬 DB
  package.json       루트 개발 스크립트
  requirements.txt   루트 Python 의존성 진입점
```

### 역할 분리

| 영역 | 위치 | 역할 |
| --- | --- | --- |
| Web | `apps/web-react` | 후기 목록, 상세, 작성, 인증, 관리자 화면 |
| Main API | `apps/nest-api` | 인증, 후기, 댓글, 태그, 관리자, RAG API |
| Agent API | `apps/fastapi-api` | 좌석 추천, 좌석 배치 조회, demo/chat API |
| DB | `docker-compose.yml` | PostgreSQL 16 + pgvector |
| ORM | `apps/nest-api/prisma` | Prisma schema, migrations, seed/backfill |

## 기술 스택

- Frontend: React, Vite, TypeScript, React Router
- Backend: NestJS, Prisma, Passport/JWT
- Agent API: FastAPI, Uvicorn
- Database: PostgreSQL, pgvector
- AI/RAG: OpenAI embedding/chat API
- Tooling: Jest, Supertest, Node test scripts, pytest, Docker Compose

## API 개요

### NestJS API

기본 포트는 `3000`입니다.

- `GET /health`
- `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`
- `GET /auth/google`, `GET /auth/google/callback`, `GET /auth/me`
- `GET /theaters`, `GET /musicals`, `GET /performances`
- `POST /seat-reviews`, `GET /seat-reviews`, `GET /seat-reviews/search`, `GET /seat-reviews/:id`
- `PATCH /seat-reviews/:id`, `DELETE /seat-reviews/:id`
- `GET /tags`, `GET /tags/:tagId/seat-reviews`
- `POST /seat-reviews/:reviewId/comments`, `GET /seat-reviews/:reviewId/comments`
- `PATCH /comments/:id`, `DELETE /comments/:id`, `POST /comments/:id/like`
- `POST /rag/questions`, `POST /rag/index`, `POST /rag/index/:reviewId`
- `GET /admin/reports`, `PATCH /admin/seat-reviews/:id/hide`, `PATCH /admin/comments/:id/hide`

### FastAPI API

기본 포트는 `8000`입니다.

- `GET /hello`
- `POST /chat`
- `POST /agent/seat-recommendations`
- `GET /mcp/seat-layouts/{theater_name}`
- `POST /mcp/cache/refresh`

## 로컬 실행

### 1. 사전 준비

- Node.js 20 이상 권장
- Python 3.11 이상 권장
- Docker Desktop
- npm

### 2. 의존성 설치

루트에서 실행합니다.

```powershell
npm run nest:install
npm run web:install

python -m venv apps/fastapi-api/.venv
.\apps\fastapi-api\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 3. 데이터베이스 실행

```powershell
npm run db:up
```

PostgreSQL 접속 정보는 `docker-compose.yml` 기준으로 다음과 같습니다.

```text
host: localhost
port: 5432
database: agentic_board
user: postgres
password: postgres
```

### 4. NestJS 환경 변수 설정

`apps/nest-api/.env` 파일을 만들고 최소 설정을 넣습니다.

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/agentic_board"
JWT_SECRET="replace-with-a-long-random-secret"
JWT_EXPIRES_IN="1d"
PORT=3000
CORS_ORIGINS="http://localhost:5173,http://127.0.0.1:5173"

WEB_APP_ORIGIN="http://localhost:5173"
FRONTEND_ORIGIN="http://localhost:5173"

# Google OAuth를 사용할 때만 필요합니다.
GOOGLE_OAUTH_CLIENT_ID=""
GOOGLE_OAUTH_CLIENT_SECRET=""
GOOGLE_OAUTH_REDIRECT_URI="http://localhost:3000/auth/google/callback"
GOOGLE_OAUTH_STATE_SECRET=""

# RAG 기능을 사용할 때만 필요합니다.
OPENAI_API_KEY=""
OPENAI_EMBEDDING_MODEL="text-embedding-3-small"
OPENAI_CHAT_MODEL="gpt-5.5"
```

### 5. Prisma migration/seed

```powershell
cd apps/nest-api
npx prisma migrate dev
npm run db:seed
cd ..\..
```

샘플 데이터나 검색 보강이 필요하면 Nest 앱 디렉터리에서 아래 스크립트를 사용할 수 있습니다.

```powershell
npm run db:import:seeya-sejong
npm run db:backfill-tags
npm run rag:backfill
```

### 6. FastAPI 환경 변수 설정

기본값은 `apps/fastapi-api/.env.example`을 참고합니다. 필요하면 복사해서 수정합니다.

```powershell
Copy-Item apps/fastapi-api/.env.example apps/fastapi-api/.env
```

### 7. 개발 서버 실행

터미널을 3개 열고 각각 실행합니다.

NestJS API:

```powershell
npm run nest:start
```

FastAPI:

```powershell
.\apps\fastapi-api\.venv\Scripts\Activate.ps1
cd apps/fastapi-api
uvicorn main:app --reload --port 8000
```

React:

```powershell
npm run web:dev
```

접속 주소:

- Web: `http://localhost:5173`
- NestJS API: `http://localhost:3000`
- FastAPI docs: `http://localhost:8000/docs`

## 프론트엔드 환경 변수

기본값이 코드에 들어 있어 로컬에서는 별도 설정 없이 동작합니다.

```env
VITE_API_BASE_URL="http://localhost:3000"
VITE_AGENT_API_BASE_URL="http://localhost:8000"
```

다른 주소를 쓰려면 `apps/web-react/.env`에 위 값을 넣습니다.

## 주요 명령어

루트에서 실행하는 명령입니다.

```powershell
npm run db:up          # PostgreSQL 실행
npm run db:down        # PostgreSQL 종료
npm run db:logs        # DB 로그 확인

npm run nest:start     # NestJS 개발 서버
npm run nest:build     # NestJS 빌드
npm run nest:test      # NestJS unit test
npm run nest:test:e2e  # NestJS e2e test

npm run web:dev        # React 개발 서버
npm run web:build      # React 빌드
npm run web:lint       # React lint
```

FastAPI 테스트:

```powershell
cd apps/fastapi-api
$env:PYTHONPATH='.'
python -m pytest tests -p no:cacheprovider
```

React 테스트:

```powershell
npm --prefix apps/web-react test
```

## 데이터 모델 요약

핵심 테이블은 `apps/nest-api/prisma/schema.prisma`에 정의되어 있습니다.

- `User`, `AuthSession`, `PasswordResetToken`: 사용자와 인증 세션
- `Theater`, `Musical`, `Performance`: 극장, 작품, 공연 시즌
- `SeatReview`: 좌석 후기와 5개 평점
- `Tag`, `SeatReviewTag`: 후기 태그
- `Comment`, `CommentLike`: 댓글, 대댓글, 좋아요
- `ReviewReport`, `CommentReport`, `AuditLog`: 신고와 관리자 처리 이력
- `SeatReviewEmbedding`, `RagQueryLog`: RAG 문서 임베딩과 질의 로그

## 개발 메모

- NestJS는 `DATABASE_URL`이 없으면 부팅하지 않습니다.
- 프론트엔드는 쿠키 인증을 사용하므로 NestJS CORS에서 `credentials: true`가 켜져 있습니다.
- Google OAuth redirect URI는 Google Cloud Console과 `.env` 값이 정확히 같아야 합니다.
- RAG API와 backfill은 `OPENAI_API_KEY`가 없으면 정상 동작하지 않습니다.
- PostgreSQL 컨테이너는 `pgvector/pgvector:pg16` 이미지를 사용합니다.
- 일부 좌석 배치 데이터는 `apps/web-react/src/features/reviews/theater-seat-map-configs.ts`에 정적으로 들어 있습니다.

## 문제 해결

### `DATABASE_URL must be set`

`apps/nest-api/.env`에 `DATABASE_URL`이 있는지 확인합니다.

### `jest is not recognized`

`apps/nest-api/node_modules`가 없을 때 발생합니다.

```powershell
npm run nest:install
```

### FastAPI 테스트에서 `No module named 'app'`

FastAPI 앱 디렉터리에서 `PYTHONPATH`를 지정하고 실행합니다.

```powershell
cd apps/fastapi-api
$env:PYTHONPATH='.'
python -m pytest tests -p no:cacheprovider
```

### 프론트에서 API 요청 실패

- NestJS가 `http://localhost:3000`에서 실행 중인지 확인합니다.
- FastAPI가 `http://localhost:8000`에서 실행 중인지 확인합니다.
- 다른 포트를 쓰는 경우 `apps/web-react/.env`의 `VITE_API_BASE_URL`, `VITE_AGENT_API_BASE_URL`을 수정합니다.
