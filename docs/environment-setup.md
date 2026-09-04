# 개발 환경 설정

StudyTube는 React Web, NestJS API, FastAPI AI, PostgreSQL, Valkey와 Background Worker를 함께 실행합니다.

## 필요한 도구

- Node.js 24.8 이상
- Python 3.12
- Docker와 Docker Compose v2
- Linux 또는 WSL 권장

CI도 Node.js 24와 Python 3.12를 사용합니다.

## 설치

```bash
cp .env.example .env
cp api/.env.example api/.env
npm --prefix api ci
npm --prefix web ci
python3 -m venv ai/.venv
ai/.venv/bin/python -m pip install --require-hashes -r ai/requirements.txt
```

마이그레이션과 Worker는 `api/.env`를 읽으므로 두 환경 파일을 모두 준비합니다. 실제 비밀번호와 외부 API key는 로컬 환경 파일에만 넣고 저장소에는 올리지 않습니다. 외부 AI와 YouTube API가 필요한 기능은 해당 key가 없으면 실행되지 않습니다.

## PostgreSQL과 Valkey

```bash
npm run db:up
npm run db:migrate:up
docker compose ps
```

`postgres`와 `valkey`가 준비된 뒤 애플리케이션을 시작합니다.

## 서비스 실행

```bash
npm run all
```

이 명령은 PostgreSQL을 확인한 뒤 Web, API와 AI를 함께 실행합니다.

| 서비스 | 주소 |
| --- | --- |
| Web | `http://127.0.0.1:5173` |
| API | `http://127.0.0.1:3000` |
| AI | `http://127.0.0.1:8000` |

자막, 임베딩과 퀴즈 같은 백그라운드 작업까지 확인하려면 별도 터미널에서 Worker를 실행합니다.

```bash
npm --prefix api run build
npm --prefix api run start:worker
```

## 로컬 로그인

개발 환경에서 `AUTH_MODE`를 설정하지 않으면 기존 이메일 인증 흐름을 사용합니다. Google 로그인을 시험할 때는 `AUTH_MODE=google_only`와 Google OAuth client 정보를 `api/.env`에 넣습니다.

운영 redirect URI와 로컬 redirect URI는 서로 다르므로 같은 값을 그대로 복사하지 않습니다. 로컬 기본 callback은 `http://localhost:3000/auth/google/callback`입니다.

## Windows에서 확인할 때

Web과 API는 PowerShell에서도 실행됩니다. `npm.ps1`이 실행 정책에 막히면 `npm.cmd`를 사용합니다.

AI의 고정 의존성에는 Linux용 `uvloop`가 포함돼 있으므로 전체 AI 설치와 테스트는 WSL 또는 Linux에서 실행합니다.

## 종료

애플리케이션을 종료한 뒤 PostgreSQL과 Valkey도 내리려면 다음 명령을 실행합니다.

```bash
npm run db:down
```
