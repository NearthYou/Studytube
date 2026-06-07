# StudyTube Board

AI 응용 기술을 활용한 YouTube 학습 게시판입니다. 사용자는 공부한 YouTube 영상을 게시글로 정리하고, 요약/번역 노트, 댓글, 태그, 플레이리스트, 피드백을 관리할 수 있습니다. AI 기능은 과제 요구사항에 맞춰 RAG, MCP, AI Agent를 각각 분리해 구현했습니다.

## 1. 프로젝트 개요

StudyTube Board는 YouTube로 공부하는 사람을 위한 개인 학습 커뮤니티형 게시판입니다.

- 영상 URL 기반 학습글 작성
- 영상 요약과 번역 자막/학습 노트 저장
- 태그, 댓글, 검색, 페이징
- 학습 플레이리스트 생성과 피드백
- RAG 기반 유사 게시글 추천
- MCP 기반 YouTube 메타데이터 조회
- Agent 기반 맞춤형 학습 플레이리스트 생성

## 2. 주요 구현 기능

### 기본 게시판 기능

- 회원가입: `POST /auth/signup`
- 로그인: `POST /auth/login`
- 로그인 게이트: React 보호 라우트로 로그인/회원가입 외 모든 서비스 화면 차단
- 데모 계정: `demo@studytube.local` / `demo1234`
- 게시물 CRUD: `GET/POST/PUT/DELETE /posts`
- 게시글 작성: YouTube URL 입력 시 MCP로 제목, 채널명, 태그, 요약, 썸네일 자동 입력
- 댓글: `POST /posts/:id/comments`
- 태그: 게시글 생성/수정 시 자동 정규화
- 페이징: `GET /posts?page=1&pageSize=3`
- 검색: 제목, 요약, 번역 노트, 채널명, 태그 검색
- 플레이리스트: `GET/POST /playlists`
- 플레이리스트 피드백: `POST /playlists/:id/feedback`
- 영상 보기: 사이트 내부 YouTube 플레이어, 우측 재생목록, 순차 재생, 항목 삭제, 자막 토글

### AI 활용 기능

- RAG: `POST /ai/rag/recommend`
- MCP: `POST /ai/mcp/youtube`, FastAPI 내부 JSON-RPC `/mcp`
- Agent: `POST /ai/agent/study-plan`

## 3. 전체 아키텍처 구조

```txt
web/ React + Vite + TypeScript
  |
  v
api/ NestJS REST API
  |-- PostgreSQL + pgvector
  |-- in-memory local repository when PostgreSQL is unavailable
  |
  v
ai/ FastAPI
  |-- RAG retrieval
  |-- MCP JSON-RPC server
  |-- bounded Agent loop
  |-- optional OpenAI-compatible LLM / embedding model
```

### 기술 스택

- 프론트엔드: React, Vite, TypeScript
- 백엔드: NestJS
- AI 백엔드: FastAPI
- 데이터베이스: PostgreSQL, pgvector
- ORM 문서화: Prisma schema
- LLM: OpenAI-compatible commercial model 설정 지원
- Embedding: OpenAI-compatible embedding model 설정 지원, 로컬 deterministic embedding 포함
- Vector DB: PostgreSQL pgvector

## 4. AI 활용 기능, 기술, 아키텍처 구조

### RAG 기능

기능명: 유사 학습글 자동 추천 및 요약

흐름:

1. 사용자가 질문하거나 게시글을 선택합니다.
2. FastAPI가 게시판의 글 제목, 요약, 번역 노트, 태그를 검색 대상으로 사용합니다.
3. `OPENAI_API_KEY`가 있으면 상용 embedding 모델을 사용할 수 있도록 설정값을 둡니다.
4. 키가 없거나 로컬 데모일 때는 deterministic hash embedding으로 동작합니다.
5. PostgreSQL의 `post_embeddings` 테이블은 `vector(64)` 타입으로 설계했습니다.
6. 결과는 관련 게시글, 점수, 요약 답변으로 반환됩니다.

