# 06. 3일 클론 코딩 로드맵

목표는 모든 기술을 깊게 공부하는 것이 아니라, 클론 코딩을 따라칠 수 있는 최소 체력을 만드는 것이다.

## Day 1: 환경과 React

목표:

```txt
프로젝트 실행
React 화면 구조 이해
폼 입력과 라우팅 이해
```

해야 할 일:

1. `docs/study/01-environment-check.md` 그대로 실행한다.
2. `web/src/main.tsx`와 `web/src/App.tsx`를 읽는다.
3. `pages` 폴더의 페이지 컴포넌트를 하나씩 확인한다.
4. 버튼, input, state 예제를 따라친다.
5. React Router로 주소가 어떻게 바뀌는지 본다.

알아야 할 문법:

```txt
function Component()
props
useState
useEffect
onClick
onChange
map
조건부 렌더링
```

하지 않을 것:

```txt
상태관리 라이브러리
디자인 고도화
애니메이션
```

## Day 2: NestJS와 DB

목표:

```txt
HTTP 요청 흐름 이해
Controller-Service-Module 구조 이해
DB 연결 확인
```

해야 할 일:

1. `api/src/app.controller.ts`를 읽는다.
2. `api/src/app.service.ts`를 읽는다.
3. `/health`, `/health/db`, `/health/ai`를 브라우저에서 확인한다.
4. `api/prisma/schema.prisma`를 열고 Prisma 구조를 읽는다.
5. 예제 모델 하나를 문서에서만 따라 써 본다. 실제 서비스 모델은 아직 확정하지 않는다.

알아야 할 문법:

```txt
@Controller
@Get
@Injectable
constructor 의존성 주입
async / await
try / catch
```

하지 않을 것:

```txt
JWT 인증
권한 관리
복잡한 DB 관계
관리자 기능
```

## Day 3: FastAPI와 AI 개념 연결

목표:

```txt
FastAPI 서버 구조 이해
NestJS가 FastAPI를 호출하는 구조 이해
AI 기능 이름과 역할 구분
```

해야 할 일:

1. `ai/main.py`를 읽는다.
2. `/health`, `/health/db`를 확인한다.
3. NestJS `/health/ai`가 FastAPI를 대신 호출하는지 확인한다.
4. RAG, MCP, Agent 개념을 `docs/study/05-fastapi-ai-basics.md`에서 읽는다.
5. README에 실행 순서를 스스로 한 번 적어 본다.

알아야 할 문법:

```txt
@app.get
def
dict
os.getenv
with
try / except
```

하지 않을 것:

```txt
실제 LLM 호출
복잡한 prompt 작성
Agent 자동화
Vector 검색 구현
```

## 3일 동안의 우선순위

시간이 부족하면 아래 순서만 지킨다.

```txt
1. 실행 환경 확인
2. React 컴포넌트와 라우팅
3. NestJS Controller-Service 구조
4. PostgreSQL 연결
5. FastAPI route
6. NestJS -> FastAPI 호출
7. AI 용어 정리
```

## 기술 스택 선택 기준

이번 학습 환경에서 가져갈 스택:

```txt
React + Vite + TypeScript
NestJS
FastAPI
PostgreSQL + pgvector
Prisma
Docker Compose
```

지금 제외할 스택:

```txt
Next.js
Redux/Zustand
이미지 업로드
웹소켓
Redis
Kubernetes
CI/CD
```

이유는 3일 안에 클론 코딩 흐름을 익히는 데 필요하지 않기 때문이다.
