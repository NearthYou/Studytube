# Tail Talk Demo Runbook

## Goal

클린 환경에서 Tail Talk 게시판, 반려동물 동반 장소, AI Assistant 베타를 같은 순서로 실행하고 시연한다.

## Required Runtime

- Node.js 20 이상
- Python 3.11 이상
- PostgreSQL 15 이상
- backend: `3000`
- frontend: `5173`
- AI worker: `8000`

로컬에서 `backend/.env`의 `PORT`를 바꾸면 `frontend/.env`의 `VITE_API_BASE_URL`도 같은 포트로 맞춘다. 예: `PORT=3001`이면 `VITE_API_BASE_URL=http://localhost:3001`.

## Environment Files

루트 `.env.example`을 기준으로 서비스별 env를 만든다.

```bash
cp .env.example backend/.env
cp .env.example frontend/.env
cp .env.example AI/.env
```

필수 값:

- `backend/.env`: `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_ORIGINS`
- `frontend/.env`: `VITE_API_BASE_URL`
- `AI/.env`: `OPENAI_API_KEY`는 선택값이다. 없으면 RAG/Assistant는 안전 fallback을 사용한다.
- 장소 검색 시연이 필요하면 `TOUR_API_SERVICE_KEY`가 필요하다.

업로드 저장소는 개발 기본값으로 로컬 `uploads`를 사용한다. 실제 운영 배포에서는 `UPLOAD_LOCAL_ROOT`를 EFS 같은 영속 공유 마운트로 지정하고 `UPLOAD_LOCAL_ROOT_IS_PERSISTENT=true`를 명시한다. 단일 인스턴스 데모 배포로 인정한 경우에만 `ALLOW_LOCAL_UPLOADS_IN_PRODUCTION=true`를 사용한다.
backend는 시작 시 `backend/.env`를 먼저 로드한 뒤 runtime config를 검증한다. 다른 경로의 env 파일을 쓰는 경우 `DOTENV_CONFIG_PATH`로 지정한다.

## Clean Setup

```bash
cd backend
npm install
npm run migration:run
```

```bash
cd frontend
npm install
```

```bash
cd AI
python -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

## Run Services

터미널 1:

```bash
cd backend
npm run start:dev
```

터미널 2:

```bash
cd AI
.venv/bin/python -m uvicorn app.main:app --reload --port 8000
```

터미널 3:

```bash
cd frontend
npm run dev
```

접속 URL:

- Frontend: `http://localhost:5173`
- Backend health: `http://localhost:3000/api/health`
- AI health: `http://localhost:8000/health`

`backend/.env`에서 `PORT`를 바꾼 경우 health URL도 해당 포트를 사용한다.

## Verification Gates

```bash
cd frontend
npm run build
npm run lint
npm test
npm run test:browser
```

`npm run test:browser`는 Vite dev server를 임시 포트 `4174`에 띄우고, 브라우저 API 요청을 mock해서 mobile/tablet/desktop 회귀를 확인한다. 범위는 홈, 장소 목록/상세, Assistant 인증/만료/카드 UI, 댓글 더보기, 소유권 guard, 글 작성/수정/삭제 happy path다. 이 명령은 Kakao/TourAPI/OpenAI/live backend 통합 검증이 아니며, Playwright 브라우저가 없는 새 환경에서는 한 번만 `cd frontend && npx playwright install chromium`을 실행한다.

```bash
cd backend
npm run build
npm run lint:check
npm test
npm run test:e2e
```

`npm run test:e2e`는 로컬 PostgreSQL의 임시 스키마를 생성/삭제하며 실행된다. `backend/.env`의 `DATABASE_URL`은 `localhost`, `127.0.0.1`, 또는 `::1` 호스트를 사용해야 한다.

```bash
cd AI
.venv/bin/python -m pytest
```

AI 빠른 개발 루프에서는 PDF ingestion 테스트를 제외하고 다음 명령을 사용할 수 있다.

```bash
cd AI
.venv/bin/python -m pytest -m "not slow"
```

제출 정책은 [submission-policy.md](submission-policy.md)를 기준으로 한다. 제출 manifest dry-run:

