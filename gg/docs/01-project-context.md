# 01. Project Context

이 문서는 **AI 운동 기록 인증 게시판**의 현재 기준 정보를 정리한다.
Codex는 작업 전 이 문서를 읽고 현재 프로젝트의 맥락을 파악해야 한다.

---

## 1. 프로젝트 이름

```text
AI 운동 기록 인증 게시판
```

---

## 2. 프로젝트 목적

사용자가 운동 기록을 게시글처럼 남기고, 이전 운동 기록을 바탕으로 다음 운동 목표를 추천받는 서비스다.

핵심 주제는 다음이다.

```text
운동 기록 기반 점진적 과부하 보조
```

이 프로젝트는 의학 조언이나 부상 진단 서비스가 아니다.
운동 초보자가 꾸준히 기록하고, 지난 기록보다 조금씩 성장하고 있다는 느낌을 받을 수 있게 돕는 학습용 AI 보조 서비스다.

---

## 3. 핵심 사용자

```text
- 운동 기록을 꾸준히 남기고 싶은 운동 초보자
- 이전 기록과 현재 기록을 비교해 다음 목표를 정하고 싶은 사용자
- 복잡한 전문 트레이닝 앱보다 쉬운 게시판형 기록 서비스를 원하는 사용자
```

관리자 기능은 현재 MVP 범위에 포함하지 않는다.

---

## 4. 현재 기술 스택

```text
Frontend:
- React
- Vite
- TypeScript
- React Router

Backend:
- NestJS
- TypeScript
- Prisma ORM

Database:
- PostgreSQL
- Docker Compose 기반 로컬 DB

Auth:
- JWT
- bcrypt

AI / External:
- FastAPI
- Python
- Pydantic BaseModel
- OpenAI Responses API 호출 시도
- OpenAI API 키가 없거나 호출 실패 시 rule-based fallback
- FastAPI 내부 MCP-style 운동명 정규화 tool
- 5단계 Agent workflow

Infra:
- Docker Compose
```

---

## 5. 현재 구현된 기능

```text
완료:
- 회원가입
- 로그인
- JWT 발급
- JWT Guard 기반 보호 API
- 내 정보 조회
- 운동 기록 게시글 작성
- 운동 기록 게시글 목록
- 운동 기록 게시글 상세
- 운동 기록 게시글 수정
- 운동 기록 게시글 삭제
- 작성자 본인만 수정/삭제 가능
- 제목/운동명 검색
- React 게시글 목록 화면
- React 게시글 작성 화면
- React 게시글 상세 화면
- 게시글 상세 화면 AI 분석 버튼
- FastAPI /health
- FastAPI /internal/health
- FastAPI /analysis/demo
- NestJS GET /ai/health
- NestJS POST /posts/:id/analyze
- NestJS -> FastAPI AI 분석 연결
- 같은 사용자 + 같은 운동명 + 과거 날짜 + 최근 3개 기준 이전 기록 조회
- 이전 기록 기반 구조화 검색 RAG
- AI 분석 결과 화면 표시
- AI 분석 결과의 참고 기록과 분석 근거 화면 표시
- FastAPI 내부 운동명 정규화 tool endpoint
- AI 분석 workflowSteps/toolCalls 응답
- Agent workflow 기반 분석 흐름

진행 중:
- #11 MCP tool과 #12 Agent workflow 브랜치 검증

예정:
- 댓글, 태그, 페이징 보강
- README와 발표 자료 정리
```

---

## 6. 현재 아키텍처 요약

일반 게시판 흐름:

```text
React Frontend
  -> NestJS Backend
  -> Prisma
  -> PostgreSQL
```

AI 분석 흐름:

```text
React Frontend
  -> NestJS Backend
  -> PostgreSQL에서 현재 게시글과 이전 기록 조회
  -> FastAPI AI Server
  -> NestJS Backend
  -> React Frontend
```

각 영역의 책임:

```text
Frontend:
- 화면 표시
- 사용자 입력 받기
- NestJS API 호출
- accessToken 저장 및 Authorization 헤더 전송
- AI 분석 결과 화면 표시

Backend:
- Auth API 제공
- Posts API 제공
- JWT 검증
- 작성자 권한 검사
- Prisma를 통한 DB 접근
- FastAPI 호출
- React에 최종 응답 반환

Database:
- 사용자 저장
- 게시글 저장
- 운동 종목 저장
- 세트 기록 저장

External / AI:
- FastAPI가 현재 기록과 이전 기록을 받아 분석 결과 생성
- FastAPI 내부 MCP-style tool endpoint로 운동명 정규화
- Agent workflow가 현재 기록 입력, 운동명 정규화, 이전 기록 검색 결과 수신, AI 분석 실행, 결과 반환 순서를 관리
- OpenAI API 키가 있으면 OpenAI Responses API 호출 시도
- OpenAI API 키가 없거나 호출 실패 시 rule-based 분석으로 fallback
- 분석 결과는 DB에 저장하지 않고 화면에만 표시
```

