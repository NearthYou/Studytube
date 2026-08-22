# 개발 환경 설정

StudyTube는 React Web, NestJS API, FastAPI AI service, PostgreSQL과 Valkey worker를 함께 실행하는 monorepo다.

## 요구 버전

- Node.js 24.8 이상
- npm lockfile을 지원하는 npm
- Python 3.12
- Docker와 Docker Compose v2
- Windows에서는 PowerShell 7 권장

CI는 Node.js 24와 Python 3.12를 사용한다. 로컬 version이 다르면 dependency와 type 결과가 달라질 수 있다.

## 설치

root 환경 파일을 만든다. 실제 secret은 commit하지 않는다.

```powershell
Copy-Item .env.example .env
npm --prefix api ci
npm --prefix web ci
python -m venv ai/.venv
ai/.venv/Scripts/python.exe -m pip install --require-hashes -r ai/requirements.txt
```

## PostgreSQL과 Valkey

```powershell
npm run db:up
npm run db:migrate:up
```

`docker compose ps`에서 PostgreSQL과 Valkey가 ready인지 확인한다. migration은 공유 database가 아닌 로컬 development database에서 실행한다.

## 서비스 시작 순서

```powershell
npm run dev:ai
npm run dev:api
npm run dev:web
```

세 command는 별도 terminal에서 실행한다. root의 `npm run all`은 local helper로 같은 service를 함께 시작한다.

| service | address |
| --- | --- |
| Web | `http://127.0.0.1:5173` |
| API | `http://127.0.0.1:3000` |
| AI | `http://127.0.0.1:8000` |

Background worker는 API build 뒤 별도 process로 실행한다.

```powershell
npm --prefix api run build
npm --prefix api run start:worker
```

## 확인 순서

1. API와 AI health endpoint를 확인한다.
2. migration status를 확인한다.
3. Web에서 login 또는 signup page가 render되는지 확인한다.
4. test account와 격리 database가 있을 때만 authenticated learning flow를 실행한다.

## 자주 막히는 부분

PowerShell execution policy가 `npm.ps1`을 막으면 `npm.cmd`를 직접 실행한다. 가상환경 activation이 막히면 `ai/.venv/Scripts/python.exe`를 직접 사용한다.

PostgreSQL port를 바꿨다면 `.env`의 `DATABASE_URL`도 같은 host port로 바꾼다. 원격 Docker context와 production database를 local drill 대상으로 사용하지 않는다.

`OPENAI_API_KEY`가 없으면 외부 model이 필요한 기능은 실행되지 않는다. STT production path는 key만으로 활성화되지 않으며 별도 비용 승인과 deployment gate가 필요하다.
