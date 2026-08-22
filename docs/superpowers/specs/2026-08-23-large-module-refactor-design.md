# StudyTube 대형 모듈 리팩터링 설계

## 배경

StudyTube의 새 학습 흐름은 배포됐지만 다음 파일에는 서로 다른 책임이 과도하게 모여 있다.

- `web/src/App.tsx`: 6,439줄
- `ai/main.py`: 4,428줄
- `ai/mcp_server.py`: 1,231줄
- `ai/test_main.py`: 3,386줄

`App.tsx`에는 현재 라우트와 무관한 Board, Explore, 기존 Watch 화면까지 남아 있다. `main.py`는 FastAPI 조립, 임베딩, YouTube 검색, 자막 수집과 번역, 요약, 학습 계획과 퀴즈 생성을 함께 처리한다. `mcp_server.py`는 설정, 인증, 도구 실행, 응답 검증과 HTTP 조립을 함께 처리한다.

이 리팩터링은 동작을 추가하거나 제품 방향을 다시 결정하지 않는다. 이미 확정된 로그인 우선 학습 흐름과 Course 중심 제품 계약을 유지하면서 코드 책임을 실제 모듈 단위로 분리한다.

## 목표

1. `App.tsx`를 라우팅과 세션 조립만 담당하는 모듈로 줄인다.
2. 사용되지 않는 기존 UI는 이동하지 않고 삭제한다.
3. Python HTTP 조립과 학습 기능 구현을 분리한다.
4. MCP 설정, 인증, 도구 실행, 검증과 전송 책임을 분리한다.
5. 대형 테스트 파일도 기능별 테스트 모듈로 나눈다.
6. 외부 HTTP 경로, 응답 형식, 사용자 흐름과 배포 방식은 유지한다.

## 비목표

- 새 화면이나 새 API 추가
- 데이터베이스 스키마 변경
- Agent, MCP, RAG 동작 변경
- 모델, 공급자, 비용 정책 변경
- AWS 리소스 생성 또는 변경
- `docs/presentation` 수정
- 기존 학습 데이터 삭제

## 선택한 접근

기능 보존형 완전 분리를 사용한다.

단순히 긴 파일을 같은 크기의 여러 파일로 잘라 import를 늘리지 않는다. 호출자가 알아야 하는 인터페이스는 작게 유지하고, 상태와 오류 처리, 외부 호출 순서 같은 복잡도는 각 모듈 내부로 옮긴다. 이미 제품에서 제거된 코드는 별도 보관 모듈로 이동하지 않는다.

### 제외한 접근

1. 기계적 파일 분할

   구현을 그대로 여러 파일로 옮기고 모든 함수를 다시 export하는 방식이다. 변경 위험은 낮지만 얕은 모듈과 순환 import를 만들며 책임 집중을 해결하지 못한다.

2. 부분 정리

   `App.tsx`의 죽은 코드만 삭제하고 Python은 그대로 두는 방식이다. 빠르지만 사용자가 지적한 구조 부채의 절반만 해결한다.

## Web 설계

### 조립 모듈

`web/src/App.tsx`는 다음 책임만 가진다.

- 세션 상태 소유
- 인증 완료, 로그아웃, 사용자 갱신 처리
- 전역 비인가 처리 연결
- `SiteNav`와 `AppRoutes` 조립

목표 크기는 250줄 이하이다.

### 라우팅과 공통 탐색

다음 모듈을 둔다.

- `web/src/app/AppRoutes.tsx`
  - 현재 공개 및 보호 라우트 선언
  - 알 수 없는 경로의 `/` 이동
- `web/src/app/ProtectedRoute.tsx`
  - 로그인 여부와 복귀 경로 처리
- `web/src/app/SiteNav.tsx`
  - 현재 제품 탐색과 로그아웃 실행
- `web/src/app/GuardedLink.tsx`
  - 동일 페이지 탐색 무시 처리

라우팅 모듈은 페이지 구현을 알지만 페이지 내부 상태를 소유하지 않는다.

### 현재 사용되는 화면

현재 라우트에 연결된 화면을 다음 기능 모듈로 이동한다.

- `web/src/features/auth/AuthPage.tsx`
- `web/src/features/auth/VerificationPage.tsx`
- `web/src/features/auth/RegistrationCompletionPage.tsx`
- `web/src/features/onboarding/TutorialPage.tsx`
- `web/src/features/account/MyPage.tsx`
- `web/src/features/account/MyEditPage.tsx`
- `web/src/features/account/ProfileVerificationForm.tsx`
- `web/src/features/course/CoursePage.tsx`