중요 원칙:

```text
React는 FastAPI를 직접 호출하지 않는다.
AI 분석 요청은 반드시 NestJS를 거친다.
```

---

## 7. 주요 폴더 구조

```text
ai-workout-board/
├── AGENTS.md
├── README.md
├── docker-compose.yml
├── ai-server/
│   └── app/
│       ├── main.py
│       ├── routers/
│       ├── schemas/
│       └── services/
├── backend/
│   ├── prisma/
│   │   └── schema.prisma
│   └── src/
│       ├── ai/
│       ├── auth/
│       ├── posts/
│       └── prisma/
├── frontend/
│   └── src/
│       ├── api/
│       ├── pages/
│       └── types/
├── docs/
└── study/
```

중요 파일:

```text
- AGENTS.md
- docs/01-project-context.md
- docs/08-decision-log.md
- backend/prisma/schema.prisma
- backend/src/posts/posts.service.ts
- backend/src/auth/jwt-auth.guard.ts
- backend/src/ai/ai.service.ts
- ai-server/app/routers/internal.py
- ai-server/app/routers/analysis.py
- ai-server/app/services/analysis_service.py
- frontend/src/api/posts.ts
- frontend/src/pages/PostDetailPage.tsx
```

---

## 8. 주요 API

Auth API:

```text
POST   /auth/signup
POST   /auth/login
GET    /auth/me
```

Posts API:

```text
POST   /posts
GET    /posts
GET    /posts?keyword=벤치프레스
GET    /posts/:id
PATCH  /posts/:id
DELETE /posts/:id
POST   /posts/:id/analyze
```

AI 연결 확인 API:

```text
GET    /ai/health
```

FastAPI API:

```text
GET    /health
GET    /internal/health
POST   /analysis/demo
```

보호 API:

```text
- POST /posts
- PATCH /posts/:id
- DELETE /posts/:id
- POST /posts/:id/analyze
- GET /auth/me
```

권한 검사가 필요한 API:

```text
- PATCH /posts/:id
- DELETE /posts/:id
- POST /posts/:id/analyze
```

---

## 9. 주요 데이터 모델

```text
User
  id
  email
  nickname
  passwordHash
  createdAt
  updatedAt

Post
  id
  authorId
  title
  date
  bodyPart
  memo
  createdAt
  updatedAt

Exercise
  id
  postId
  exerciseName
  normalizedName
  weightKg
  targetReps
  orderIndex
  memo

ExerciseSet
  id
  exerciseId
  setNumber
  reps
  perceivedDifficulty
```

관계:

```text
User -> Post[]
Post -> Exercise[]
Exercise -> ExerciseSet[]
```

---

## 10. 실행 / 빌드 / 테스트 명령어

PostgreSQL:

```bash
docker compose up -d
docker compose ps
```

Backend:

```bash
cd backend
npm run start:dev
npm run build
```

Frontend:

```bash
cd frontend
npm run dev
npm run build
```

AI Server:

```bash
cd ai-server
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

Health check:

```bash
curl http://localhost:8000/health
curl http://localhost:8000/internal/health -H "X-Internal-Token: change-me"
curl http://localhost:3000/health
curl http://localhost:3000/ai/health
```

---

## 11. 건드리면 위험한 영역

```text
- backend/prisma/schema.prisma
- Prisma migration
- 인증 로직
- JWT Guard
- 기존 API 응답 형식
- React가 FastAPI를 직접 호출하지 않는 구조
- 게시글 상세 화면의 AI 분석 흐름
- docs/08-decision-log.md에 기록된 설계 결정
```

---

## 12. 현재 설계 결정

```text
- 2026-06-15 AI 분석 결과는 DB에 저장하지 않고 화면에만 표시한다.
- 2026-06-15 React는 FastAPI를 직접 호출하지 않고 NestJS를 거친다.
- 2026-06-15 #9 AI 분석과 #10 RAG 최소 구현은 한 브랜치에서 함께 진행한다.
- 2026-06-15 OpenAI 호출이 불가능하면 rule-based 분석으로 fallback한다.
```

자세한 결정 기록은 `docs/08-decision-log.md`에 남긴다.
