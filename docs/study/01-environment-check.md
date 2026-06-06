# 01. 환경 확인과 실행 순서

목표는 코드를 많이 쓰기 전에, 개발 도구가 제대로 동작하는지 확인하는 것이다.

## 알아야 할 개념

- `Node.js`: React와 NestJS 실행에 필요하다.
- `npm`: JavaScript 패키지를 설치하고 스크립트를 실행한다.
- `Python venv`: FastAPI용 패키지를 프로젝트별로 분리한다.
- `Docker Compose`: PostgreSQL을 명령 하나로 실행한다.
- `.env`: 비밀번호, API key, 서버 주소를 코드 밖에서 관리한다.

## 확인 명령

```powershell
node --version
npm.cmd --version
py -0p
docker --version
docker compose version
```

정확한 버전을 외울 필요는 없다. 명령이 실행되고, Node 20 이상, Python 3.10 이상, Docker가 있으면 충분하다.

## 의존성 설치

```powershell
npm.cmd --prefix web install
npm.cmd --prefix api install

py -3.13 -m venv ai\.venv
ai\.venv\Scripts\python.exe -m pip install --upgrade pip
ai\.venv\Scripts\python.exe -m pip install -r ai\requirements.txt
```

## DB 실행

```powershell
npm.cmd run db:up
```

컨테이너 확인:

```powershell
docker ps
```

`agentic-board-postgres`가 보이면 된다.

## 서버 실행 순서

터미널을 3개 열고 각각 실행한다.

```powershell
npm.cmd run dev:ai
```

```powershell
npm.cmd run dev:api
```

```powershell
npm.cmd run dev:web
```

## 체크리스트

- `http://localhost:8000/health`에서 `service: ai`
- `http://localhost:3000/health`에서 `service: api`
- `http://localhost:3000/health/ai`에서 AI 서버 응답 포함
- `http://localhost:3000/health/db`에서 DB 상태 확인
- `http://localhost:5173`에서 React 화면 표시

## 오늘 할 일

이 파일의 목표는 환경 확인이다. 기능 개발은 하지 않는다. 실행이 안 되면 문법 공부보다 환경 오류부터 해결한다.