각 화면은 필요한 데이터 함수와 타입을 직접 import한다. `App.tsx`를 중간 전달 모듈로 사용하지 않는다.

### 삭제할 기존 UI

라우트에서 제거됐고 `void` 참조로만 유지되는 다음 구현은 삭제한다.

- `HomePage`
- `ExplorePage`
- `BoardPage`
- `MyPostsPage`
- 기존 `WatchPage`
- 위 화면에서만 쓰는 하위 렌더 함수와 YouTube 플레이어 로더

DB 데이터와 API 코드는 이 삭제 대상에 포함되지 않는다. 현재 Product Cutover 테스트가 보장하는 라우트 집합은 유지한다.

### Web 테스트

- 라우트 보호, 가입 흐름, 계정 수정, Course 화면 동작을 각 기능 모듈 테스트에서 검증한다.
- `App.tsx` 원문에 특정 문자열이 있는지만 검사하는 테스트는 모듈 조립이나 공개 인터페이스를 검사하도록 바꾼다.
- 기존 216개 Web 테스트보다 테스트 수를 줄이지 않는다.
- TypeScript 빌드와 ESLint를 통과해야 한다.

## Python 설계

### 조립 모듈

`ai/main.py`는 다음 책임만 가진다.

- 환경과 런타임 보안 검증 호출
- FastAPI 앱 생성
- 공개 호환 export

`uvicorn main:app` 계약은 유지한다. 목표 크기는 250줄 이하이다.

`ai/app_factory.py`는 middleware, lifespan, health와 기존 HTTP route를 조립한다. route 함수는 입력을 해당 기능 모듈에 전달하고 응답을 반환한다. 기능 구현을 포함하지 않는다.

### 학습 기능 모듈

다음 모듈을 둔다.

- `ai/embeddings.py`
  - 임베딩 입력 검증, 캐시와 공급자 호출
  - 인터페이스: `create_embedding_response(payload)`
- `ai/study_generation.py`
  - 학습 계획과 퀴즈 생성
  - 인터페이스: `build_study_plan(payload)`, `build_quiz_response(payload)`
- `ai/youtube_search.py`
  - oEmbed, Data API, 검색 페이지 fallback과 메타데이터 정규화
  - 인터페이스: `lookup_youtube(params)`
- `ai/summaries.py`
  - 요약 입력 선택, OpenAI 요약, fallback과 캐시
  - 인터페이스: `build_youtube_summary(payload)`
- `ai/captions/pipeline.py`
  - 자막 공급자 선택과 최종 응답 조립
  - 인터페이스: `load_translated_captions(payload)`
- `ai/captions/translation.py`
  - 배치, 압축, 번역 요청과 비동기 번역 작업
- `ai/captions/youtube.py`
  - timedtext, transcript API, yt-dlp 공급자 접근과 복구 옵션
- `ai/captions/parsers.py`
  - JSON3, XML, WebVTT 파싱과 구간 정규화
- `ai/transcription.py`
  - 승인된 음성 전사 호출과 안전한 실패 응답
- `ai/response_cache.py`
  - TTL과 크기 제한이 있는 공통 캐시 구현

생산 Python 파일은 900줄을 넘지 않도록 한다. 작은 상수나 한 번만 쓰는 pass-through 함수를 위한 모듈은 만들지 않는다.

### 의존성 방향

`main.py`에서 기능 모듈로만 의존한다. 자막 파서는 공급자나 FastAPI를 import하지 않는다. 공급자 모듈은 파서와 공통 환경 유틸리티를 사용할 수 있지만 `main.py`를 import하지 않는다.

외부 공급자는 true external 의존성이다. 현재 테스트가 실제로 바꾸는 HTTP client와 OpenAI client 위치에만 내부 seam을 둔다. 생산 adapter 하나만 있는 곳에 새로운 추상 인터페이스를 만들지 않는다.

### MCP 모듈

설치된 `mcp` 패키지와 이름 충돌을 피하기 위해 `ai/mcp_gateway/` 패키지를 사용한다.

- `settings.py`
  - 환경 변수 파싱과 production 비밀 검증
- `assertions.py`
  - 상위 assertion 검증과 하위 assertion 발급
- `transport.py`
  - 제한 시간과 JSON 응답을 가진 HTTP adapter
- `validation.py`
  - YouTube URL, 검색 결과, 메타데이터와 audit 요약 검증
- `gateway.py`
  - capability 확인, 도구 실행과 audit 순서
- `http_app.py`
  - MCP server 등록과 streamable HTTP 앱 조립

