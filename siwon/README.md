# StudyTube Courses

YouTube 학습 영상을 코스 단위로 저장하고 공유하는 학습 보드 서비스입니다. 사용자는 YouTube URL을 등록해 영상 카드와 플레이리스트를 만들고, AI가 자막 수집, 번역, 요약, 태그, 학습 코스 생성을 보조합니다.

## 주요 기능

- YouTube URL 기반 영상 등록
- 영상 메타데이터, 자막, 요약, 태그 관리
- 플레이리스트 기반 학습 코스 생성과 공개 보드
- Watch 화면의 YouTube 플레이어, 자막, 메모, 반복 구간, 재생목록
- AI 탐색과 자동완성 기반 영상/코스 검색
- RAG로 기존 영상 분석 결과를 먼저 검색한 뒤 답변 생성
- MCP-style YouTube 메타데이터 조회
- Agent 기반 맞춤형 학습 코스 생성
- PostgreSQL + pgvector 기반 저장소와 fallback repository
- EC2 배포 스크립트와 GitHub Actions 연동 문서

## 기술 스택

- Frontend: React, Vite, TypeScript
- Backend: NestJS, Prisma, PostgreSQL
- AI Server: FastAPI, Python, OpenAI API
- Database: PostgreSQL + pgvector
- Infra: Docker Compose, EC2 deploy scripts

## 폴더 구조

```text
siwon/
  web/                 React + Vite frontend
  api/                 NestJS API server
  ai/                  FastAPI AI server
  docs/                설계, 발표, 트러블슈팅 문서
  scripts/             로컬/EC2 실행 및 배포 스크립트
  docker-compose.yml   PostgreSQL + pgvector
  .env.example         공통 환경변수 예시
```

## 사전 준비

- Node.js와 npm
- Python 3.13 권장
- Docker Desktop
- OpenAI API Key
- YouTube API Key 또는 자막 수집용 쿠키/PO token 설정

## 환경 변수

루트 예시 파일을 복사합니다.

```powershell
cd siwon
Copy-Item .env.example .env
Copy-Item web\.env.example web\.env
Copy-Item api\.env.example api\.env
Copy-Item ai\.env.example ai\.env
```

주요 값:

```text
WEB_ORIGIN=http://localhost:5173
VITE_API_BASE_URL=http://localhost:3000
DATABASE_URL=postgresql://app:app@localhost:5432/app_dev
AI_SERVICE_URL=http://localhost:8000
INTERNAL_AI_API_KEY=change-me
OPENAI_API_KEY=
YOUTUBE_API_KEY=
YOUTUBE_PO_TOKEN=
YOUTUBE_VISITOR_DATA=
YOUTUBE_COOKIES_FILE=
```

민감 정보는 Git에 올리지 않습니다. EC2에서는 서버 안의 `.env`에 실제 값을 유지합니다.

## 처음 실행

의존성을 설치합니다.

```powershell
cd siwon
npm install
npm --prefix web install
npm --prefix api install

py -3.13 -m venv ai\.venv
ai\.venv\Scripts\python.exe -m pip install --upgrade pip
ai\.venv\Scripts\python.exe -m pip install -r ai\requirements.txt
```

DB를 실행합니다.

```powershell
npm run db:up
```

Prisma 클라이언트와 DB 스키마를 준비합니다.

```powershell
npm --prefix api run prisma:generate
npm --prefix api run prisma:migrate
```

전체 서비스를 실행합니다.

```powershell
npm run all
```

`npm run all`은 프론트엔드, NestJS API, FastAPI AI 서버를 함께 실행합니다.

## 개별 실행

각 서버를 따로 띄우려면 PowerShell 창을 나누어 실행합니다.

```powershell
npm run dev:web
npm run dev:api
npm run dev:ai
```

현재 루트 스크립트 기준 포트:

```text
Web: http://localhost:5173
API: http://localhost:3000
AI:  http://localhost:8000
```

EC2 외부 접속을 위해 `dev:web`과 `dev:ai`는 `0.0.0.0` 바인딩을 사용합니다.

## 헬스 체크

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:3000/health
Invoke-WebRequest -UseBasicParsing http://localhost:3000/health/db
Invoke-WebRequest -UseBasicParsing http://localhost:3000/health/ai
Invoke-WebRequest -UseBasicParsing http://localhost:8000/health
Invoke-WebRequest -UseBasicParsing http://localhost:8000/health/db
```

## 빌드와 검사

```powershell
npm run build:web
npm run build:api
npm run lint:web
npm run lint:api
```

AI 서버 테스트는 Python venv에서 실행합니다.

```powershell
cd ai
.\.venv\Scripts\python.exe -m unittest test_main
```

## EC2 배포

EC2 배포와 GitHub Actions 연동은 별도 문서에 정리되어 있습니다.

- [`docs/ci-cd.md`](docs/ci-cd.md)
- [`scripts/deploy-ec2.sh`](scripts/deploy-ec2.sh)
- [`scripts/ec2-autodeploy.sh`](scripts/ec2-autodeploy.sh)

운영 서버에서는 `.env`, `secrets`, `.tools` 같은 민감 런타임 파일을 Git에 올리지 않고 EC2 내부에 유지합니다.

## 자주 막히는 지점

- YouTube 자막이 비어 있으면 `YOUTUBE_COOKIES_FILE`, `YOUTUBE_PO_TOKEN`, `YOUTUBE_VISITOR_DATA` 설정을 확인합니다.
- DB 연결이 실패하면 Docker 컨테이너와 `DATABASE_URL` 포트가 맞는지 확인합니다.
- API에서 AI 호출이 실패하면 `AI_SERVICE_URL`과 `INTERNAL_AI_API_KEY`가 API와 AI 서버에서 같은지 확인합니다.
- PowerShell에서 `npm` 실행이 막히면 `npm.cmd`로 실행합니다.

## 참고 문서

- 환경 설정: [`docs/environment-setup.md`](docs/environment-setup.md)
- CI/CD: [`docs/ci-cd.md`](docs/ci-cd.md)
- 발표 Q&A: [`docs/presentation/studytube-presentation-qna-architecture.md`](docs/presentation/studytube-presentation-qna-architecture.md)
