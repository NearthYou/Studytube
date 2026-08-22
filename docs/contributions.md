# 팀 결과와 개인 기여

StudyTube는 여러 contributor가 함께 만든 팀 프로젝트에서 시작했다. 게시판, 영상, 자막, 검색과 추천의 초기 구현, UI와 project asset 전체를 이시원 개인 성과로 표시하지 않는다.

## 팀 결과

- React Web, NestJS API, FastAPI와 PostgreSQL을 연결한 YouTube 학습 서비스
- 영상, 자막, 검색, Course와 학습 기록의 end-to-end 흐름
- 팀이 합의한 UI, 데이터와 발표 자료

## 이시원의 후속 범위

2026년 7월 28일 이후 NearthYou가 작성한 merged PR은 migration, cookie auth, Course aggregate, production runtime, durable work, 배포 복구와 guided learning redesign을 다룬다.

| 범위 | 대표 근거 |
| --- | --- |
| PostgreSQL migration | PR 10 |
| cookie-only auth와 email verification | PR 13, PR 29부터 PR 31 |
| Course aggregate와 concurrency | PR 14 |
| retrieval, learning runtime와 운영 경계 | PR 15, PR 20부터 PR 23 |
| immutable EC2 deployment와 장애 수정 | PR 24부터 PR 28, PR 34 |
| profile과 watch flow 복구 | PR 32 |
| live deployment 사실 보정 | PR 36 |
| guided video learning, caption, quiz와 proposal | PR 38 |

PR 수와 commit 수는 기여량 점수가 아니다. 개인 구현의 시작점을 찾고, 팀에서 이미 있던 기능과 후속 변경을 구분하는 근거로만 사용한다.

## 공동 작업 경계

초기 contributor의 코드와 design 위에 후속 구조가 합쳐졌다. 현재 source에 NearthYou commit이 많더라도 이전 팀의 제품 아이디어, UI와 구현까지 개인 단독 ownership으로 넓히지 않는다.

운영 결과도 같은 기준을 따른다. CI job 통과는 현재 commit의 repository 결과이고, AWS 배포 성공이나 production availability는 별도 run과 실제 service 확인이 있어야 개인 운영 성과로 연결할 수 있다.
