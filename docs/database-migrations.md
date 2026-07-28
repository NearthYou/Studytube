# 데이터베이스 마이그레이션 운영 가이드

StudyTube API는 애플리케이션 시작 시 스키마나 샘플 데이터를 만들지 않습니다. `node-pg-migrate`가 스키마 변경 이력을 소유하며, PostgreSQL 연결에 실패한 API는 시작을 중단합니다.

현재 최초 설치는 두 단계로 구성됩니다.

1. `1753660800000_baseline-schema`가 테이블을 만들거나 기존 런타임 DDL 테이블을 도입합니다.
2. `1753660801000_concurrent-indexes`가 트랜잭션 밖에서 보조 인덱스를 동시에 생성합니다.

## 로컬 설치

저장소 루트에서 PostgreSQL을 시작한 뒤 API 디렉터리에서 마이그레이션을 적용합니다.

```powershell
npm run db:up
Set-Location api
npm run db:migrate:status
npm run db:migrate:up
```

`db:migrate:status`는 아직 적용되지 않은 SQL을 dry run으로 보여 주며 데이터베이스를 변경하지 않습니다. API 프로세스는 `db:migrate:up`이 성공한 뒤에만 시작합니다.

## 데모 데이터

데모 데이터는 명시적으로 허용한 비운영 환경의 로컬 PostgreSQL에만 삽입됩니다. `DATABASE_URL`의 host는 `localhost` 또는 `127.0.0.1`이어야 하며, URL의 데이터베이스 이름과 연결 후 `current_database()`가 모두 `DEMO_SEED_DATABASES`의 comma-separated exact allowlist에 포함되어야 합니다. allowlist에는 기본값이 없습니다.

```powershell
$env:ALLOW_DEMO_SEED='true'
$env:NODE_ENV='development'
$env:DATABASE_URL='postgresql://app:app@localhost:5432/app_dev'
$env:DEMO_SEED_DATABASES='app_dev'
npm run db:seed
Remove-Item Env:ALLOW_DEMO_SEED
Remove-Item Env:DEMO_SEED_DATABASES
```

새 데모 사용자는 로그인할 수 없는 marker를 `password_hash`에 저장합니다. 이전 seed가 공개 SHA-256 해시를 저장한 정확한 id/email의 데모 사용자만 marker로 치환하고 해당 사용자의 기존 세션을 무효화하며, 사용자가 변경한 다른 비밀번호 해시와 세션은 보존합니다. 로그인 세션은 인증에 사용한 password hash가 사용자 행에 그대로 남아 있을 때만 행 잠금과 같은 SQL 문 안에서 생성되므로, seed와 동시에 실행된 이전 비밀번호 로그인도 세션을 남기지 못합니다. 고정 id가 이미 존재하는 경우 user의 id/email, post의 id/author/video URL, playlist의 id/owner/title과 comment/feedback 관계가 일치해야만 하위 데이터를 삽입합니다. 제목과 설명 같은 기존 필드는 덮어쓰지 않으며, demo playlist의 title이 변경된 경우에는 하위 항목을 붙이지 않고 seed를 중단합니다. seed 자체는 세션을 만들지 않습니다. 고정 id 삽입 뒤 serial sequence를 맞추는 동안 관련 테이블의 쓰기를 잠시 잠그며, sequence가 이미 더 앞서 있거나 아직 사용되지 않은 custom start가 더 크면 값을 뒤로 이동하지 않습니다.

## 기존 데이터베이스 도입 리허설

checked-in legacy fixture는 마이그레이션 도입 전 `DatabaseService`가 만들던 11개 서비스 테이블, 대표 관계 행, 각 serial sequence 상태를 고정합니다. setup 명령은 `public` 스키마를 초기화하므로 로컬 전용 테스트 데이터베이스에서만 실행해야 합니다.

다음 조건을 모두 만족해야 reset이 시작됩니다.

1. `ALLOW_LEGACY_FIXTURE_RESET=true`
2. `NODE_ENV`가 설정되어 있고 `production`이 아님
3. `DATABASE_URL` host가 정확히 `localhost` 또는 `127.0.0.1`
4. `MIGRATION_ADOPTION_DATABASE`가 `*_test`로 끝남
5. URL의 데이터베이스 이름과 연결 후 `current_database()`가 모두 `MIGRATION_ADOPTION_DATABASE`와 일치함