관련 파일:

- `ai/main.py`
- `api/src/ai-proxy.service.ts`
- `api/src/database.service.ts`
- `api/prisma/schema.prisma`

### MCP 기능

기능명: YouTube 영상 메타데이터 조회 도구

FastAPI는 JSON-RPC 2.0 형식의 MCP 서버 역할을 하는 `/mcp` 엔드포인트를 제공합니다.

지원 method:

```json
{
  "jsonrpc": "2.0",
  "id": "demo",
  "method": "youtube.lookup",
  "params": {
    "query": "react hooks beginner"
  }
}
```

외부 서비스 연동:

- YouTube URL이 들어오면 YouTube oEmbed API를 호출합니다.
- 검색어가 들어오면 `YOUTUBE_API_KEY`가 있을 때 공식 YouTube Data API를 호출합니다.
- API 키가 없으면 YouTube 검색 페이지의 공개 메타데이터를 파싱해 실제 영상 후보 목록을 가져옵니다.
- 외부 네트워크가 막히면 fake 영상 대신 `youtube-search-unavailable`과 빈 `videos`를 반환합니다.
- API Key는 `.env`의 `YOUTUBE_API_KEY`에 둘 수 있도록 문서화했습니다.

권한 관리 전략:

- 브라우저는 NestJS API만 호출합니다.
- NestJS와 FastAPI 사이 내부 호출에는 `INTERNAL_AI_API_KEY`를 사용할 수 있습니다.
- 외부 API 키와 LLM 키는 서버 `.env`에만 둡니다.

### Agent 기능

기능명: 개인 맞춤형 콘텐츠 큐레이터

Agent는 학습 목표를 받아 도구를 선택하고 플레이리스트 초안을 만듭니다.

상태:

- goal
- language
- interests
- retrieved posts
- external video metadata
- trace

도구:

- `retrieve_posts`: RAG로 게시판 글 검색
- `search_video`: MCP로 외부 영상 메타데이터 조회
- `create_playlist_draft`: 추천 결과를 플레이리스트 초안으로 정리

루프 방지:

- `maxIterations` 기본 3, 최대 4
- 도구 실패 시 trace에 error를 남기고 다음 단계로 진행
- 최종 응답에 `guardrails.loopStopped` 반환

Function Calling:

- `ai/main.py`의 `AGENT_TOOLS`에 OpenAI function-calling 호환 tool schema를 정의했습니다.
- `OPENAI_API_KEY`가 있으면 LLM tool choice를 시도합니다.
- 키가 없으면 같은 도구 목록을 deterministic loop로 실행합니다.

## 5. 실행 방법

### 1. 의존성 설치

```powershell
npm.cmd --prefix web install
npm.cmd --prefix api install
python -m venv ai\.venv
ai\.venv\Scripts\python.exe -m pip install -r ai\requirements.txt
```

### 2. 환경 변수

```powershell
Copy-Item .env.example .env
Copy-Item api\.env.example api\.env
Copy-Item ai\.env.example ai\.env
Copy-Item web\.env.example web\.env
```

### 3. PostgreSQL 실행

```powershell
npm.cmd run db:up
```

DB가 꺼져 있어도 NestJS API는 로컬 메모리 저장소로 실행할 수 있습니다. 다만 제출 시에는 Docker PostgreSQL을 켜고 실행하는 것을 권장합니다.

### 4. 개발 서버 실행

터미널 3개에서 실행합니다.

```powershell
npm.cmd run dev:ai
npm.cmd run dev:api
npm.cmd run dev:web
```

접속 URL:

- Web: http://localhost:5173
- API Health: http://localhost:3000/health
- AI Health: http://localhost:8000/health

## 6. 데모

서비스형 첫 화면:

![StudyTube Board demo](docs/demo/studytube-board.png)

필수 게시판 기능 화면:

![StudyTube Board required features](docs/demo/studytube-board-board.png)