```bash
node scripts/check-submission-manifest.mjs
```

live-smoke `upload` target 자체의 로컬 mock 회귀는 다음 명령으로 확인한다.

```bash
node scripts/test-live-smoke-upload.mjs
```

auth/agent/crud/upload live smoke에 사용할 smoke 계정은 backend DB migration 후 준비한다. `SMOKE_ACCOUNT_EMAIL`/`SMOKE_ACCOUNT_PASSWORD`가 없으면 `LIVE_SMOKE_EMAIL`/`LIVE_SMOKE_PASSWORD`를 사용한다.

```bash
cd backend
npm run smoke:user
```

production에서 smoke 계정을 생성/갱신하려면 명시적으로 `SMOKE_ACCOUNT_ENABLED=true`를 설정한다. 이 명령은 비밀번호나 token을 로그에 출력하지 않는다.
production smoke 계정은 개인 계정이 아니라 전용 계정으로 만들고, 비밀번호는 secret manager나 배포 시스템 secret으로 주입한다. release gate 직전 `SMOKE_ACCOUNT_RESET_PASSWORD=true`로 회전한 뒤, smoke가 끝나면 다음 명령으로 계정을 삭제한다. 삭제 명령은 게시글, 댓글, 업로드 이미지, 좋아요, 소셜 계정, RAG 로그 등 남은 사용자 데이터가 있으면 계정을 삭제하지 않고 실패하므로, cleanup 누락을 먼저 해결한다.

```bash
cd backend
npm run smoke:user:delete
```

## Live Smoke

`npm run test:browser`는 mock API 기반 회귀 검증이다. 발표 직전 실제 Kakao Maps, TourAPI, OpenAI, live backend/AI worker 연결 상태는 root live smoke로 따로 판정한다.

기본 실행은 외부 호출을 하지 않고 모든 target을 `SKIP` 처리한다.

```bash
node scripts/live-smoke.mjs
```

실제 검증은 frontend, backend, AI worker를 먼저 띄우고, 실제 credential과 smoke 계정을 준비한 뒤 명시적으로 opt-in한다.

```bash
RUN_LIVE_SMOKE=true node scripts/live-smoke.mjs
```

발표/배포 직전 release gate에서는 선택한 target 중 하나라도 `SKIP`이면 실패해야 하므로 다음 옵션을 함께 사용한다.

```bash
RUN_LIVE_SMOKE=true LIVE_SMOKE_FAIL_ON_SKIP=true node scripts/live-smoke.mjs
```

필요 env:

- URL: `LIVE_SMOKE_FRONTEND_URL`, `LIVE_SMOKE_BACKEND_URL`, `LIVE_SMOKE_AI_URL`
- 업로드 읽기: `LIVE_SMOKE_UPLOAD_READ_URL`, 선택값 `LIVE_SMOKE_SECONDARY_BACKEND_URL`
- 엄격 판정: `LIVE_SMOKE_FAIL_ON_SKIP=true`
- smoke 계정: `LIVE_SMOKE_EMAIL`, `LIVE_SMOKE_PASSWORD` 또는 `LIVE_SMOKE_ACCESS_TOKEN`
- smoke 계정 준비/삭제: `SMOKE_ACCOUNT_EMAIL`, `SMOKE_ACCOUNT_PASSWORD`, `SMOKE_ACCOUNT_NICKNAME`, `SMOKE_ACCOUNT_ENABLED`, `SMOKE_ACCOUNT_RESET_PASSWORD`
- 외부 연동: `TOUR_API_SERVICE_KEY`, `VITE_KAKAO_MAP_JS_KEY`, `OPENAI_API_KEY`

기본 target은 `frontend,backend,auth,agent,crud,upload,tourapi,kakao-map,ai,openai`이다. 일부만 검증할 때는 예를 들어 다음처럼 실행한다.

```bash
RUN_LIVE_SMOKE=true LIVE_SMOKE_TARGETS=frontend,backend,ai node scripts/live-smoke.mjs
```

판정 기준:

