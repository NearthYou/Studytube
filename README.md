# StudyTube

YouTube 영상을 보며 자막, 메모, 내용 정리와 퀴즈를 한 화면에서 사용하는 학습 서비스입니다. 관심 분야와 학습 시간에 맞는 영상을 묶어 코스로 저장하고 다음 접속에서도 이어서 볼 수 있습니다.

[서비스 바로가기](https://studytube.page) | [CI/CD](https://github.com/NearthYou/Studytube/actions/workflows/ci-cd.yml) | [API 계약](api/openapi/current.json)

`React 19` `TypeScript` `NestJS` `FastAPI` `Python` `LangGraph` `MCP` `RAG` `PostgreSQL` `pgvector` `Valkey` `BullMQ` `AWS`

![영어 원문과 한국어 번역, 학습 도구를 함께 사용하는 StudyTube](docs/demo/studytube-learning-current.png)

영상 아래에서 자막 표시 여부, 크기와 배경 진하기를 조절합니다. 오른쪽에서는 현재 문장, 내용 정리, 메모와 퀴즈를 바꿔 가며 학습합니다.

## 시작한 이유

영상을 보다가 모르는 문장을 번역기로 확인하고 메모장에 적어도, 나중에 그 메모가 몇 분 몇 초의 장면인지 다시 찾기 어렵습니다. YouTube에는 재생 위치는 남지만 어느 문장에서 막혔고 무엇을 메모했으며 어떤 문제를 틀렸는지는 하나의 학습 기록으로 이어지지 않습니다.

StudyTube는 재생 시점을 기준으로 원문, 번역, 메모와 틀린 문제를 묶었습니다. 메모나 오답에서 해당 장면으로 돌아가고, 고른 다음 영상은 코스에 저장해 다음 접속에서 이어 봅니다.

## 제품 방향

![StudyTube가 흩어진 영상 학습을 하나의 흐름으로 묶는 제품 방향](docs/diagrams/studytube-product-direction.svg)

## 사용 흐름

1. YouTube 영상 주소를 넣거나 배우고 싶은 내용을 적습니다.
2. 원문 자막이 준비되는 대로 영상을 보며 문장을 확인합니다.
3. 필요한 문장은 재생 시점과 함께 메모로 저장합니다.
4. 영상 전체 자막이 준비되면 내용을 확인하는 퀴즈를 풉니다.
5. 추천 영상을 코스로 저장하고 다음 학습을 이어 갑니다.

| 배우고 싶은 내용으로 코스 만들기 | 저장한 코스에서 이어 보기 |
| --- | --- |
| ![학습 목표를 입력하는 코스 생성 화면](docs/demo/studytube-course-builder-current.png) | ![검색과 영상 미리보기가 있는 코스 보관함](docs/demo/studytube-course-library-current.png) |

## 주요 기능

| 영역 | 구현 내용 |
| --- | --- |
| 영상 학습 | 현재 문장, 전체 자막, 내용 정리, 시점 메모, 퀴즈 |
| 자막 | 원문 우선 공개, 번역 병합, 앞부분 보강, 표시와 크기 및 배경 설정 |
| 코스 | 학습 목표 기반 추천, 영상 순서 저장, 검색과 필터 및 보관함 |
| 계정 | Google 로그인, 학습 설정, 본인 확인을 거친 계정 삭제 |
| 작업 처리 | PostgreSQL outbox, Valkey와 BullMQ, lease와 heartbeat 및 재시도 |
| 운영 | GitHub Actions, OIDC, S3 Object Lock, SSM 기반 EC2 배포 |

## 문제 해결 과정

### 번역이 끝날 때까지 화면이 비어 있던 문제

처음에는 원문, 번역과 검색 데이터가 모두 준비돼야 학습 화면을 열었습니다. 영상이 길수록 처리 시간만큼 학습 시작도 늦어졌습니다.

원문, 번역과 검색 준비 상태를 나누고 같은 처리 회차에서 나온 결과만 합치도록 바꿨습니다. 이제 원문부터 먼저 보여 주고 번역은 준비되는 대로 같은 문장에 붙입니다.

### 영상 앞부분만 보고도 퀴즈가 만들어지던 문제

일부 자막만으로 문제를 만들면 영상 뒤쪽 내용이 빠질 수 있었습니다. 화면과 API 양쪽에서 자막이 시작과 끝을 모두 덮는지 확인하고 전체 구간을 다섯 부분으로 나눠 문제에 쓸 문장을 고릅니다.

FastAPI의 퀴즈 그래프는 초안을 만든 뒤 보기와 정답이 자막 내용과 맞는지 다시 검사합니다. 출제에 사용한 자막 버전과 시점을 저장하므로 답을 확인한 뒤 해당 장면으로 돌아갈 수 있습니다.

### 작업이 사라지거나 두 번 실행될 수 있던 문제

DB 저장 뒤 별도로 작업 큐에 넣으면 두 단계 사이에서 프로세스가 멈출 수 있습니다. 큐가 같은 작업을 다시 전달했을 때 외부 처리가 중복되는 문제도 있었습니다.

학습 변경과 outbox event를 PostgreSQL에 함께 기록하고 relay가 Valkey 큐로 전달합니다. Worker는 lease와 heartbeat를 갱신하며 실행하고 완료된 작업이 다시 오면 저장한 결과를 돌려줍니다.

### 관련 없는 영상으로 코스가 채워지던 문제

추천 개수를 맞추기 위해 후보를 채우면 학습 목표와 거리가 먼 영상도 코스에 들어갔습니다. 지금은 주제 관련도가 낮거나 최근 본 영상, 저장한 코스의 영상, 재생할 수 없는 영상과 지나치게 긴 영상을 먼저 제외합니다.

남은 후보는 자막 제공 여부, 최근 학습과의 연결, 난이도, 영상 길이와 실습 여부를 함께 점수화합니다. 조건을 통과한 영상이 하나뿐이면 억지로 코스를 만들지 않고 그 영상만 보여 줍니다.

## 아키텍처

![StudyTube의 Web, API, Worker, AI, 데이터 저장소와 배포 경로](docs/diagrams/studytube-system-architecture.svg)

Web은 재생 화면과 입력 상태를 맡고 API는 사용자 권한과 코스, 메모, 퀴즈 데이터를 관리합니다. 오래 걸리는 자막, 번역, 임베딩과 퀴즈 생성은 Worker로 분리했습니다.

클래스 관계와 요청 흐름은 [아키텍처 문서](docs/architecture.md)에서 볼 수 있습니다.

## 데이터 모델

![사용자별 학습 맥락을 중심으로 코스, 자막, 메모와 퀴즈를 연결한 StudyTube 데이터 모델](docs/diagrams/studytube-data-model.svg)

같은 영상이라도 단독 학습과 코스 안의 학습을 구분합니다. 메모, 시청 범위와 퀴즈는 `study_contexts`를 중심으로 연결하고 자막은 영상별 세대를 따로 저장합니다.

## AI 기능을 구현한 방식

AI 기능은 새 코스 만들기, 다음 영상 제안과 퀴즈 생성으로 나눴습니다. 새 코스는 한 요청 안에서 초안을 만들고, 다음 영상 제안은 실행 상태를 PostgreSQL에 남기는 Agent Run으로 처리합니다. 퀴즈는 생성과 검사를 별도 그래프로 묶었습니다.

RAG는 추천에 쓸 학습 자료와 영상 후보를 찾는 검색 계층으로 사용했습니다.

### LangGraph로 새 코스 만들기

코드 흐름: [코스 생성 화면](web/src/features/course/CoursePage.tsx) → [그래프 입력 구성](ai/study_generation.py) → [학습 계획 그래프](ai/study_plan_graph.py) → [영상 후보 정렬](ai/video_recommendation.py)

코스 화면은 저장된 학습 자료 검색과 새 YouTube 코스 생성을 동시에 요청합니다. [RAG 검색](api/src/ai-proxy.service.ts)으로 찾은 자료는 참고 자료로 따로 보여 주고, LangGraph 결과는 저장 전 코스 후보로 보여 줍니다. 코스 생성 요청이 실패하면 별도로 받은 YouTube 검색 결과를 대신 사용합니다.

LangGraph에는 `decide`, `search_video`, `create_playlist_draft` 세 노드만 두고 검색 반복은 최대 4회로 제한했습니다. 재생할 수 없거나 주제와 거리가 먼 영상, 이미 본 영상과 지나치게 긴 영상은 제외합니다. 남은 후보는 자막 유무, 최근 학습, 난이도와 길이를 반영해 정렬합니다. 사용자가 결과와 순서를 확인하고 저장해야 코스가 만들어집니다.

### Agent Run과 MCP로 다음 영상 제안하기

화면과 실행: [학습 화면 hook](web/src/features/learning/useNextLearningProposal.ts) → [실행 생성과 승인](api/src/learning/learning.service.ts) → [Agent 실행 Worker](api/src/learning/agent-run.processor.ts)

MCP와 검색: [MCP Client](api/src/mcp/mcp-learning.client.ts) → [FastAPI MCP 도구](ai/mcp_gateway.py) → [내부 API](api/src/mcp/mcp.controller.ts) → [RAG 검색](api/src/retrieval/postgres-retrieval-search.ts)

퀴즈를 푼 뒤 `다음 학습 찾기`를 누르면 API가 현재 영상과 시청 구간을 스냅샷으로 남기고 Agent Run을 만듭니다. Worker는 실행 상태를 PostgreSQL에 저장합니다. 기본 한도인 3분, 도구 호출 12회, 24,000토큰과 예상 비용 0.5달러를 넘으면 작업을 중단합니다.

현재 실행에서 MCP로 여는 도구는 `propose_next_learning` 하나입니다. NestJS Worker가 FastAPI의 `/mcp`에 세션을 열며, 요청에는 60초 동안 유효한 서명과 검색, 영상 확인, 제안 생성 권한을 넣습니다.

첫 검색은 현재 영상의 자막, 메모와 퀴즈 결과에서 무엇을 공부했는지 찾고, 두 번째 검색은 다음 영상 후보를 찾습니다. PostgreSQL의 `pg_trgm` 키워드 순위와 `pgvector` 벡터 순위는 RRF로 합칩니다. 비공개 자료는 소유자가 일치할 때만 사용하며 추천안은 사용자가 승인해야 기존 코스나 새 비공개 코스에 들어갑니다.

### LangGraph로 영상 전체 퀴즈 만들기

코드 흐름: [출제 구간 선택](api/src/learning/quiz-evidence-sampling.ts) → [퀴즈 그래프](ai/quiz_generation_graph.py) → [문제와 결과 저장](api/src/learning/postgres-quiz.repository.ts)

API는 전체 자막을 시간순 다섯 구간으로 나누고 각 구간의 문장을 문제 재료로 넘깁니다. `generate_questions`는 모델을 호출해 다섯 문제를 만들고, `validate_questions`는 문제 수, 보기 수, 중복과 재생 시점을 묻는 문제부터 코드로 걸러냅니다.

형식을 통과한 문제는 별도 모델 호출로 정답과 해설이 자막 내용에 맞는지 확인합니다. 검사에 실패하면 이유를 넘겨 한 번 다시 만들며, 두 번째 문제도 통과하지 못하면 저장하지 않습니다.

저장할 때 출제에 사용한 자막 버전과 시작, 종료 시점을 문제와 함께 남깁니다. 그래서 오답을 확인한 뒤 문제가 나온 장면으로 바로 돌아갈 수 있습니다.

## 팀 작업과 개인 구현

초기 게시판, 영상 등록과 자막 흐름은 팀이 함께 만들었습니다. 이후 이시원은 서비스를 영상 학습 중심으로 재구성하고 Web, API, AI 작업 처리와 배포 구조를 확장했습니다.

구체적인 구현 범위와 코드 위치는 [팀 작업과 개인 구현](docs/contributions.md)에 정리했습니다.

## CI/CD

CI가 통과한 커밋만 release로 만들고 AWS 장기 키나 SSH 없이 OIDC와 SSM으로 배포합니다. 최신 main에서는 Web 313개, API 843개, AI 184개 테스트와 운영 계약 57개 항목을 통과했습니다.

검증 명령과 최근 실행 결과는 [검증 기록](docs/verification.md), 배포 흐름은 [CI/CD 문서](docs/ci-cd.md)에 있습니다.

## 로컬 실행

Node.js 24.8 이상, Python 3.12, Docker Compose v2가 필요합니다. AI 의존성까지 같은 조건으로 맞추려면 Linux 또는 WSL 환경을 권장합니다.

```bash
cp .env.example .env
cp api/.env.example api/.env
npm --prefix api ci
npm --prefix web ci
python3 -m venv ai/.venv
ai/.venv/bin/python -m pip install --require-hashes -r ai/requirements.txt
npm run db:up
npm run db:migrate:up
npm run all
```

- Web: `http://localhost:5173`
- API: `http://localhost:3000`
- AI: `http://localhost:8000`

세부 설정은 [개발 환경 문서](docs/environment-setup.md), API와 운영 명령은 [API README](api/README.md)와 [Operations README](operations/README.md)에 있습니다.
