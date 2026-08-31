# StudyTube 전체 사용자 데이터 초기화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 운영 사용자 데이터와 파생 작업 데이터를 검증된 7일 백업 뒤 한 번만 안전하게 초기화하고 새 Google 계정이 들어올 빈 상태를 만든다.

**Architecture:** TypeScript reset engine이 live schema와 명시적 manifest를 비교하고 계획과 실행을 분리한다. Linux 운영 스크립트가 쓰기 중단, PostgreSQL dump, S3 암호화 보관, 실제 restore drill, DB transaction, Valkey 초기화와 재기동을 순서대로 조정한다. 운영 실행은 live 행 수와 백업 위치를 사용자에게 제시한 뒤 별도 최종 승인을 받아야 한다.

**Tech Stack:** Node.js 24.8 이상, TypeScript, PostgreSQL 16, Valkey 9, Bash, Docker Compose, AWS S3, AWS SSM

**Spec:** `docs/superpowers/specs/2026-08-31-google-only-auth-reset-design.md`

## Global Constraints

- `2026-08-31-google-only-auth.md`의 Google 인증 확장 마이그레이션과 storage epoch가 먼저 구현되어야 한다.
- `pgmigrations`, `learning_cutover_runs`, `learning_cutover_authority`, `stt_provider_approvals`만 보존한다.
- manifest에 없는 public table이 하나라도 있으면 실행을 거부한다.
- `TRUNCATE ... CASCADE`를 사용하지 않는다.
- 운영 reset은 새 쓰기와 worker 처리가 중단된 상태에서만 수행한다.
- 전체 PostgreSQL dump를 별도 DB에 복원해 검증하기 전에는 삭제를 시작하지 않는다.
- 백업은 S3 server-side encryption을 사용하고 생성 시각부터 7일 동안만 보관한다.
- S3 object lock이나 versioning 때문에 7일 폐기가 불가능하면 운영 reset을 시작하지 않는다.
- 운영 사용자 데이터 삭제는 live 행 수, bucket, object key, checksum과 manifest hash를 제시한 뒤 별도 승인을 받아야 한다.
- `artifacts/`와 `design-qa.md`는 수정, 이동, 삭제하거나 커밋하지 않는다.

---

### Task 1: reset manifest와 live schema planner

**Files:**
- Create: `api/src/maintenance/user-data-reset.manifest.ts`
- Create: `api/src/maintenance/user-data-reset.plan.ts`
- Create: `api/src/maintenance/user-data-reset.plan.spec.ts`

**Interfaces:**
- Consumes: PostgreSQL `pg_catalog`의 public ordinary table 목록과 행 수
- Produces: `buildUserDataResetPlan(client): Promise<UserDataResetPlan>`

- [ ] **Step 1: unknown table과 보존 대상 실패 테스트 작성**

```ts
expect(() => classifyTables([...knownTables, 'surprise_table'])).toThrow(
  'UNKNOWN_APPLICATION_TABLE:surprise_table',
);
expect(plan.preservedTables).toEqual([
  'learning_cutover_authority',
  'learning_cutover_runs',
  'pgmigrations',
  'stt_provider_approvals',
]);
expect(plan.resetTables).toContain('users');
expect(plan.resetTables).toContain('work_outbox_events');
expect(plan.resetTables).toContain('google_auth_attempts');
```

- [ ] **Step 2: planner 테스트 실패 확인**

Run: `npm --prefix api test -- --runInBand user-data-reset.plan.spec.ts`

Expected: FAIL because the manifest and planner do not exist.

- [ ] **Step 3: 정확한 manifest 작성**

