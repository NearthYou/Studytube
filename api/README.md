# StudyTube API

StudyTube의 핵심 NestJS 백엔드다. PostgreSQL을 authoritative store로 사용하고, Course aggregate의 순서, 생명주기, 동시성, migration cutover를 애플리케이션과 데이터베이스 경계에서 함께 보장한다.

## 핵심 설계

- cookie-only 인증: 브라우저는 HttpOnly session cookie만 사용하며 bearer token을 저장하지 않는다.
- Course aggregate: root, ordered step snapshot, owner learning state, feedback를 하나의 일관성 경계로 다룬다.
- optimistic concurrency: metadata, step 교체, publish, archive는 `expectedVersion`을 요구하며 오래된 쓰기는 409로 거부한다.
- idempotent create: owner와 `Idempotency-Key` 조합을 PostgreSQL unique constraint로 중재한다. 같은 payload 재시도는 같은 Course로 수렴한다.
- snapshot 보존: 원본 post 삭제는 `source_post_id`만 null로 만들고 제목, 영상 URL, 썸네일, 채널 snapshot은 유지한다.
- privacy-safe projection: owner route와 public route가 별도 SQL projection을 사용한다. public 결과에는 owner learning state, author ID, email이 포함되지 않는다.
- additive migration: legacy playlist 테이블을 유지하면서 Course를 backfill하고 source와 target fingerprint를 exact verify한다.
- writer cutover: `legacy`, `freeze`, `course` 모드와 공용 advisory lock으로 두 writer 계열이 동시에 활성화되지 않게 한다.

## Course HTTP surface

owner route는 인증된 cookie principal에서 owner ID를 가져온다.

| Method  | Path                    | 용도                              |
| ------- | ----------------------- | --------------------------------- |
| `POST`  | `/courses`              | idempotent private draft 생성     |
| `GET`   | `/courses`              | owner Course cursor 목록          |
| `GET`   | `/courses/:id`          | owner detail 조회                 |
| `PATCH` | `/courses/:id`          | versioned metadata 수정           |
| `PUT`   | `/courses/:id/steps`    | versioned step 전체 교체와 재정렬 |
| `POST`  | `/courses/:id/publish`  | draft publish                     |
| `POST`  | `/courses/:id/archive`  | soft archive                      |
| `POST`  | `/courses/:id/feedback` | published Course feedback 추가    |
| `GET`   | `/explore/courses`      | anonymous published 목록          |
| `GET`   | `/explore/courses/:id`  | anonymous published detail        |

다른 사용자의 Course를 owner route로 조회하거나 수정하면 존재 여부를 숨기기 위해 404를 반환한다. validation은 400, stale version과 idempotency payload 충돌은 409, feedback rate limit은 429와 `Retry-After`로 매핑된다. 예상하지 못한 PostgreSQL 오류 원문은 외부로 노출하지 않는다.

## 실행

Node.js 24.8 이상과 PostgreSQL 16이 필요하다.

```powershell
Copy-Item api\.env.example api\.env
npm run db:up
npm --prefix api ci
npm --prefix api run db:migrate:up
npm --prefix api run start:dev
```

로컬과 test 환경에서 `COURSE_CUTOVER_MODE`가 비어 있으면 legacy로 동작한다. production에서는 `legacy`, `freeze`, `course` 중 하나를 반드시 명시해야 한다.

## 검증

```powershell
npm --prefix api run lint
npm --prefix api test -- --runInBand
npm --prefix api run test:e2e -- --runInBand
npm --prefix api run build
```

집중 검증은 다음 경계를 각각 실행한다.

```powershell
npm --prefix api run test:e2e -- --runInBand course-schema.e2e-spec.ts
npm --prefix api run test:e2e -- --runInBand course-migration.e2e-spec.ts
npm --prefix api run test:e2e -- --runInBand course-http.e2e-spec.ts
npm --prefix api run test:e2e -- --runInBand course-concurrency.e2e-spec.ts
npm --prefix api run test:e2e -- --runInBand course-cutover.e2e-spec.ts
```

테스트는 실제 PostgreSQL에서 다음 실패 시나리오를 검증한다.

- 같은 version의 경쟁 쓰기에서 한 요청만 성공하는지
- publish와 마지막 step 삭제가 경쟁해도 빈 published Course가 남지 않는지
- 같은 idempotency key의 동시 create가 한 root로 수렴하는지
- archive와 feedback 경쟁이 생명주기 경계를 넘지 않는지
- post 삭제 후에도 snapshot과 순서가 보존되는지
- backfill 중단 후 재개와 delta 재실행이 안전한지
- public projection에 private 필드가 조회되지 않는지
- freeze parity 전에는 Course writer가 열리지 않는지

## migration 운영

초기 backfill과 exact verifier는 명시적 guard 아래 실행한다.

```powershell
$env:COURSE_CUTOVER_MODE='legacy'
$env:ALLOW_COURSE_BACKFILL='true'
npm --prefix api run db:course:backfill
npm --prefix api run db:course:verify
```

freeze에서 같은 명령을 실행하면 backfill이 exclusive advisory lock을 얻는 동안 이미 허용된 mutation이 drain된다. `course` 모드에서는 mutating backfill이 시작 전에 거부된다.

전체 freeze-to-course 배포 순서와 rollback 경계는 [데이터베이스 마이그레이션 운영 가이드](../docs/database-migrations.md)에 있다.

## 범위

이 API는 백엔드 동작의 핵심 검증 근거에 집중한다. Terraform, Kubernetes, cloud provisioning은 포함하지 않는다. 인프라 역량은 PostgreSQL migration, CI의 실제 데이터베이스 검증, SHA 고정 배포, readiness gate, 안전한 cutover runbook으로 보여 준다.
