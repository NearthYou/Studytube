# 구현 역할

StudyTube는 여러 contributor가 함께 시작한 YouTube 학습 서비스입니다. 초기 팀은 게시판, 영상, 자막, 검색과 추천 흐름을 구현했습니다.

## 이시원

2026년 7월 이후 guided learning, backend hardening과 배포 구조를 확장했습니다.

| 영역 | 주요 작업 | 관련 PR |
| --- | --- | --- |
| PostgreSQL | versioned migration과 fixture | PR 10 |
| Auth | cookie session, email verification, profile | PR 13, PR 29부터 PR 32 |
| Course | aggregate, concurrency와 idempotency | PR 14 |
| Learning runtime | retrieval, quiz, proposal와 MCP 경계 | PR 15, PR 20부터 PR 23, PR 38 |
| Durable work | outbox, Valkey, lease, retry와 dead letter | PR 23 |
| Deployment | immutable bundle, checkout, migration과 EC2 복구 | PR 24부터 PR 28, PR 34 |
| Operations | release verification과 live deployment 정보 | PR 36 |

## 현재 구현

- 영상 등록부터 자막, 메모, 퀴즈와 다음 학습 제안까지의 guided learning 흐름
- PostgreSQL transaction과 outbox를 사용한 durable background work
- cookie-only authentication과 email verification
- Course version, approval과 optimistic concurrency
- immutable release bundle과 EC2 deployment lifecycle