```ts
export const PRESERVED_APPLICATION_TABLES = [
  'learning_cutover_authority',
  'learning_cutover_runs',
  'pgmigrations',
  'stt_provider_approvals',
] as const;

export const RESET_APPLICATION_TABLES = [
  'adaptive_quiz_answers',
  'adaptive_quiz_attempts',
  'adaptive_quiz_evidence',
  'adaptive_quiz_loops',
  'adaptive_quiz_questions',
  'adaptive_quiz_review_proposals',
  'agent_run_attempts',
  'agent_run_state_transitions',
  'agent_run_work_items',
  'agent_runs',
  'agent_tool_calls',
  'auth_rate_limits',
  'caption_artifact_segments',
  'caption_artifacts',
  'caption_generation_states',
  'caption_work_failures',
  'comments',
  'course_backfill_audits',
  'course_feedback',
  'course_steps',
  'courses',
  'google_auth_attempts',
  'learning_context_summaries',
  'learning_cutover_source_changes',
  'learning_items',
  'learning_notes',
  'learning_progress',
  'learning_progress_events',
  'learning_proposals',
  'learning_retrieval_context_snapshots',
  'legacy_learning_context_mappings',
  'pending_registrations',
  'playlist_feedback',
  'playlist_items',
  'playlists',
  'post_embeddings',
  'post_tags',
  'posts',
  'provider_subscription_reservations',
  'provider_work_reservations',
  'quiz_answers',
  'quiz_attempts',
  'quiz_questions',
  'quizzes',
  'retrieval_embedding_cache',
  'retrieval_embeddings',
  'sessions',
  'study_contexts',
  'tags',
  'users',
  'video_assets',
  'video_sources',
  'verification_email_outbox',
  'work_dead_letters',
  'work_job_claims',
  'work_job_results',
  'work_outbox_events',
  'work_replay_audits',
] as const;
```

목록은 migration 파일의 모든 `CREATE TABLE`과 일치해야 한다. 새 migration이 table을 추가하면 테스트가 manifest 갱신 없이 통과하지 못하게 한다.

- [ ] **Step 4: planner 구현**

```ts
export type UserDataResetPlan = Readonly<{
  databaseName: string;
  migrationNames: readonly string[];
  resetTables: readonly { name: string; rows: number }[];
  preservedTables: readonly { name: string; rows: number }[];
  manifestSha256: string;
  planSha256: string;
  preservedFingerprintSha256: string;
  totalResetRows: number;
}>;
```

planner는 `pg_class`, `pg_namespace`, `pgmigrations`와 table별 `count(*)`를 읽는다. identifier는 manifest 상수에서만 만들고 live DB 문자열을 SQL identifier로 보간하지 않는다. JSON에는 row 내용, 이메일, URL과 payload를 넣지 않는다.

- [ ] **Step 5: planner 단위 테스트 실행**

Run: `npm --prefix api test -- --runInBand user-data-reset.plan.spec.ts migration-files.spec.ts`

Expected: PASS.

- [ ] **Step 6: planner 커밋**

```bash
git add api/src/maintenance/user-data-reset.manifest.ts api/src/maintenance/user-data-reset.plan.ts api/src/maintenance/user-data-reset.plan.spec.ts
git commit -m "feat(ops): 사용자 데이터 초기화 manifest 추가"
```

---

### Task 2: plan과 execute가 분리된 reset CLI

**Files:**
- Create: `api/scripts/user-data-reset.ts`
- Create: `api/scripts/user-data-reset.spec.ts`
- Create: `api/test/user-data-reset.e2e-spec.ts`
- Modify: `api/package.json`

**Interfaces:**
- Consumes: `DATABASE_URL`, `USER_DATA_RESET_BACKUP_PROOF`, `--plan`, `--execute`, `--run-id`, `--manifest-sha256`, `--plan-sha256`
- Produces: JSON plan, transaction reset result, post-reset zero count evidence

- [ ] **Step 1: 안전 gate 실패 테스트 작성**

```ts
expect(() => parseResetOptions([])).toEqual({ mode: 'plan' });
expect(() => parseResetOptions(['--execute'])).toThrow('RESET_RUN_ID_REQUIRED');
expect(() => parseResetOptions([
  '--execute',
  '--run-id', 'reset-20260831T120000Z',
  '--manifest-sha256', 'wrong',
])).toThrow('RESET_BACKUP_PROOF_REQUIRED');
```

- [ ] **Step 2: CLI 테스트 실패 확인**

Run: `npm --prefix api test -- --runInBand user-data-reset.spec.ts`

Expected: FAIL because the CLI does not exist.

- [ ] **Step 3: CLI parser와 backup proof 검증 구현**

backup proof JSON은 root-owned 운영 스크립트가 만들며 다음 shape를 사용한다.

