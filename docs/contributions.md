# 팀 작업과 이시원의 구현 범위

StudyTube는 여러 기여자가 YouTube 학습 서비스를 함께 만들며 시작했습니다. 초기 구현에는 게시판, 영상 등록, 자막 처리, 검색과 추천 기능이 포함됐습니다.

이 문서는 이시원이 2026년 7월부터 맡은 Web, API, AI와 배포 기능을 현재 코드 경로 기준으로 정리합니다.

## 제품 흐름

- 영상 주소를 입력하고 바로 학습을 시작합니다.
- 현재 문장, 내용 정리, 메모, 퀴즈를 LearningWorkspace에서 함께 사용합니다.
- 브라우저에 저장한 최근 영상은 학습 화면에서, API에 저장한 Course는 내 코스 화면에서 다시 선택합니다.
- 사용자별 최근 학습 목록과 standalone 영상의 재생 위치 및 완료 여부는 브라우저 localStorage에 저장합니다.
- 학습 목표에 맞는 영상 후보를 브라우저 Course 초안으로 구성하고 사용자가 저장합니다.
- 데스크톱과 모바일에서 같은 학습 순서를 유지하도록 화면을 전환합니다.

관련 코드:

- [web/src/features/learning](../web/src/features/learning)
- [web/src/features/learning/learningHistory.ts](../web/src/features/learning/learningHistory.ts)
- [web/src/features/course](../web/src/features/course)
- [web/src/learningIntake.ts](../web/src/learningIntake.ts)

## 인증과 Course

- 서버 세션은 HttpOnly cookie를 사용합니다.
- 이메일 확인 결과와 사용자 프로필을 저장합니다.
- Course의 순서, 공개 범위와 버전을 관리합니다.
- idempotency 처리로 같은 요청의 중복 생성을 막습니다.
- optimistic concurrency로 동시에 수정된 Course를 이전 버전으로 덮어쓰지 않게 합니다.

관련 코드:

- [api/src/auth](../api/src/auth)
- [api/src/course](../api/src/course)
- [api/src/learning/learning.service.ts](../api/src/learning/learning.service.ts)

## 자막과 학습 데이터

- 원문, 번역과 검색 준비 상태를 나눠 준비된 자막부터 공개합니다.
- 영상 앞부분이 비어 있으면 자막 보강을 요청합니다.
- 현재 재생 구간에 저장 문장이 없으면 YouTube 기본 자막을 사용합니다.
- 사용자가 선택하면 재생 중인 탭 소리로 실시간 자막을 시작합니다.
- 메모를 작성한 재생 시점과 함께 저장합니다.
- 퀴즈 범위를 0초부터 현재 재생 위치까지로 요청하고, ready 상태인 caption artifact의 자막 버전과 범위 안의 문장을 근거로 저장합니다.
- 화면 phase가 translation_pending, index_pending, partial 또는 complete이고 현재 위치까지 끝난 원문 문장이 5개 이상이면 퀴즈 요청을 엽니다.
- 학습 영상, 사용자 학습 항목과 Course 단계를 분리해 저장합니다.

관련 코드:

- [web/src/features/learning/captionState.ts](../web/src/features/learning/captionState.ts)
- [web/src/features/learning/liveCaptions.ts](../web/src/features/learning/liveCaptions.ts)
- [api/src/learning](../api/src/learning)
- [api/src/retrieval](../api/src/retrieval)
- [ai/caption_service.py](../ai/caption_service.py)

## 중단돼도 다시 이어지는 작업

- provider work 예약과 outbox event를 같은 PostgreSQL transaction에 저장합니다.
- Valkey와 BullMQ로 worker를 요청 처리와 분리합니다.
- lease와 heartbeat로 같은 작업의 동시 실행을 막습니다.
- 완료 결과를 재사용하고 중단된 작업을 재시도합니다.
- 마지막 실패 원인과 dead letter를 함께 기록합니다.
- 자막, 임베딩과 퀴즈 작업에 같은 실행 경계를 적용합니다.

관련 코드:

- [api/src/work/outbox-relay.service.ts](../api/src/work/outbox-relay.service.ts)
- [api/src/work/durable-job.executor.ts](../api/src/work/durable-job.executor.ts)
- [api/src/work/durable-work.router.ts](../api/src/work/durable-work.router.ts)
- [api/src/worker.ts](../api/src/worker.ts)

## AI 학습 순서

### Course 화면의 브라우저 초안

- 사용자의 목표와 학습 설정을 AI, RAG, MCP 검색 입력으로 바꿉니다.
- AI, RAG, MCP 결과를 Course 화면에서 함께 보여 주고, 재생 가능한 영상 후보를 브라우저의 Course 초안으로 구성합니다.
- 브라우저에서 같은 영상을 제거해 학습 순서를 만든 뒤 사용자가 저장을 선택하면 `createCourse`와 `publishCourse`를 호출합니다.
- 후보 생성이나 브라우저 초안만으로 서버의 Course를 변경하지 않습니다.

관련 코드:

- [web/src/features/course/CoursePage.tsx](../web/src/features/course/CoursePage.tsx)
- [web/src/features/course/courseRecommendationStorage.ts](../web/src/features/course/courseRecommendationStorage.ts)
- [web/src/courseApi.ts](../web/src/courseApi.ts)
- [ai/study_plan_graph.py](../ai/study_plan_graph.py)

### 퀴즈 뒤 다음 학습 제안

- 퀴즈 평가 뒤 0초부터 현재 재생 위치까지를 학습 범위로 전달해 AgentRun을 시작합니다.
- AgentRun은 MCP를 거쳐 후보를 검증하며, 완료된 첫 `proposed_step` 하나만 LearningProposal로 만듭니다.
- 사용자가 기존 Course 또는 새 비공개 Course를 선택해 승인할 때만 후보를 Course에 추가합니다.
- 실행 시간, 도구 호출 수, 토큰과 예상 비용에 상한을 둡니다.

관련 코드:

- [web/src/features/learning/useNextLearningProposal.ts](../web/src/features/learning/useNextLearningProposal.ts)
- [api/src/learning/agent-run.processor.ts](../api/src/learning/agent-run.processor.ts)
- [api/src/learning/postgres-learning-proposal.repository.ts](../api/src/learning/postgres-learning-proposal.repository.ts)
- [api/src/mcp/mcp-learning.client.ts](../api/src/mcp/mcp-learning.client.ts)

## CI/CD와 운영

- Web, API, AI, PostgreSQL과 Valkey 통합 검사를 하나의 workflow로 구성합니다.
- OpenAPI 변경과 전체 Git 이력의 secret을 검사합니다.
- 같은 변경분으로 재현 가능한 release artifact를 만들고 SHA-256을 검증합니다.
- GitHub OIDC 임시 권한과 S3, SSM으로 EC2에 배포합니다.
- Caddy만 외부에 노출하고 내부 서비스는 loopback과 Unix socket으로 연결합니다.
- 운영 스크립트로 백업 복원, 서비스 장애, 부하와 Prometheus 경보를 확인합니다.

관련 코드:

- [.github/workflows/ci-cd.yml](../.github/workflows/ci-cd.yml)
- [scripts/build-release-artifact.sh](../scripts/build-release-artifact.sh)
- [scripts/send-ssm-deployment.sh](../scripts/send-ssm-deployment.sh)
- [scripts/ssm-deploy-release.sh](../scripts/ssm-deploy-release.sh)
- [operations](../operations)
