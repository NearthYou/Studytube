# 팀 작업과 개인 구현

StudyTube는 여러 기여자가 함께 시작한 프로젝트입니다. 초기 팀은 게시판, 영상 등록, 자막 처리, 검색과 추천 기능을 만들었습니다.

이시원은 2026년 7월부터 서비스를 영상 학습 중심으로 다시 구성하고 Web, API, AI 작업 처리와 배포를 이어서 개발했습니다.

## 학습 화면

- 영상, 현재 문장, 내용 정리, 메모와 퀴즈를 `LearningWorkspace`에 모았습니다.
- 원문을 먼저 보여 주고 번역은 준비되는 대로 같은 자막에 붙였습니다.
- 자막 표시 여부, 세 단계 크기와 배경 진하기를 조절할 수 있게 했습니다.
- 저장한 메모를 읽기와 수정 상태로 나누고 재생 시점을 함께 남겼습니다.
- 데스크톱과 모바일에서 학습 도구가 화면 밖으로 넘치지 않게 정리했습니다.

관련 코드:

- [web/src/features/learning](../web/src/features/learning)
- [web/src/features/learning/captionState.ts](../web/src/features/learning/captionState.ts)
- [web/src/features/learning/captionPreferences.ts](../web/src/features/learning/captionPreferences.ts)

## 코스와 추천

- 배우고 싶은 내용, 관심 분야와 학습 시간을 추천 입력으로 연결했습니다.
- 최근 본 영상과 저장한 코스의 영상을 제외하고 자막과 영상 길이를 확인한 뒤 후보를 정렬했습니다.
- 추천 결과를 브라우저 초안으로 보여 주고 사용자가 저장해야 코스가 만들어지도록 했습니다.
- 저장한 코스를 검색, 영상 개수와 최근 저장순으로 찾을 수 있는 보관함을 만들었습니다.
- 화면의 코스 삭제는 데이터를 바로 지우지 않고 보관 상태로 바꾸며, 표시된 버전을 함께 보내 동시 수정 충돌을 막았습니다.

관련 코드:

- [web/src/features/course](../web/src/features/course)
- [web/src/courseDiscovery.ts](../web/src/courseDiscovery.ts)
- [api/src/course](../api/src/course)
- [ai/video_recommendation.py](../ai/video_recommendation.py)
- [ai/study_plan_graph.py](../ai/study_plan_graph.py)

## 영상 전체를 사용하는 퀴즈

- 영상 처음과 끝까지 원문 자막이 준비됐는지 Web과 API에서 각각 확인했습니다.
- 전체 자막을 시간순 다섯 구간으로 나눠 한쪽 내용에 치우치지 않게 출제할 문장을 골랐습니다.
- 문제 생성, 형식 검사와 정답이 자막 내용에 맞는지 확인하는 단계를 LangGraph 흐름으로 분리했습니다.
- 문제에 사용한 자막 버전과 시점을 저장해 답을 확인한 뒤 해당 장면으로 돌아가게 했습니다.
- 외부 생성이 늦어지거나 실패했을 때 화면이 계속 대기하지 않도록 종료 상태를 나눴습니다.

관련 코드:

- [web/src/features/learning/useAdaptiveQuiz.ts](../web/src/features/learning/useAdaptiveQuiz.ts)
- [api/src/learning/postgres-quiz.repository.ts](../api/src/learning/postgres-quiz.repository.ts)
- [api/src/learning/quiz-evidence-sampling.ts](../api/src/learning/quiz-evidence-sampling.ts)
- [ai/quiz_generation.py](../ai/quiz_generation.py)
- [ai/quiz_generation_graph.py](../ai/quiz_generation_graph.py)

## API와 백그라운드 작업

- HttpOnly 세션, 사용자 소유권과 요청 멱등성 검사를 API에 모았습니다.
- 학습 변경과 outbox event를 PostgreSQL transaction에 함께 기록했습니다.
- Valkey와 BullMQ로 자막, 임베딩, 퀴즈와 내용 정리 작업을 요청 처리에서 분리했습니다.
- lease와 heartbeat로 동시 실행을 막고 완료 상태가 저장된 작업이 다시 왔을 때 기존 결과를 재사용했습니다.
- 코스 버전과 다음 학습 승인 처리를 같은 transaction 경계에서 다뤘습니다.

관련 코드:

- [api/src/learning](../api/src/learning)
- [api/src/work/outbox-relay.service.ts](../api/src/work/outbox-relay.service.ts)
- [api/src/work/durable-work.router.ts](../api/src/work/durable-work.router.ts)
- [api/src/work/durable-job.executor.ts](../api/src/work/durable-job.executor.ts)

## 로그인과 계정 데이터

- 운영 인증을 Google 로그인 하나로 정리하고 OAuth 시도 값을 암호화해 저장했습니다.
- 로그인 뒤에는 HttpOnly 세션 쿠키를 사용하고 Origin과 요청 형식을 다시 확인했습니다.
- 추천에 쓰는 관심 분야, 학습 시간과 목표를 별도 화면에서 수정할 수 있게 했습니다.
- 계정 삭제 전에 같은 Google 계정으로 다시 확인하고 사용자와 학습 데이터를 한 transaction에서 삭제했습니다.

관련 코드:

- [api/src/auth/google](../api/src/auth/google)
- [api/src/account](../api/src/account)
- [web/src/features/account](../web/src/features/account)

## CI/CD와 운영

- Web, API, AI, PostgreSQL과 Valkey 통합 검사를 하나의 GitHub Actions 흐름으로 구성했습니다.
- 같은 커밋으로 재현 가능한 release를 만들고 SHA-256을 다시 확인하도록 했습니다.
- GitHub OIDC 임시 권한, S3 Object Lock과 AWS SSM으로 SSH 없는 배포 경로를 만들었습니다.
- 서비스별 실행 계정과 파일 권한을 나누고 API, AI와 Worker 상태를 전환 전에 확인했습니다.
- 백업 복원, 배포 실패, 부하와 Prometheus 경보를 운영 스크립트로 확인했습니다.

관련 코드:

- [.github/workflows/ci-cd.yml](../.github/workflows/ci-cd.yml)
- [scripts/build-release-artifact.sh](../scripts/build-release-artifact.sh)
- [scripts/ssm-deploy-release.sh](../scripts/ssm-deploy-release.sh)
- [operations](../operations)
