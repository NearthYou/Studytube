# 데이터베이스 마이그레이션 운영 가이드

StudyTube API는 애플리케이션 시작 중에 스키마를 만들지 않는다. `node-pg-migrate`가 변경 이력을 관리하고, 배포 스크립트는 마이그레이션 성공 후에만 API를 시작한다.

현재 마이그레이션은 다음 순서로 적용된다.

1. `1753660800000_baseline-schema`: 기존 운영 테이블을 안전하게 편입한다.
2. `1753660801000_concurrent-indexes`: 보조 인덱스를 동시 생성한다.
3. `1753660802000_auth-hardening`: 쿠키 세션과 인증 데이터를 강화한다.
4. `1753660803000_course-aggregate`: 기존 playlist 테이블을 유지한 채 Course 테이블과 지연 제약 조건을 추가한다.

## 로컬 실행

저장소 루트에서 PostgreSQL을 시작하고 API 디렉터리에서 상태를 확인한다.

```powershell
npm run db:up
Set-Location api
npm run db:migrate:status
npm run db:migrate:up
```

`db:migrate:status`는 적용 예정 SQL을 보여 주며 데이터베이스를 변경하지 않는다. API는 `db:migrate:up`이 성공한 뒤에 시작한다.

## 기존 데이터 도입 검증

아래 fixture 명령은 `public` 스키마를 초기화하므로 로컬의 전용 `*_test` 데이터베이스에서만 허용된다.

```powershell
$env:NODE_ENV='test'
$env:DATABASE_URL='postgresql://app:app@localhost:5432/app_test'
$env:MIGRATION_ADOPTION_DATABASE='app_test'
$env:ALLOW_LEGACY_FIXTURE_RESET='true'
npm run db:migrate:setup-legacy-fixture

$env:ALLOW_MIGRATION_ADOPTION_TEST='true'
npm run db:migrate:test-adoption
```

도입 검증기는 기존 테이블의 행 fingerprint, 관계, sequence 상태를 비교하고 concurrent index가 valid와 ready 상태인지 확인한다. 운영 데이터베이스에서는 fixture reset을 실행하지 않는다.

## legacy 데이터 Course backfill

backfill은 명시적 허용 값과 `DATABASE_URL`이 모두 있어야 실행된다. `course` 모드에서는 시작 전에 실패하므로 이미 발생한 네이티브 Course 쓰기를 덮어쓰지 않는다.

초기 backfill은 `legacy` 모드에서 실행한다.

```powershell
$env:COURSE_CUTOVER_MODE='legacy'
$env:ALLOW_COURSE_BACKFILL='true'
npm run db:course:backfill
npm run db:course:verify
```

각 playlist는 하나의 트랜잭션으로 처리된다. audit에는 다음 정보가 함께 기록된다.

- legacy playlist ID
- 선택한 순서 복원 방식
- 원본과 대상의 SHA-256 fingerprint
- step과 feedback 개수
- 완료 시각

정상적인 `position` 값이 `1..N`을 이루면 그 상대 순서를 사용한다. 값이 0이거나 중복되거나 비어 있으면 post ID 순서로 복원하고 `post_id_fallback`을 기록한다. 재실행은 두 fingerprint가 모두 같은 항목만 건너뛰며, freeze 전 legacy 변경은 해당 Course만 다시 만든다.

검증기는 읽기 전용 스냅샷에서 root, owner별 개수, 정렬된 snapshot, feedback 전체 필드, audit fingerprint, 누락 참조, 필수 snapshot, sequence 여유를 정확히 비교한다. 진단이 하나라도 있으면 종료 코드가 0이 아니다.

## writer authority

운영 환경은 `COURSE_CUTOVER_MODE`를 반드시 명시해야 한다.

| 값       | legacy mutation | Course mutation | backfill |
| -------- | --------------- | --------------- | -------- |
| `legacy` | 허용            | 거부            | 허용     |
| `freeze` | 거부            | 거부            | 허용     |
| `course` | 거부            | 허용            | 거부     |

legacy와 Course mutation은 같은 PostgreSQL advisory transaction lock을 공유한다. freeze API가 새 mutation을 거부한 상태에서 backfill이 exclusive advisory lock을 얻으므로, 이미 허용된 트랜잭션이 끝날 때까지 기다린 뒤 delta를 계산한다.

## 운영 cutover

전환에는 CI를 통과한 하나의 `DEPLOY_SHA`만 사용한다. 모든 serving instance를 동일한 freeze 릴리스로 바꾼 뒤 다음 단계로 진행한다.

### 1. legacy 상태에서 사전 backfill

```bash
cd api
COURSE_CUTOVER_MODE=legacy ALLOW_COURSE_BACKFILL=true npm run db:course:backfill
COURSE_CUTOVER_MODE=legacy npm run db:course:verify
```

이 단계는 서비스 중에도 재실행할 수 있지만 최종 parity를 보장하지는 않는다. legacy 쓰기가 계속 가능하기 때문이다.

