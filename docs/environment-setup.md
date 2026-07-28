# 개발 환경 세팅 기록

이 저장소는 아직 어떤 서비스를 만들지 정하지 않은 상태에서, 클론 코딩으로 학습하기 위한 개발 환경만 준비한 것이다. 목표는 React, NestJS, FastAPI, PostgreSQL + pgvector를 각각 실행해 보고 서로 연결되는 구조를 이해하는 데 있다.

## 폴더 구조

```txt
studytube/
  web/                 React + Vite + TypeScript
  api/                 NestJS
  ai/                  FastAPI
  docs/                환경 설명 문서
  docs/study/          3일 학습 자료
  docker-compose.yml   PostgreSQL + pgvector
  .env.example         공통 환경변수 예시
```

## 왜 이렇게 나눴는가

- `web`: 화면을 담당한다. React와 TypeScript 문법, 라우팅, API 호출 연습에 집중한다.
- `api`: 메인 백엔드 역할을 연습한다. NestJS의 Controller, Service, Module 구조를 익힌다.
- `ai`: Python 기반 AI 서버 역할을 연습한다. FastAPI, Pydantic, 외부 API 호출, 추후 OpenAI API 사용법을 익힌다.
- `postgres`: 데이터베이스를 Docker로만 띄운다. 로컬 설치 문제를 줄이고, pgvector까지 같은 환경에서 연습한다.
- `docs/study`: 3일 안에 따라칠 수 있는 학습 순서만 남긴다.

## 현재 로컬 도구

현재 확인된 환경은 다음과 같다.

```txt
Node.js 24.14.1
npm 11.15.0
Docker 29.4.3
Python 3.14 / 3.13 / 3.10 설치됨
```

Python 패키지 호환성을 위해 FastAPI 가상환경은 `py -3.13`으로 만드는 것을 기본값으로 잡았다. 문제가 생기면 `py -3.10`으로 바꿔도 된다.

## 처음 실행 순서

Windows PowerShell 기준이다.

```powershell
npm.cmd --prefix web install
npm.cmd --prefix api install

py -3.13 -m venv ai\.venv
ai\.venv\Scripts\python.exe -m pip install --upgrade pip
ai\.venv\Scripts\python.exe -m pip install -r ai\requirements.txt
```

환경변수 예시는 필요할 때 복사한다.

```powershell
Copy-Item web\.env.example web\.env
Copy-Item api\.env.example api\.env
Copy-Item ai\.env.example ai\.env
```

DB 실행:

```powershell
npm.cmd run db:up
```

서버 실행:

```powershell
npm.cmd run dev:ai
npm.cmd run dev:api
npm.cmd run dev:web
```

각 명령은 별도 터미널에서 실행한다.

## 확인 주소

```txt
React:   http://localhost:5173
NestJS:  http://localhost:3000/health
AI:      http://localhost:8000/health
DB API:  http://localhost:3000/health/db
AI Proxy:http://localhost:3000/health/ai
AI DB:   http://localhost:8000/health/db
```

## 지금 구현된 범위

지금은 서비스 기능을 만들지 않았다.

- React 앱 실행 가능
- NestJS `/health`, `/health/ai`, `/health/db`
- FastAPI `/health`, `/health/db`
- PostgreSQL + pgvector Docker 환경
- Prisma 학습용 기본 스키마

게시판, 로그인, 댓글, 검색, RAG, MCP, Agent는 아직 구현하지 않는다. 서비스 주제가 정해진 뒤 필요한 만큼 붙인다.

## 자주 막히는 부분

PowerShell에서 `npm`이 막히면 `npm.cmd`를 쓴다.

```powershell
npm.cmd run dev:web
```

Python 가상환경 활성화가 막히면 활성화하지 말고 Python 실행 파일을 직접 쓴다.

```powershell
ai\.venv\Scripts\python.exe -m uvicorn main:app --reload --app-dir ai --port 8000
```

PostgreSQL 포트가 이미 사용 중이면 `docker-compose.yml`의 왼쪽 포트를 바꾼다.

```yaml
ports:
  - "5433:5432"
```

이 경우 `.env`의 `DATABASE_URL`도 `localhost:5433`으로 바꿔야 한다.