```powershell
$env:NODE_ENV='test'
$env:DATABASE_URL='postgresql://app:app@localhost:5432/app_test'
$env:MIGRATION_ADOPTION_DATABASE='app_test'
$env:ALLOW_LEGACY_FIXTURE_RESET='true'
npm run db:migrate:setup-legacy-fixture

$env:ALLOW_MIGRATION_ADOPTION_TEST='true'
npm run db:migrate:test-adoption
```

adoption verifier는 이력을 수정하거나 삭제하지 않습니다. 먼저 fixture에 `pgmigrations`가 없음을 확인하고 baseline 한 개만 적용한 뒤 모든 서비스 테이블의 SHA-256 fingerprint와 sequence의 `last_value`, `is_called`가 같은지 비교합니다. 이어서 한 사용자를 갱신한 트랜잭션을 유지한 상태에서 concurrent index migration을 시작하고, 별도 사용자의 갱신이 2초 안에 완료되는지 확인합니다. 마지막으로 migration history 두 건과 `public`의 모든 인덱스가 `indisvalid`, `indisready` 상태인지 검사합니다.

## 배포 순서

1. PostgreSQL 백업을 생성합니다.
2. 새 배포 이미지와 같은 코드 버전에서 `npm run db:migrate:up`을 실행합니다.
3. migration이 성공한 경우에만 새 API 프로세스를 시작합니다.
4. `/health/live`가 200인지 확인합니다.
5. `/health/ready`가 200이고 `dependencies.database.ready`가 `true`인지 확인합니다.
6. 핵심 API와 기존 행 수를 검증합니다.

마이그레이션보다 애플리케이션을 먼저 시작하면 새 코드가 아직 없는 스키마를 읽을 수 있습니다. 배포 스크립트와 수동 복구 모두 migration-before-start 순서를 유지해야 합니다.

## rollback 정책

baseline down은 금지됩니다. baseline은 이미 존재하던 운영 테이블을 도입했을 수 있으므로 어떤 테이블이 자신이 만든 것인지 안전하게 구분할 수 없습니다. 이 migration의 `down`은 테이블을 삭제하지 않고 irreversible 오류로 즉시 실패합니다. 운영 복구는 이전 애플리케이션 이미지를 다시 시작하고, 필요하면 별도의 전진 보정 migration을 배포합니다.

최신 concurrent index migration만 다음처럼 안전하게 내렸다가 다시 올릴 수 있습니다.

```powershell
npm run db:migrate:down -- 1
npm run db:migrate:up -- 1
```

## 실패한 concurrent index 복구

`CREATE INDEX CONCURRENTLY`가 lock timeout이나 연결 종료로 실패하면 PostgreSQL에 invalid index가 남을 수 있습니다. 먼저 상태를 확인합니다.

```sql
SELECT index_class.relname AS index_name,
       index_state.indisvalid,
       index_state.indisready
FROM pg_index AS index_state
JOIN pg_class AS index_class ON index_class.oid = index_state.indexrelid
JOIN pg_namespace AS index_namespace
  ON index_namespace.oid = index_class.relnamespace
WHERE index_namespace.nspname = 'public'
  AND (NOT index_state.indisvalid OR NOT index_state.indisready)
ORDER BY index_class.relname;
```

마이그레이션은 같은 이름의 기존 인덱스를 발견하면 valid, ready, non-unique 상태와 정확한 테이블 및 key 정의를 검사합니다. 정의가 같은 정상 인덱스는 부분 실행의 안전한 결과로 재사용하지만, invalid 또는 다른 정의의 인덱스는 마이그레이션 이력을 기록하지 않고 실패합니다. 실패한 보조 인덱스 이름을 확인한 뒤 명시적 트랜잭션 밖에서 제거하고 migration을 다시 실행합니다. 아래 이름은 조회 결과의 실제 invalid 보조 인덱스로 바꿉니다.

```sql
DROP INDEX CONCURRENTLY IF EXISTS public.failed_secondary_index_name;
```

```powershell
npm run db:migrate:up
```

같은 정의의 valid index는 재사용되고 제거한 invalid index만 다시 생성됩니다. primary key나 unique constraint가 만든 인덱스가 invalid라면 이 절차로 임의 삭제하지 말고 백업과 별도 보정 migration을 사용합니다.