```ts
type VerifiedResetBackupProof = {
  schemaVersion: 'studytube.user-data-reset-backup.v1';
  runId: string;
  databaseName: string;
  manifestSha256: string;
  planSha256: string;
  dumpSha256: string;
  s3Bucket: string;
  s3ObjectKey: string;
  createdAt: string;
  deleteAfter: string;
  restoreVerified: true;
};
```

실행 mode는 proof의 run id, DB 이름, manifest hash, 승인된 계획 hash, checksum 형식, restore flag와 7일 delete time을 검사한다.

- [ ] **Step 4: transaction reset 구현**

```ts
await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
await client.query("SET LOCAL lock_timeout = '5s'");
await client.query("SET LOCAL statement_timeout = '120s'");
await client.query(explicitTruncateSql(RESET_APPLICATION_TABLES));
const verification = await buildUserDataResetPlan(client);
if (verification.totalResetRows !== 0) throw new Error('RESET_NOT_EMPTY');
await client.query('COMMIT');
```

`explicitTruncateSql`은 manifest의 모든 reset table을 한 `TRUNCATE table1, table2 RESTART IDENTITY`에 포함하고 `CASCADE`를 붙이지 않는다. preserved table count와 row fingerprint를 transaction 전후에 비교한다.

- [ ] **Step 5: 실제 PostgreSQL E2E 작성**

`api/test/user-data-reset.e2e-spec.ts`는 별도 test database에 각 reset table의 최소 유효 row를 넣고 preserved table snapshot을 잡는다. plan mode가 무변경인지, 잘못된 proof가 거부되는지, execute 뒤 reset table이 모두 0이고 preserved rows가 같은지 검증한다.

```ts
expect(after.totalResetRows).toBe(0);
expect(after.preservedTables).toEqual(before.preservedTables);
expect(await invalidForeignKeyCount(pool)).toBe(0);
```

- [ ] **Step 6: package command 추가**

```json
"db:user-data-reset": "ts-node scripts/user-data-reset.ts"
```

- [ ] **Step 7: 단위와 E2E 실행**

Run: `npm --prefix api test -- --runInBand user-data-reset.spec.ts user-data-reset.plan.spec.ts`

Run with isolated PostgreSQL: `npm --prefix api run test:e2e -- --runInBand user-data-reset.e2e-spec.ts`

Expected: PASS.

- [ ] **Step 8: reset engine 커밋**

```bash
git add api/package.json api/scripts/user-data-reset.ts api/scripts/user-data-reset.spec.ts api/test/user-data-reset.e2e-spec.ts
git commit -m "feat(ops): 검증형 사용자 데이터 초기화 CLI 추가"
```

---

### Task 3: 7일 보관 PostgreSQL 백업과 실제 restore drill

**Files:**
- Create: `scripts/user-data-reset-backup.sh`
- Create: `scripts/tests/user-data-reset-backup-contract.sh`
- Modify: `operations/README.md`

**Interfaces:**
- Consumes: production Compose PostgreSQL, `AWS_USER_RESET_BACKUP_BUCKET`, `AWS_REGION`, plan JSON
- Produces: private encrypted S3 object and `VerifiedResetBackupProof`

- [ ] **Step 1: shell 계약 실패 테스트 작성**

계약 테스트는 fixture 명령으로 다음을 확인한다.

```bash
grep -Fq -- '--format=custom' "$backup_script"
grep -Fq -- '--server-side-encryption AES256' "$backup_script"
grep -Fq -- 'pg_restore' "$backup_script"
grep -Fq -- 'get-object-lock-configuration' "$backup_script"
grep -Fq -- 'get-bucket-versioning' "$backup_script"
grep -Fq -- 'restoreVerified' "$backup_script"
```

fixture에서 restore failure를 반환하면 S3 upload와 proof 작성이 실행되지 않아야 한다.

- [ ] **Step 2: shell 테스트 실패 확인**

Run: `bash scripts/tests/user-data-reset-backup-contract.sh`

Expected: FAIL because the backup script does not exist.

- [ ] **Step 3: S3 retention preflight 구현**

스크립트는 bucket public access block, default encryption, versioning, object lock과 lifecycle을 읽는다. 7일보다 긴 object lock이 적용되거나 current와 noncurrent version을 모두 7일 안에 지울 수 없으면 `BACKUP_RETENTION_INCOMPATIBLE`로 중단한다. bucket policy나 lifecycle을 자동 수정하지 않는다.

