# StudyTube Courses

YouTube 학습 영상을 코스 단위로 저장하고 공유하는 학습 보드 서비스입니다. 영상 등록, 자막 수집과 번역, 요약, 플레이리스트 기반 학습 코스, RAG 검색, Agent 기반 코스 생성을 제공합니다.

## 저장소 구조

```text
agentic-board/
  .github/workflows/ci-cd.yml   StudyTube CI/CD
  siwon/                        StudyTube 애플리케이션
```

`siwon/` 아래에 React 프론트엔드, NestJS API, FastAPI AI 서버, PostgreSQL 설정과 배포 문서가 있습니다.

## 빠른 시작

```powershell
cd siwon
npm install
npm --prefix web install
npm --prefix api install

py -3.13 -m venv ai\.venv
ai\.venv\Scripts\python.exe -m pip install -r ai\requirements.txt

npm run db:up
npm --prefix api run prisma:generate
npm --prefix api run prisma:migrate
npm run all
```

개별 서비스는 다음 명령으로 실행합니다.

```powershell
npm run dev:web
npm run dev:api
npm run dev:ai
```

## 검사

```powershell
npm run lint:web
npm run build:web
npm run lint:api
npm run build:api

node --test web/tests/*.test.ts
npm --prefix api test -- --runInBand
ai\.venv\Scripts\python.exe -m unittest discover -s ai
```

환경 변수, 데이터베이스, 실행 및 배포 방법은 [`siwon/README.md`](siwon/README.md)를 참고하세요.
