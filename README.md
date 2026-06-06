# agentic-board

클론 코딩 학습을 위한 React + NestJS + FastAPI + PostgreSQL 개발 환경입니다.

아직 서비스 기획은 정하지 않았고, 현재는 실행 가능한 개발/공부 환경만 세팅되어 있습니다.

## 구조

```txt
web/        React + Vite + TypeScript
api/        NestJS
ai/         FastAPI
docs/       환경 설명과 학습 자료
```

## 빠른 실행

```powershell
npm.cmd --prefix web install
npm.cmd --prefix api install
py -3.13 -m venv ai\.venv
ai\.venv\Scripts\python.exe -m pip install -r ai\requirements.txt

npm.cmd run db:up
npm.cmd run dev:ai
npm.cmd run dev:api
npm.cmd run dev:web
```

자세한 설명은 [docs/environment-setup.md](docs/environment-setup.md)를 확인합니다.
