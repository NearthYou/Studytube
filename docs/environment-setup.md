# 개발 환경 설정

StudyTube는 React Web, NestJS API, FastAPI AI 서비스, PostgreSQL과 Valkey worker로 구성한 모노레포입니다.

Web, API, PostgreSQL, Valkey와 worker는 Windows PowerShell에서 실행합니다. AI 의존성 설치, AI 서비스와 AI 테스트는 Linux 또는 WSL에서 실행합니다.

[AI lockfile](../ai/requirements.txt)은 `uvloop`를 사용하는 Linux 환경을 기준으로 하므로 AI 환경은 Linux 또는 WSL에서 준비합니다.

## 요구 버전

- Node.js 24.8 이상을 사용합니다.
- npm lockfile을 지원하는 npm을 사용합니다.
- Python 3.12를 사용합니다.
- Docker와 Docker Compose v2를 사용합니다.
- Windows에서는 PowerShell 7을 권장합니다.

CI도 Node.js 24와 Python 3.12를 사용합니다. 로컬 버전이 다르면 의존성과 타입 검사 결과가 달라질 수 있습니다.

## PowerShell에서 Web, API와 데이터 저장소 준비

루트 환경 파일을 만들고 Web과 API 의존성을 설치합니다. 실제 secret은 commit하지 않습니다.

```powershell
Copy-Item .env.example .env

npm --prefix web ci
npm --prefix api ci

npm run db:up
npm run db:migrate:up
```

`docker compose ps`에서 PostgreSQL과 Valkey가 ready인지 확인합니다. migration은 공유 database가 아닌 로컬 development database에서 실행합니다.

Web과 API는 각각 별도 PowerShell 터미널에서 실행합니다.

```powershell
npm run dev:web
npm run dev:api
```

worker는 API를 빌드한 뒤 별도 PowerShell 터미널에서 실행합니다.

```powershell
npm --prefix api run build
npm --prefix api run start:worker
```

## Linux 또는 WSL에서 AI 준비와 실행

저장소 루트의 Linux 또는 WSL 터미널에서 AI 가상환경과 lockfile 의존성을 준비하고 서비스를 실행합니다.

```bash
python3 -m venv ai/.venv
ai/.venv/bin/python -m pip install --require-hashes -r ai/requirements.txt
ai/.venv/bin/python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000 --app-dir ai
```

Windows와 WSL을 함께 사용할 때는 위처럼 PowerShell과 Linux 터미널을 나눠 실행합니다.

| 서비스 | 주소 |
| --- | --- |
| Web | `http://localhost:5173` |
| API | `http://localhost:3000` |
| AI | `http://localhost:8000` |

## 확인 순서

1. API와 AI health endpoint를 확인합니다.
2. `npm run db:migrate:status`로 migration 상태를 확인합니다.
3. Web에서 login 또는 signup page가 표시되는지 확인합니다.
4. test account와 격리 database가 있을 때만 authenticated learning flow를 실행합니다.

Web과 API 검사는 PowerShell에서 실행합니다.

```powershell
npm --prefix web run lint
npm --prefix web run build

npm --prefix api run lint
npm --prefix api test -- --runInBand
npm --prefix api run build
```

AI 테스트는 Linux 또는 WSL에서 실행합니다.

```bash
(
  cd ai
  .venv/bin/python -m unittest discover -s .
)
```

## 환경별 참고

PowerShell execution policy가 `npm.ps1`을 막으면 `npm.cmd`를 직접 실행합니다.

PostgreSQL port를 바꿨다면 `.env`의 `DATABASE_URL`도 같은 host port로 바꿉니다. 원격 Docker context와 production database를 local drill 대상으로 사용하지 않습니다.

외부 모델을 사용하는 기능에는 `OPENAI_API_KEY`가 필요합니다. STT production path는 별도 비용 승인과 deployment gate를 거쳐 활성화합니다.