- `PASS`: 해당 target이 실제 서비스/credential로 검증됨
- `SKIP`: 선택한 target이 opt-in, credential, secondary backend, provider 신호 등 부족으로 검증되지 않음. `SKIP`은 `PASS`가 아니다.
- `OMIT`: `LIVE_SMOKE_TARGETS`에서 의도적으로 제외한 target. 검증 범위 밖이므로 release 제외 사유를 PM audit에 남긴다.
- `FAIL`: credential 누락, provider 오류, timeout, 계약 불일치, cleanup 실패

기본 개발 모드에서는 부분 점검 편의를 위해 `SKIP`이 있어도 exit code가 0일 수 있다. release gate에서는 반드시 `LIVE_SMOKE_FAIL_ON_SKIP=true`를 사용한다. `OMIT`은 엄격 판정 실패 대상이 아니지만, 발표 범위에서 제외했다는 뜻이지 검증 성공이 아니다.

`auth`, `agent`, `crud` target은 smoke 계정 또는 token이 필요하다. `crud`는 임시 게시글을 만들고 조회/수정/삭제한 뒤 삭제 확인까지 수행하며 cleanup 실패는 `FAIL`이다. `openai` target은 AI worker `/pet-behavior/question` 응답의 `answerProvider=openai`, `fallbackUsed=false` 신호를 확인한다.

`upload` target은 smoke 계정 또는 token이 필요하다. 테스트 PNG를 `/api/posts/images`로 업로드하고, 생성된 원본/variant WebP URL을 읽은 뒤, 임시 게시글에 연결해 상세 metadata를 확인하고, 게시글 삭제 후 기존 이미지 URL이 더 이상 `200`으로 읽히지 않는지 확인한다. `LIVE_SMOKE_SECONDARY_BACKEND_URL`이 없으면 `upload-secondary`가 `SKIP`으로 기록되며, shared storage/multi-instance 검증은 완료로 보지 않는다. secondary URL을 지정할 때는 primary와 다른 backend origin을 사용한다.

로그에는 access token, password, OAuth code/state, API key, full provider query string을 출력하지 않는다.

## Demo Flow

1. 홈에서 게시글 목록, 카테고리, 검색을 보여준다.
2. 회원가입 또는 기존 계정 로그인 후 글쓰기 화면으로 이동한다.
3. 이미지가 포함된 게시글을 작성하고 상세 화면에서 댓글/좋아요를 보여준다.
4. 작성자 계정에서는 수정/삭제 링크가 보이고, 다른 계정 또는 비로그인 직접 진입에서는 권한 안내가 나온다는 점을 설명한다.
5. `반려동물 동반 장소` 메뉴에서 지역 또는 키워드 검색을 보여준다.
6. Assistant를 열고 로그인 필요 상태와 로그인 후 질문 흐름을 보여준다.
7. 행동 질문에는 RAG 기반 안전 안내, 장소 질문에는 장소 카드, 게시글 질문에는 게시글 카드를 보여준다.

## Fallback Plan

- Backend가 뜨지 않으면 `DATABASE_URL`과 마이그레이션 적용 여부를 먼저 확인한다.
- 장소 검색이 실패하면 `TOUR_API_SERVICE_KEY` 누락 여부를 확인하고, 게시판/Assistant RAG 시연으로 전환한다.
- AI worker가 뜨지 않으면 `/api/agent/chat`은 안전 fallback을 반환할 수 있음을 설명하고, `AI/.env`와 `8000` 포트를 확인한다.
- OpenAI API 키가 없으면 RAG 생성 답변 대신 로컬 안전 템플릿 응답으로 시연한다.

## Final Submission Checklist

- 제출 단위는 프로젝트 루트 아카이브로 본다. `backend/.git`은 제출 manifest에 포함하지 않는다.
- README Quickstart와 이 runbook 명령이 모두 최신인지 확인한다.
- `.env` 파일과 `node_modules`, `dist`, `.venv`, `uploads`는 제출물에 포함하지 않는다.
- `node scripts/check-submission-manifest.mjs`가 통과해야 한다.
- 최종 발표 전 verification gates를 한 번에 통과시킨다.