- [ ] **Step 4: dump와 restore 구현**

순서는 다음으로 고정한다.

```bash
docker compose -f infra/production.compose.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --format=custom --no-owner --no-privileges --serializable-deferrable \
  --file "$container_dump"

docker compose -f infra/production.compose.yml exec -T postgres \
  createdb -U "$POSTGRES_USER" --template=template0 "$restore_database"

docker compose -f infra/production.compose.yml exec -T postgres \
  pg_restore -U "$POSTGRES_USER" --dbname "$restore_database" \
  --exit-on-error --no-owner --no-privileges "$container_dump"
```

source와 restore DB에서 모든 public table의 row count, migration ids, invalid FK와 orphan checks를 비교한다. 성공 뒤에만 dump를 host root-only temp로 복사하고 SHA-256을 계산해 S3에 AES256 암호화로 업로드한다.

- [ ] **Step 5: proof 원자적 작성과 cleanup 구현**

proof는 `/var/lib/studytube/user-data-reset/${RESET_RUN_ID}/verified-backup.json`에 mode `0600`, root owner로 temp file rename을 사용해 쓴다. 임시 restore DB와 local dump는 성공과 실패 모두 정리한다. S3 object를 올린 뒤 proof 작성이 실패하면 object도 제거한다.

- [ ] **Step 6: shell 계약과 plan-only 실행**

Run: `bash scripts/tests/user-data-reset-backup-contract.sh`

Run: `bash scripts/user-data-reset-backup.sh --plan`

Expected: PASS and plan JSON only, without dump or upload.

- [ ] **Step 7: backup 도구 커밋**

```bash
git add scripts/user-data-reset-backup.sh scripts/tests/user-data-reset-backup-contract.sh operations/README.md
git commit -m "feat(ops): 7일 복원 검증 백업 추가"
```

---

### Task 4: 쓰기 중단, DB reset과 Valkey 초기화를 조정하는 운영 스크립트

**Files:**
- Create: `scripts/user-data-reset-run.sh`
- Create: `scripts/tests/user-data-reset-run-contract.sh`
- Modify: `scripts/install-production-runtime.sh`
- Modify: `scripts/tests/runtime-isolation-contract.sh`

**Interfaces:**
- Consumes: backup proof, `api/dist/scripts/user-data-reset.js`, systemd units, dedicated Valkey
- Produces: `plan`, `execute`, `verify`, `purge-backup` 운영 명령

- [ ] **Step 1: 조정 순서 실패 테스트 작성**

fixture command log에서 다음 순서를 검사한다.

```text
stop studytube-worker
stop studytube-api
backup and restore verified
database reset committed
valkey FLUSHDB
start studytube-api
start studytube-worker
live verification
```

DB reset 실패와 Valkey flush 실패에서는 API와 worker를 다시 열지 않고 marker를 남기는지 확인한다.

- [ ] **Step 2: shell 테스트 실패 확인**

Run: `bash scripts/tests/user-data-reset-run-contract.sh`

Expected: FAIL because the run script does not exist.

- [ ] **Step 3: plan mode 구현**

`plan`은 어떤 systemd service도 변경하지 않고 compiled reset CLI의 JSON, Valkey DB size, unit 상태, database name과 backup bucket compatibility를 출력한다. secret, URL payload와 사용자 row는 출력하지 않는다.

- [ ] **Step 4: execute mode hard gate 구현**

다음 값이 모두 일치해야 한다.

```text
--run-id
--manifest-sha256
--plan-sha256
--approval "RESET:${RESET_RUN_ID}:${RESET_MANIFEST_SHA256}:${RESET_PLAN_SHA256}"
verified-backup.json
AUTH_MODE=google_only
```

스크립트는 `/run/studytube/user-data-reset-active`를 root-only로 만들고 worker, API 순서로 중단한다. backup script 성공 후 reset CLI를 실행한다. DB commit 확인 뒤 전용 Valkey instance인지 container name과 compose project를 확인하고 `valkey-cli FLUSHDB`를 실행한다.

- [ ] **Step 5: verify와 service resume 구현**

