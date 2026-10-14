# StudyTube API

학습 데이터와 코스를 관리하는 NestJS 서버입니다. 로그인과 권한을 확인하고 자막 처리, 퀴즈 생성, 다음 영상 추천을 요청합니다. 사용자 데이터와 작업 기록은 PostgreSQL에 저장합니다.

[아키텍처](../docs/architecture.md) | [검증 기록](../docs/verification.md) | [DB 마이그레이션](../docs/database-migrations.md)

## 주요 기능

| 기능 | 담당 코드 |
| --- | --- |
| 영상 등록과 자막 조회 | `LearningItemService` |
| 메모와 진도, 퀴즈, 다음 영상 추천 | `LearningService` |
| 코스 저장과 순서 변경 | `CourseService` |
| 저장된 작업의 큐 전달 | `OutboxRelayService` |
| 백그라운드 작업 실행 | `DurableJobExecutor` |
| Google 로그인 | `GoogleAuthService` |

대표 경로는 `POST /learning/items/intake`, `GET /learning/contexts/:id/captions`, `POST /learning/agent-runs`입니다. 전체 요청과 응답 형식은 [OpenAPI 명세](openapi/current.json)에 있습니다.

`LearningItemService`는 영상 URL과 소유권, 외부 API 사용 예산을 확인합니다. `LearningService`는 추천 실행과 퀴즈, 추천안 승인을 처리합니다.

## 데이터 저장과 작업 처리

API는 학습 데이터 변경과 보낼 작업을 같은 PostgreSQL 트랜잭션에 저장합니다. API 프로세스 안의 Outbox Relay가 작업 기록을 읽어 Valkey의 BullMQ 큐로 보냅니다. 별도 Worker가 작업을 가져가 자막과 퀴즈 등을 처리합니다.

[학습 데이터 모델](../docs/architecture.md#데이터-모델)은 사용자별 영상 등록과 코스 학습, 메모와 진도의 관계를 설명합니다. 퀴즈는 `adaptive_quiz_loops`를 기준으로 근거와 문제, 제출 기록을 저장합니다.

## 인증

운영 환경은 Google 로그인을 사용합니다. 로그인 뒤에는 HttpOnly 세션 쿠키로 요청을 인증합니다. 브라우저에 Bearer 토큰을 저장하지 않습니다.

개발 및 테스트 환경에서 `AUTH_MODE`가 비어 있으면 기존 이메일 인증을 사용합니다. Google 로그인을 확인할 때는 `AUTH_MODE=google_only`를 설정합니다. 운영 환경에서는 인증 모드를 반드시 지정해야 합니다.

## 코스 저장 규칙

- 코스와 영상 순서, 소유자의 학습 설정, 피드백을 함께 관리합니다.
- 정보 수정과 영상 순서 변경, 공개와 보관 요청은 `expectedVersion`을 받습니다. 저장된 버전과 다르면 409를 반환합니다.
- 코스 생성은 사용자와 `Idempotency-Key` 조합으로 중복을 막습니다. 같은 내용의 재요청에는 기존 코스를 반환합니다.
- 원본 게시물이 삭제돼도 코스에 저장한 제목과 영상 URL, 썸네일, 채널 정보는 유지합니다. `source_post_id`만 null로 바뀝니다.
- 공개 코스 조회에서는 소유자의 학습 상태와 작성자 ID, 이메일을 반환하지 않습니다.

## 코스 API

소유자 전용 API는 세션에서 사용자 ID를 가져옵니다.

| Method | Path | 용도 |
| --- | --- | --- |
| `POST` | `/courses` | 비공개 코스 초안 생성 |
| `GET` | `/courses` | 내 코스 목록 조회 |
| `GET` | `/courses/:id` | 내 코스 상세 조회 |
| `PATCH` | `/courses/:id` | 코스 정보 수정 |
| `PUT` | `/courses/:id/steps` | 영상 목록 교체와 순서 변경 |
| `POST` | `/courses/:id/publish` | 코스 공개 |
| `POST` | `/courses/:id/archive` | 코스 보관 |
| `POST` | `/courses/:id/feedback` | 공개 코스 피드백 등록 |
| `GET` | `/explore/courses` | 공개 코스 목록 조회 |
| `GET` | `/explore/courses/:id` | 공개 코스 상세 조회 |

다른 사용자의 코스를 소유자 전용 API로 조회하거나 수정하면 404를 반환합니다. 잘못된 입력은 400으로 응답합니다. 버전이 오래됐거나 같은 멱등 키로 다른 내용을 보내면 409를 반환합니다. 피드백 요청 제한을 넘으면 429와 `Retry-After`를 반환합니다. PostgreSQL 오류 원문은 응답에 포함하지 않습니다.

## 로컬 실행

저장소 루트에서 실행합니다. Node.js 24.8 이상과 PostgreSQL 16이 필요합니다.

```powershell
Copy-Item api\.env.example api\.env
npm run db:up
npm --prefix api ci
npm --prefix api run db:migrate:up
npm --prefix api run start:dev
```

Worker는 [개발 환경 문서](../docs/environment-setup.md#서비스-실행)의 별도 명령으로 실행합니다.

## 검증

```powershell
npm --prefix api run lint
npm --prefix api test -- --runInBand
npm --prefix api run test:e2e -- --runInBand
npm --prefix api run build
```

코스 관련 통합 테스트는 다음과 같이 나눠 실행할 수 있습니다.

```powershell
npm --prefix api run test:e2e -- --runInBand course-schema.e2e-spec.ts
npm --prefix api run test:e2e -- --runInBand course-migration.e2e-spec.ts
npm --prefix api run test:e2e -- --runInBand course-http.e2e-spec.ts
npm --prefix api run test:e2e -- --runInBand course-concurrency.e2e-spec.ts
npm --prefix api run test:e2e -- --runInBand course-cutover.e2e-spec.ts
```

이 테스트들은 실제 PostgreSQL에서 동시 수정과 중복 생성, 원본 삭제 후 코스 정보 보존을 확인합니다. 공개 코스 응답에 비공개 필드가 없는지와 데이터 전환 중 쓰기가 차단되는지도 검사합니다.

## 기존 데이터 전환

기존 playlist 테이블을 유지한 상태에서 코스 데이터를 채우고 원본과 변환 결과를 비교합니다. `legacy`, `freeze`, `course` 모드와 advisory lock으로 기존 쓰기와 새 코스 쓰기가 동시에 실행되지 않게 합니다.

```powershell
$env:COURSE_CUTOVER_MODE='legacy'
$env:ALLOW_COURSE_BACKFILL='true'
npm --prefix api run db:course:backfill
npm --prefix api run db:course:verify
```

`freeze`에서는 진행 중인 쓰기가 끝난 뒤 배타적 advisory lock을 얻어 전환합니다. `course` 모드에서는 데이터를 바꾸는 backfill을 거부합니다. 개발 및 테스트 환경에서 모드를 생략하면 `legacy`를 사용합니다. 운영 환경에서는 반드시 모드를 지정해야 합니다.

전환 순서와 복구 조건은 [DB 마이그레이션](../docs/database-migrations.md)에 있습니다.