Agent + MCP 실제 YouTube 추천 결과:

![StudyTube recommendations](docs/demo/studytube-recommendations.png)

영상 보기와 우측 재생목록:

![StudyTube watch queue](docs/demo/studytube-watch-queue.png)

데모에서 확인할 것:

- 로그인하지 않으면 `/board`, `/search`, `/playlists`, `/watch` 접근 시 로그인 페이지로 이동
- 좌측 게시글 검색과 페이징
- 중앙 영상 요약, 번역 노트, 댓글
- 하단 게시글 작성/수정/삭제
- 게시글 작성 시 YouTube URL 기반 자동 메타데이터 입력
- 하단 플레이리스트 생성과 피드백
- 채팅형 게시판 지식 검색
- RAG는 저장된 게시글만 근거로 답하고, 관련 글이 없으면 빈 결과 표시
- RAG 결과를 누르면 현재 결과 목록 전체가 재생목록으로 추가되고 영상 보기로 이동
- Agent 추천과 MCP 실제 YouTube 검색 결과가 하나의 추천 리스트로 합쳐짐
- 추천 결과를 누르면 선택한 영상부터 재생하고, 우측 재생목록에서 순서 재생/직접 선택 가능
- 영상 재생 중 요약/번역 노트 기반 실시간 자막 오버레이 표시
- 자막 켜기/끄기 및 재생목록 항목 삭제

페이지별 검증 캡처는 `docs/demo/pages/`에 저장했습니다.

## 7. 검증

현재 확인한 명령:

```powershell
npm.cmd --prefix web run build
npm.cmd --prefix web run lint
npm.cmd --prefix api run test
npm.cmd --prefix api run build
npm.cmd --prefix api run lint
python -m unittest test_main.py
python -m compileall ai\main.py ai\test_main.py
```

추가 확인:

- `POST http://localhost:3000/ai/mcp/youtube`에 `react hooks`를 보내 실제 YouTube 검색 결과 `videos` 배열이 반환되는지 확인했습니다.
- Chrome headless로 추천 결과 클릭 후 `/watch` 이동, 우측 재생목록 8개 표시를 확인했습니다.

참고: 기존 `ai\.venv`의 Python 실행 파일이 깨져 있어 시스템 Python으로 AI unit test를 실행했습니다. 가상환경은 README의 설치 명령으로 재생성하면 됩니다.

## 8. 회고, 한계점, 개선 아이디어

### 회고

이번 프로젝트는 단순 게시판에 AI 기능을 덧붙이는 방식이 아니라, 게시글 자체를 RAG 검색 지식으로 보고 MCP와 Agent가 그 지식을 활용하도록 설계했습니다. 프론트엔드, NestJS API, FastAPI AI 서비스를 분리하면서 실제 서비스형 아키텍처를 경험할 수 있습니다.

### 한계점

- 인증은 과제 데모용 bearer session 방식이며 운영용 JWT/refresh token 구조는 아닙니다.
- LLM API 키가 없을 때 deterministic tool loop로 동작하므로 실제 생성형 추론 품질과는 차이가 있습니다.
- API 키 없이 사용하는 YouTube 검색 페이지 파서는 YouTube HTML 구조 변경에 영향을 받을 수 있어, 배포 시에는 `YOUTUBE_API_KEY` 사용을 권장합니다.
- pgvector 테이블은 준비되어 있지만 대량 데이터 색인, chunking, background embedding job은 간소화했습니다.

### 개선 아이디어

- 게시글 저장 시 FastAPI background task로 embedding을 갱신합니다.
- YouTube transcript API를 연동해 실제 자막 번역을 자동 생성합니다.
- LangGraph로 Agent 상태 그래프를 명시적으로 모델링합니다.
- 관리자 화면에서 Agent 추천 이벤트나 캠페인을 승인하도록 만듭니다.
- refresh token, RBAC, rate limiting을 추가해 배포 수준 보안을 강화합니다.