### 2. 같은 SHA를 freeze로 배포

서버의 `api/.env`에 다음 값을 둔다.

```dotenv
NODE_ENV=production
COURSE_CUTOVER_MODE=freeze
COURSE_CUTOVER_STATE_DIR=.studytube-deploy-state
```

CI가 검증한 커밋을 고정해서 배포한다.

```bash
DEPLOY_BRANCH=main DEPLOY_SHA=<green-ci-sha> APP_DIR=/home/ubuntu/studytube \
  bash scripts/deploy-ec2.sh main
```

배포 스크립트는 다음 순서를 지킨다.

1. 원격 branch의 SHA와 `DEPLOY_SHA`가 같은지 확인한다.
2. 인증 마이그레이션 전이라면 기존 backup restore 검증 표식을 확인한다.
3. freeze 모드로 같은 릴리스를 시작하고 `/health/ready`를 확인한다.
4. guarded delta backfill이 exclusive advisory lock을 얻어 기존 mutation을 drain한다.
5. exact verifier를 실행한다.
6. 성공한 SHA와 PostgreSQL database identity를 `course-freeze-verified` 표식에 원자적으로 기록한다.

수동 점검이 필요하면 freeze API가 실행 중인 상태에서 같은 명령을 사용할 수 있다.

```bash
cd api
COURSE_CUTOVER_MODE=freeze ALLOW_COURSE_BACKFILL=true npm run db:course:backfill
COURSE_CUTOVER_MODE=freeze npm run db:course:verify
```

### 3. 같은 SHA를 course로 활성화

`api/.env`의 모드만 바꾸고 같은 SHA로 다시 배포한다.

```dotenv
NODE_ENV=production
COURSE_CUTOVER_MODE=course
COURSE_CUTOVER_STATE_DIR=.studytube-deploy-state
```

```bash
DEPLOY_BRANCH=main DEPLOY_SHA=<same-green-ci-sha> APP_DIR=/home/ubuntu/studytube \
  bash scripts/deploy-ec2.sh main
```

스크립트는 freeze parity 표식의 SHA나 database identity가 현재 대상과 다르면 프로세스를 내리기 전에 거부한다. legacy 또는 새로운 freeze 배포를 시작할 때는 과거 parity 표식을 먼저 무효화한다. course health check가 성공하면 durable activation 표식을 남긴다. 이후 일반 course 재배포에서는 legacy backfill을 다시 실행하지 않는다.

## smoke check

활성화 직후 다음 동작을 HTTP 경계에서 확인한다.

1. owner가 idempotency key로 draft Course를 만든다.
2. 같은 요청 재시도가 같은 Course ID를 반환한다.
3. owner가 현재 version으로 publish한다.
4. anonymous 사용자가 `/explore/courses/:id`를 읽고 owner learning state가 없는지 확인한다.
5. 오래된 `expectedVersion` 수정이 409인지 확인한다.
6. archive 후 public detail이 404인지 확인한다.
7. `/health/live`, `/health/ready`, AI `/health`, web root가 성공하는지 확인한다.

자동화된 HTTP, race, privacy 검증은 CI의 Course 전용 E2E 단계에서 실행된다.

## rollback 경계

Course 스키마는 additive이므로 legacy 테이블을 삭제하지 않는다.

- 첫 네이티브 Course 쓰기 전: legacy 데이터가 authoritative하고 exact parity가 유지된다면 이전 애플리케이션으로 돌아갈 수 있다.
- 첫 네이티브 Course 쓰기 후: Course 변경을 legacy에 역으로 기록하지 않으므로 이전 애플리케이션은 lossless rollback이 아니다. `freeze`로 mutation을 막고 원인을 수정한 뒤 roll forward한다.
- 운영 스키마 rollback: Course migration의 `down`을 첫 대응으로 사용하지 않는다. Course 또는 audit 데이터가 있으면 guarded down이 거부한다.

배포 스크립트는 활성화 직후 네이티브 쓰기 발생 여부를 증명할 수 없으므로, 성공한 course 활성화부터 보수적으로 post-write 경계로 취급한다. 활성화 이후 `legacy` 모드 복귀를 거부하며, `freeze` 복구에서도 자동 legacy backfill을 실행하지 않는다.

인증 마이그레이션의 검증된 backup 표식과 migration-before-start 순서, API readiness와 AI 직접 health check는 Course 전환에서도 그대로 유지된다.

## CI 증적

API job은 PostgreSQL 16에서 다음 항목을 실행한다.

- clean migration과 Course schema invariant E2E
- guarded legacy fixture adoption
- Course backfill, exact verify, 두 번째 no-op backfill, 재검증
- Course HTTP privacy와 idempotency E2E
- optimistic concurrency와 lifecycle race E2E
- cookie-only 인증 경계와 Argon2 bound
- 전체 unit, E2E, lint, build

web job은 Node test, lint, production build를 실행한다. Terraform은 이 프로젝트 범위에 포함하지 않는다.