`ai/mcp_server.py`는 기존 import 호환을 위한 150줄 이하의 façade로 남긴다. 공개 클래스와 생성 함수는 새 소유 모듈에서 import해 다시 export한다.

### 오류 처리와 보안

- 사용자와 Nest API에 반환하는 오류 코드는 기존 값을 유지한다.
- 원본 공급자 오류, credential, URL query는 응답과 audit에 포함하지 않는다.
- timeout, 허용 host, capability와 assertion 수명 검증을 유지한다.
- YouTube 복구 옵션과 임시 파일 정리는 기존 순서와 제한을 유지한다.
- 자막과 요약 캐시 키 및 TTL 버전을 변경하지 않는다.

### Python 테스트

`ai/test_main.py`를 다음 테스트 모듈로 나눈다.

- `ai/tests/__init__.py`
- `ai/tests/test_embeddings.py`
- `ai/tests/test_study_generation.py`
- `ai/tests/test_youtube_search.py`
- `ai/tests/test_captions.py`
- `ai/tests/test_summaries.py`
- `ai/tests/test_transcription.py`
- `ai/tests/test_app.py`

`test_mcp_server.py`는 1,000줄 이하이므로 기존 동작 테스트 파일로 유지한다. 새 MCP 테스트는 새 소유 모듈 옆에 추가하며 이 파일이 1,000줄을 넘지 않게 한다. 테스트는 `main.py` 내부 함수 배치를 전제로 하지 않고 각 기능 인터페이스의 결과와 외부 호출을 검증한다.

`ai/tests`에는 `__init__.py`를 두어 CI의 `python -m unittest discover -s .`가 하위 테스트를 재귀 탐색하게 한다. 기존 통과 테스트 수보다 줄지 않아야 한다.

## 작업 순서

1. Web에서 사용되지 않는 화면과 전용 helper를 삭제한다.
2. 현재 Web 화면을 기능 모듈로 이동하고 `App.tsx`를 조립 모듈로 줄인다.
3. Python 공통 캐시, 임베딩, 학습 생성과 검색을 분리한다.
4. 자막, 전사와 요약 파이프라인을 분리한다.
5. MCP gateway를 패키지로 분리하고 호환 façade를 둔다.
6. Python 테스트를 기능별로 분리한다.
7. 전체 계약과 실제 PostgreSQL E2E를 재실행한다.
8. PR을 병합하고 main 배포 및 라이브 동작을 확인한다.

각 단계는 동작 보존 커밋으로 분리한다. 한 단계가 실패하면 다음 분리를 진행하지 않고 해당 seam을 먼저 바로잡는다.

## 완료 기준

- `web/src/App.tsx` 250줄 이하
- `ai/main.py` 250줄 이하
- `ai/mcp_server.py` 150줄 이하
- 생산 Python 파일 각각 900줄 이하
- Python 테스트 파일 각각 1,000줄 이하
- `App.tsx`에 `void BoardPage`, `void ExplorePage`, `void MyPostsPage` 없음
- 현재 Web 라우트와 API 경로 변경 없음
- OpenAPI 산출물 변경 없음
- Web 테스트 216개 이상 통과
- API 단위 테스트 720개 이상 통과
- PostgreSQL과 Valkey 전체 E2E 98개 이상 통과
- AI 전체 unittest discover 통과
- Web과 API build, lint 통과
- operations, runtime isolation, actionlint와 Gitleaks 통과
- `docs/presentation` 변경 없음
- main 배포 성공과 라이브 로그인 보호 확인

## 주요 위험과 대응

### Python monkeypatch 위치 변경

기존 테스트는 `main` 모듈의 전역 함수를 patch한다. 구현 소유권이 이동하면 patch가 실제 호출 지점을 바꾸지 못할 수 있다. 테스트를 새 소유 모듈의 인터페이스 기준으로 옮기고, 호환 export는 외부 import 안정성에만 사용한다.

### 순환 import

조립 모듈이 기능 모듈을 import하는 단방향을 유지한다. 기능 모듈은 `main.py`나 `app_factory.py`를 import하지 않는다.

### 죽은 UI와 공유 helper 혼동

삭제 전에 현재 라우트와 import 사용처를 확인한다. 다른 활성 모듈에서 쓰는 pure helper는 기존 전용 모듈에 남기고 JSX 화면 구현만 삭제한다.

### 숨은 계약 변경

route, 상태 코드, 응답 JSON, 캐시 정책과 안전 오류 코드를 변경하지 않는다. OpenAPI diff와 전체 회귀 테스트가 변경을 감지한다.