verify는 reset table 0건, preserved table 동일, Valkey DB size 0, API `/health/live`, Google auth start 302를 확인한다. 모두 통과해야 marker를 지우고 API, worker를 시작한다. 실패하면 marker와 중단 상태를 유지한다.

- [ ] **Step 6: runtime secret allowlist 추가**

```text
AWS_USER_RESET_BACKUP_BUCKET
USER_DATA_RESET_BACKUP_PREFIX
```

bucket 이름은 config snapshot으로 전달하되 backup object key와 checksum은 proof 파일에서만 읽는다.

- [ ] **Step 7: shell과 runtime 계약 실행**

Run: `bash scripts/tests/user-data-reset-run-contract.sh`

Run: `bash scripts/tests/runtime-isolation-contract.sh`

Expected: PASS.

- [ ] **Step 8: 운영 조정 커밋**

```bash
git add scripts/user-data-reset-run.sh scripts/tests/user-data-reset-run-contract.sh scripts/install-production-runtime.sh scripts/tests/runtime-isolation-contract.sh
git commit -m "feat(ops): 사용자 데이터 초기화 실행 조정"
```

---

### Task 5: 로컬 전체 복구 리허설

**Files:**
- Modify only when the rehearsal finds a defect in Tasks 1 through 4
- Create: `operations/fixtures/user-data-reset.compose.yml`
- Create: `docs/evidence/operations/user-data-reset-rehearsal.json`

**Interfaces:**
- Consumes: isolated PostgreSQL `55432`, isolated Valkey `56379`, reset scripts
- Produces: non-sensitive rehearsal evidence with fingerprints and timings

- [ ] **Step 1: isolated services 시작**

`operations/fixtures/user-data-reset.compose.yml`은 PostgreSQL을 `127.0.0.1:55432`, Valkey를 `127.0.0.1:56379`에만 노출하고 project-scoped volume을 사용한다.

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: app_reset_test
    ports: ["127.0.0.1:55432:5432"]
  valkey:
    image: valkey/valkey:9.1.1-alpine
    command: ["valkey-server", "--appendonly", "yes"]
    ports: ["127.0.0.1:56379:6379"]
```

Run: `docker compose -p studytube-reset-rehearsal -f operations/fixtures/user-data-reset.compose.yml up -d --wait`

- [ ] **Step 2: schema와 representative data 준비**

Run with the isolated `DATABASE_URL`: `npm --prefix api run db:migrate:up`

Run: `npm --prefix api run test:e2e -- --runInBand user-data-reset.e2e-spec.ts`

Expected: PASS and non-zero reset row count before execution.

- [ ] **Step 3: plan, backup, restore와 reset 리허설**

Run the backup and run scripts against the isolated Compose project with a filesystem-backed fake S3 adapter from the shell contract test. Verify that the retained dump restores into a second temporary DB and that reset leaves preserved rows unchanged.

- [ ] **Step 4: evidence 기록**

Evidence JSON에는 run id, manifest hash, dump hash, table count fingerprints, restore status, post-reset total rows, FK count, start and completion timestamps만 기록한다. 이메일, URL, row payload와 credential은 기록하지 않는다.

- [ ] **Step 5: isolated resources 정리**

Run: `docker compose -p studytube-reset-rehearsal -f operations/fixtures/user-data-reset.compose.yml down --volumes`

Verify only the explicitly named `studytube-reset-rehearsal` project was removed.

- [ ] **Step 6: rehearsal evidence 커밋**

```bash
git add operations/fixtures/user-data-reset.compose.yml docs/evidence/operations/user-data-reset-rehearsal.json
git commit -m "test(ops): 사용자 데이터 초기화 복구 리허설"
```

---

### Task 6: production read-only inventory와 최종 삭제 승인 gate

**Files:**
- No repository mutation

**Interfaces:**
- Consumes: deployed reset tooling and authenticated AWS SSM session
- Produces: exact production target report and explicit approval request

- [ ] **Step 1: 배포 SHA와 AWS identity 확인**

Read only: verify GitHub main SHA, deployed SHA, AWS account, region `ap-northeast-2` and exact SSM instance id. If AWS credentials or SSM access are unavailable, stop without starting backup or reset.

- [ ] **Step 2: production plan mode 실행**

Through SSM, run `scripts/user-data-reset-run.sh plan`. Capture only:

- AWS account and instance id
- database name
- deployed SHA and migration ids
- reset table names and row counts
- preserved table names and row counts
- manifest SHA-256
- Valkey key count
- backup bucket and 7-day retention compatibility

- [ ] **Step 3: unknown table와 retention 확인**

Expected: unknown table count 0, backup retention compatible, no service state changed. Any mismatch returns No-Go and must be fixed before another inventory.

- [ ] **Step 4: 사용자에게 exact target 제시하고 중단**

다음 형식으로 사용자에게 보여준다.

```text
운영 대상: AWS 계정, instance id, database
삭제 예정: table별 행 수와 총합
보존 예정: pgmigrations, learning_cutover_runs, learning_cutover_authority, stt_provider_approvals
백업 위치: run 전용 S3 object key
백업 폐기 예정: UTC timestamp
manifest: SHA-256
plan: SHA-256
승인 문자열: RESET:${RESET_RUN_ID}:${RESET_MANIFEST_SHA256}:${RESET_PLAN_SHA256}
```

이 단계에서는 backup, service stop, DB write와 Valkey flush를 실행하지 않는다. 사용자가 `운영 초기화 승인`과 plan output의 `runId` 값을 함께 답할 때까지 Task 7을 시작하지 않는다.

---

### Task 7: 승인된 production backup, reset과 Google 전용 재개

**Files:**
- No repository mutation unless execution exposes a code defect

**Interfaces:**
- Consumes: Task 6의 exact run id와 사용자 승인
- Produces: empty user data state, verified S3 backup, resumed Google-only service

- [ ] **Step 1: 승인과 plan drift 재확인**

승인 run id가 Task 6과 같고 새 plan의 manifest hash와 row counts가 승인 내용과 같은지 확인한다. drift가 있으면 실행하지 않고 Task 6으로 돌아간다.

- [ ] **Step 2: backup과 restore 검증 실행**

SSM으로 `scripts/user-data-reset-backup.sh --execute`를 실행한다. proof의 dump hash, restore status, deleteAfter와 S3 head object encryption을 확인한다.

- [ ] **Step 3: reset coordinator 실행**

Task 6에서 표시한 exact approval 값을 전달해 `scripts/user-data-reset-run.sh execute`를 실행한다. 명령은 변경하지 않고 SSM output에서 상태 전이만 확인한다.

- [ ] **Step 4: server-side postcondition 확인**

Expected:

```text
reset_total_rows=0
preserved_fingerprint_unchanged=true
invalid_foreign_keys=0
valkey_dbsize=0
auth_mode=google_only
api_live=ok
```

- [ ] **Step 5: 실제 브라우저 smoke test**

로그인 화면에 Google 버튼 하나만 있는지, 새 Google 계정 생성과 재로그인이 되는지, 기존 이메일 경로가 404인지 확인한다. URL 입력과 학습 화면 진입까지 검증한다.

- [ ] **Step 6: 결과 보고**

삭제된 table count와 합계, backup hash, 폐기 예정 시각, live verification 결과를 보고한다. 사용자 식별 정보와 backup object 내용은 보고하지 않는다.

---

### Task 8: 7일 백업 폐기와 최종 확인

**Files:**
- No repository mutation

**Interfaces:**
- Consumes: backup proof의 `deleteAfter`
- Produces: current version, noncurrent version와 delete marker가 없는 S3 verification

- [ ] **Step 1: deleteAfter 전 접근 차단 유지 확인**

Bucket public access block과 object encryption을 확인한다. backup을 다운로드하거나 내용 검사하지 않는다.

- [ ] **Step 2: 7일 시점에 모든 version 폐기**

Lifecycle이 current와 noncurrent version을 지웠는지 확인한다. 남은 version이나 delete marker가 있으면 proof의 exact key에 한해 삭제한다. prefix 전체나 bucket 전체 삭제는 금지한다.

- [ ] **Step 3: 폐기 검증**

`head-object`, `list-object-versions`와 replication 대상 조회에서 exact key가 모두 없어야 한다. bucket과 다른 release artifact는 그대로 있어야 한다.

- [ ] **Step 4: 최종 상태 보고**

backup object key의 hash, 폐기 완료 시각과 확인한 저장 위치만 보고한다. 복구 가능 기간이 끝났음을 명확히 알린다.
