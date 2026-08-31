# StudyTube Google 재확인 회원 탈퇴 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 같은 Google 계정으로 다시 확인한 뒤 자신의 계정, 학습 데이터, 파생 작업과 모든 세션을 즉시 영구 삭제할 수 있게 한다.

**Architecture:** 모든 새 사용자 작업 event에 `owner_id`를 기록해 사용자 삭제가 durable work graph까지 닿게 한다. Google 재확인은 기존 일회성 attempt를 `delete_account` 목적으로 사용하고 현재 session에 5분짜리 삭제 권한을 기록한다. Account erasure transaction은 사용자 소유 graph를 삭제하고 마지막 참조가 사라진 영상과 자막 자료만 정리한다.

**Tech Stack:** Node.js 24.8 이상, NestJS 11, PostgreSQL 16, React 19, TypeScript, Jest, Node test runner

**Spec:** `docs/superpowers/specs/2026-08-31-google-only-auth-reset-design.md`

## Global Constraints

- `2026-08-31-google-only-auth.md`가 먼저 완료되어 `google_subject`와 `google_auth_attempts`가 존재해야 한다.
- 사용자 데이터 초기화 전에 코드를 배포할 수 있지만 회원 탈퇴 실제 smoke test는 `2026-08-31-user-data-reset.md` Task 7 뒤에 한다.
- 탈퇴 재확인은 현재 회원과 같은 Google `sub`만 허용한다.
- 재확인 권한은 한 session에만 적용하고 5분 뒤 만료한다.
- Google access token과 refresh token은 저장하지 않는다.
- 탈퇴는 즉시 영구 삭제이며 복구 기간을 제공하지 않는다.
- 다른 사용자가 참조하는 공용 영상과 자막은 보존한다.
- 마지막 참조가 사라진 공용 영상과 자막만 제거한다.
- 탈퇴 성공 뒤 현재 기기와 다른 모든 기기의 session을 무효화한다.
- 로그와 응답에 이메일, Google `sub`, 삭제된 row id와 원본 payload를 남기지 않는다.
- `artifacts/`와 `design-qa.md`는 수정, 이동, 삭제하거나 커밋하지 않는다.

---

### Task 1: 사용자 소유 work event를 끝까지 추적하는 스키마

**Files:**
- Create: `api/migrations/1753660822000_user-owned-work-events.cjs`
- Modify: `api/src/migration-files.spec.ts`
- Modify: `api/src/work/work.types.ts`
- Modify: `api/src/work/work.repository.ts`
- Modify: `api/src/work/postgres-work.repository.ts`
- Modify: `api/src/work/postgres-work.repository.spec.ts`

**Interfaces:**
- Consumes: `work_outbox_events`, job result, claim, dead letter와 replay audit 관계
- Produces: nullable `work_outbox_events.owner_id`와 user-owned event cascade graph

- [ ] **Step 1: owner와 cascade migration 실패 테스트 작성**

```ts
expect(migration).toContain(
  'ADD COLUMN owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE',
);
expect(migration).toContain('work_job_results_event_id_fkey');
expect(migration).toContain('ON DELETE CASCADE');
expect(migration).toContain('work_job_claims_event_id_fkey');
expect(migration).toContain('work_dead_letters_event_id_fkey');
expect(migration).toContain('work_replay_audits_actor_id_fkey');
```

- [ ] **Step 2: migration 계약 실패 확인**

Run: `npm --prefix api test -- --runInBand migration-files.spec.ts`

Expected: FAIL because the migration does not exist.

- [ ] **Step 3: owner column과 dependent cascade migration 작성**

```sql
ALTER TABLE work_outbox_events
  ADD COLUMN owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX work_outbox_events_owner_idx
  ON work_outbox_events (owner_id, occurred_at, id)
  WHERE owner_id IS NOT NULL;
```

다음 기존 FK를 같은 column 조합의 `ON DELETE CASCADE`로 교체한다.

- `work_job_results.event_id`
- `work_job_claims.event_id`
- `work_dead_letters.event_id`
- `work_replay_audits.dead_letter_id`
- `work_replay_audits.replay_event_id`
- `work_replay_audits.actor_id`

기존 event는 전체 초기화 대상으로 남으므로 억지로 owner를 추정해 backfill하지 않는다. 새 event만 owner 계약을 따른다.

- [ ] **Step 4: WorkEvent 계약에 owner 추가**

```ts
export type WorkOutboxEvent = {
  id: string;
  ownerId: number | null;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  payloadSchemaVersion: number;
  payload: Readonly<Record<string, unknown>>;
  traceContext?: Readonly<Record<string, unknown>>;
};
```

`appendOutboxEvent` SQL은 `owner_id`를 항상 명시한다. system event만 `null`을 전달할 수 있다.

- [ ] **Step 5: repository 단위 테스트 실행**

Run: `npm --prefix api test -- --runInBand postgres-work.repository.spec.ts migration-files.spec.ts`

Expected: PASS.

- [ ] **Step 6: work ownership 커밋**

```bash
git add api/migrations/1753660822000_user-owned-work-events.cjs api/src/migration-files.spec.ts api/src/work/work.types.ts api/src/work/work.repository.ts api/src/work/postgres-work.repository.ts api/src/work/postgres-work.repository.spec.ts
git commit -m "feat(work): 사용자 소유 작업 추적"
```

---

### Task 2: 모든 사용자 요청 event producer에 owner 연결

**Files:**
- Modify: `api/src/database.service.ts`
- Modify: `api/src/database.service.spec.ts`
- Modify: `api/src/course/postgres-course.repository.ts`
- Create: `api/src/course/postgres-course.repository.spec.ts`
- Modify: `api/src/postgres-live-caption.repository.ts`
- Modify: `api/src/postgres-live-caption.repository.spec.ts`
- Modify: `api/src/learning/postgres-agent-run.repository.ts`
- Create: `api/src/learning/postgres-agent-run.repository.spec.ts`
- Modify: `api/src/learning/postgres-learning-overview.repository.ts`
- Create: `api/src/learning/postgres-learning-overview.repository.spec.ts`
- Modify: `api/src/learning/postgres-learning-proposal.repository.ts`
- Create: `api/src/learning/postgres-learning-proposal.repository.spec.ts`
- Modify: `api/src/learning/postgres-provider-budget.repository.ts`
- Modify: `api/src/learning/postgres-provider-budget.repository.spec.ts`
- Modify: `api/src/learning/postgres-quiz.repository.ts`
- Create: `api/src/learning/postgres-quiz.repository.spec.ts`
- Modify: `api/src/work/video-asset.worker.ts`
- Modify: `api/src/work/video-asset.worker.spec.ts`

**Interfaces:**
- Consumes: Task 1의 `ownerId: number | null`
- Produces: every user-derived event with the initiating owner id

- [ ] **Step 1: 각 producer의 failing owner assertion 작성**

각 repository spec에서 outbox insert parameter 또는 event object가 다음을 만족하는지 확인한다.

```ts
expect(enqueued).toMatchObject({ ownerId: 42 });
expect(sql).toContain('owner_id');
```

worker가 앞선 event에서 새 event를 만들 때는 `job.ownerId`를 그대로 전달하는지 검사한다.

- [ ] **Step 2: focused producer 테스트 실패 확인**

Run: `npm --prefix api test -- --runInBand database.service.spec.ts postgres-course.repository.spec.ts postgres-live-caption.repository.spec.ts postgres-agent-run.repository.spec.ts postgres-learning-overview.repository.spec.ts postgres-learning-proposal.repository.spec.ts postgres-provider-budget.repository.spec.ts postgres-quiz.repository.spec.ts video-asset.worker.spec.ts`

Expected: FAIL where owner is not persisted or propagated.

- [ ] **Step 3: request boundary에서 owner 전달**

다음 event 계열은 인증된 user id를 사용한다.

- `video_asset.requested`
- `learning_intake.requested`
- `retrieval_embedding.requested` for post, course step and study context
- `learning_summary.requested`
- `quiz_generation.requested`
- recommendation and learning proposal event

system maintenance와 non-user replay event는 원본 event owner가 있으면 이어받고 진짜 system event만 `null`을 사용한다.

- [ ] **Step 4: 모든 INSERT가 owner_id를 명시하는 정적 계약 추가**

`api/src/work/user-owned-event-boundary.spec.ts`를 만들고 production TypeScript의 `INSERT INTO work_outbox_events`와 `appendOutboxEvent` 호출을 검사한다. raw SQL insert가 `owner_id`를 생략하면 실패한다.

- [ ] **Step 5: focused와 전체 API 단위 테스트 실행**

Run: `npm --prefix api test -- --runInBand user-owned-event-boundary.spec.ts database.service.spec.ts postgres-work.repository.spec.ts video-asset.worker.spec.ts`

Run: `npm --prefix api test -- --runInBand`

Expected: PASS.

- [ ] **Step 6: producer ownership 커밋**

```bash
git add api/src/database.service.ts api/src/database.service.spec.ts api/src/course/postgres-course.repository.ts api/src/course/postgres-course.repository.spec.ts api/src/postgres-live-caption.repository.ts api/src/postgres-live-caption.repository.spec.ts api/src/learning/postgres-agent-run.repository.ts api/src/learning/postgres-agent-run.repository.spec.ts api/src/learning/postgres-learning-overview.repository.ts api/src/learning/postgres-learning-overview.repository.spec.ts api/src/learning/postgres-learning-proposal.repository.ts api/src/learning/postgres-learning-proposal.repository.spec.ts api/src/learning/postgres-provider-budget.repository.ts api/src/learning/postgres-provider-budget.repository.spec.ts api/src/learning/postgres-quiz.repository.ts api/src/learning/postgres-quiz.repository.spec.ts api/src/work/video-asset.worker.ts api/src/work/video-asset.worker.spec.ts api/src/work/user-owned-event-boundary.spec.ts
git commit -m "feat(work): 사용자 작업에 소유자 연결"
```

---

### Task 3: session에 5분짜리 Google 재확인 기록

**Files:**
- Create: `api/migrations/1753660823000_google-account-deletion.cjs`
- Modify: `api/src/migration-files.spec.ts`
- Modify: `api/src/auth/auth.types.ts`
- Modify: `api/src/auth/auth.repository.ts`
- Modify: `api/src/database.service.ts`
- Modify: `api/src/auth/google/google-auth.service.ts`
- Modify: `api/src/auth/google/google-auth.service.spec.ts`

**Interfaces:**
- Consumes: `google_auth_attempts` purpose `delete_account`, current user and session id
- Produces: `sessions.google_reauthenticated_at`, `startAccountDeletion`, `completeAccountDeletion`

- [ ] **Step 1: reauth migration과 service 실패 테스트 작성**

```ts
expect(migration).toContain('ADD COLUMN google_reauthenticated_at TIMESTAMPTZ');

const started = await service.startAccountDeletion({
  userId: 7,
  sessionId: 'session-uuid',
});
expect(started.authorizationUrl).toContain('prompt=select_account');

await expect(service.completeAccountDeletion({ state, code })).resolves.toEqual({
  status: 'verified',
  returnPath: '/me/delete',
});
```

다른 `sub`, 삭제된 session, callback 재사용과 만료를 거부하는 테스트를 함께 작성한다.

- [ ] **Step 2: focused 테스트 실패 확인**

Run: `npm --prefix api test -- --runInBand migration-files.spec.ts google-auth.service.spec.ts`

Expected: FAIL because reauth storage and methods do not exist.

- [ ] **Step 3: session migration과 repository 계약 구현**

```ts
export type MarkGoogleReauthenticatedCommand = {
  userId: number;
  sessionId: string;
  googleSubject: string;
  reauthenticatedAt: Date;
};
```

repository는 session과 user를 같은 transaction에서 lock하고 current user의 `google_subject`가 callback identity와 같을 때만 `google_reauthenticated_at`을 기록한다.

- [ ] **Step 4: deletion-purpose Google service 구현**

`startAccountDeletion`은 user와 session에 bound된 10분 attempt를 만들고 Google URL에 `prompt=select_account`를 넣는다. `completeAccountDeletion`은 code와 ID token을 검증한 뒤 같은 `sub`일 때만 current session을 재확인 상태로 만든다. 새 session은 발급하지 않는다.

- [ ] **Step 5: migration과 service 테스트 실행**

Run: `npm --prefix api test -- --runInBand migration-files.spec.ts google-auth.service.spec.ts database.service.spec.ts`

Expected: PASS.

- [ ] **Step 6: reauth state 커밋**

```bash
git add api/migrations/1753660823000_google-account-deletion.cjs api/src/migration-files.spec.ts api/src/auth api/src/database.service.ts api/src/database.service.spec.ts
git commit -m "feat(account): Google 탈퇴 재확인 기록"
```

---

### Task 4: account erasure transaction과 공유 자료 보존

**Files:**
- Create: `api/src/account/account-erasure.types.ts`
- Create: `api/src/account/account-erasure.repository.ts`
- Create: `api/src/account/postgres-account-erasure.repository.ts`
- Create: `api/src/account/postgres-account-erasure.repository.spec.ts`
- Create: `api/src/account/account-erasure.service.ts`
- Create: `api/src/account/account-erasure.service.spec.ts`
- Create: `api/test/account-deletion.e2e-spec.ts`
- Modify: `api/src/app.module.ts`

**Interfaces:**
- Consumes: user id, current session id, `google_reauthenticated_at`
- Produces: `eraseAccount(command): Promise<'deleted' | 'reauth_required' | 'not_found'>`

- [ ] **Step 1: service authorization 실패 테스트 작성**

```ts
await expect(service.eraseAccount({ userId: 7, sessionId })).resolves.toEqual({
  status: 'reauth_required',
});
clock.set('2026-08-31T12:04:59Z');
await expect(service.eraseAccount({ userId: 7, sessionId })).resolves.toEqual({
  status: 'deleted',
});
```

정확히 5분이 지난 권한, 다른 session과 중복 delete를 각각 거부하거나 idempotent `not_found`로 처리한다.

- [ ] **Step 2: repository graph 실패 테스트 작성**

mock SQL client로 다음 순서를 확인한다.

```text
BEGIN
lock current session and user
capture candidate video_source ids
delete replay audits initiated by user
delete user
delete unreferenced provider work
clear orphan video source artifact pointers
delete orphan caption segments and states
delete orphan caption artifacts in index, translation, source order
delete orphan video sources
COMMIT
```

- [ ] **Step 3: service와 repository 테스트 실패 확인**

Run: `npm --prefix api test -- --runInBand account-erasure.service.spec.ts postgres-account-erasure.repository.spec.ts`

Expected: FAIL because account erasure modules do not exist.

- [ ] **Step 4: repository transaction 구현**

```ts
export interface AccountErasureRepository {
  erase(command: {
    userId: number;
    sessionId: string;
    reauthCutoff: Date;
  }): Promise<{ status: 'deleted' | 'reauth_required' | 'not_found' }>;
}
```

session row의 `google_reauthenticated_at >= reauthCutoff`를 lock 안에서 확인한다. candidate video source는 삭제 전 해당 사용자의 `learning_items`, 소유 course의 `course_steps`와 `legacy_learning_context_mappings`에서 수집한다. `DELETE FROM users`가 끝난 뒤 다른 `learning_items`, `course_steps`, `learning_proposals` 또는 active context가 참조하지 않는 candidate만 정리한다.

caption artifact는 `index`, `translation`, `transcription`, `youtube_caption` 순으로 삭제한다. `video_sources.current_source_caption_artifact_id`를 candidate에 한해 null로 만든 뒤 artifact와 video source를 삭제한다. 다른 사용자 참조가 하나라도 있으면 해당 source와 artifact를 건드리지 않는다.

- [ ] **Step 5: 실제 PostgreSQL data graph E2E 작성**

두 Google 사용자가 같은 video source를 참조하는 fixture를 만든다. 첫 사용자 탈퇴 뒤 다음을 검사한다.

```ts
expect(await userOwnedRowCount(firstUserId)).toBe(0);
expect(await activeSessionCount(firstUserId)).toBe(0);
expect(await ownedWorkEventCount(firstUserId)).toBe(0);
expect(await videoSourceExists(sharedVideoId)).toBe(true);
expect(await userOwnedRowCount(secondUserId)).toBeGreaterThan(0);
```

두 번째 사용자가 다른 전용 video source를 가진 fixture에서는 탈퇴 후 source와 caption artifacts가 함께 없어지는지 확인한다. FK invalid count와 dangling owner id도 0이어야 한다.

- [ ] **Step 6: 단위와 PostgreSQL E2E 실행**

Run: `npm --prefix api test -- --runInBand account-erasure.service.spec.ts postgres-account-erasure.repository.spec.ts`

Run with isolated PostgreSQL: `npm --prefix api run test:e2e -- --runInBand account-deletion.e2e-spec.ts`

Expected: PASS.

- [ ] **Step 7: erasure service 커밋**

```bash
git add api/src/account/account-erasure.types.ts api/src/account/account-erasure.repository.ts api/src/account/postgres-account-erasure.repository.ts api/src/account/postgres-account-erasure.repository.spec.ts api/src/account/account-erasure.service.ts api/src/account/account-erasure.service.spec.ts api/src/app.module.ts api/test/account-deletion.e2e-spec.ts
git commit -m "feat(account): 계정과 학습 데이터 영구 삭제"
```

---

### Task 5: 탈퇴 재확인과 삭제 HTTP API

**Files:**
- Create: `api/src/account/account-deletion.controller.ts`
- Create: `api/src/account/account-deletion.controller.spec.ts`
- Modify: `api/src/account/account-erasure.service.ts`
- Modify: `api/src/auth/google/google-auth.controller.ts`
- Modify: `api/src/auth/auth-cookie.ts`
- Modify: `api/test/account-deletion.e2e-spec.ts`

**Interfaces:**
- Consumes: current `AuthenticatedRequest`, Google reauth service, account erasure service
- Produces: `GET /me/deletion/google/start`, callback handling, `DELETE /me`

- [ ] **Step 1: controller 실패 테스트 작성**

```ts
await controller.deleteAccount(request, response);
expect(erasure.eraseAccount).toHaveBeenCalledWith({
  userId: request.principal.userId,
  sessionId: request.principal.sessionId,
});
expect(cookies.clearSessionCookie).toHaveBeenCalledWith(response);
```

reauth 없음은 `ACCOUNT_REAUTH_REQUIRED` 401, 만료는 401, 다른 Google 계정 callback은 `/me/delete?googleError=wrong_account`, 성공은 204인지 확인한다.

- [ ] **Step 2: controller 테스트 실패 확인**

Run: `npm --prefix api test -- --runInBand account-deletion.controller.spec.ts`

Expected: FAIL because the controller does not exist.

- [ ] **Step 3: 최소 controller 구현**

```ts
@Get('me/deletion/google/start')
startDeletionReauth(@Req() request: AuthenticatedRequest, @Res() response: Response) {}

@Delete('me')
@HttpCode(HttpStatus.NO_CONTENT)
deleteAccount(
  @Req() request: AuthenticatedRequest,
  @Res({ passthrough: true }) response: Response,
): Promise<void> {}
```

Google callback은 attempt purpose에 따라 login completion 또는 deletion completion으로 나눈다. 삭제 성공과 실패 response body에는 user id, email과 `sub`를 넣지 않는다.

- [ ] **Step 4: cookie와 HTTP E2E 강화**

`api/test/account-deletion.e2e-spec.ts`에서 Origin 없는 DELETE, JSON content type 없는 DELETE, 다른 session, 만료 reauth와 중복 요청을 검사한다. 성공 response의 session cookie는 `Max-Age=0`이어야 하고 기존 session으로 `/me`가 401이어야 한다.

- [ ] **Step 5: controller와 E2E 실행**

Run: `npm --prefix api test -- --runInBand account-deletion.controller.spec.ts auth-cookie.spec.ts origin.guard.spec.ts`

Run with isolated PostgreSQL: `npm --prefix api run test:e2e -- --runInBand account-deletion.e2e-spec.ts`

Expected: PASS.

- [ ] **Step 6: account API 커밋**

```bash
git add api/src/account/account-deletion.controller.ts api/src/account/account-deletion.controller.spec.ts api/src/account/account-erasure.service.ts api/src/auth/google/google-auth.controller.ts api/src/auth/auth-cookie.ts api/test/account-deletion.e2e-spec.ts
git commit -m "feat(account): Google 재확인 탈퇴 API 추가"
```

---

### Task 6: 최소한의 회원 탈퇴 Web UI와 브라우저 저장소 삭제

**Files:**
- Create: `web/src/features/account/AccountDeletionPage.tsx`
- Create: `web/src/features/account/AccountDeletionPage.css`
- Modify: `web/src/features/account/MyPage.tsx`
- Modify: `web/src/app/AppRoutes.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/api.ts`
- Modify: `web/src/studyStorageReset.ts`
- Create: `web/tests/accountDeletion.test.ts`
- Modify: `web/tests/accountPagesBoundary.test.ts`
- Modify: `web/tests/studyStorageReset.test.ts`

**Interfaces:**
- Consumes: `/me/deletion/google/start`, `DELETE /me`, `clearStudyTubeStorage`
- Produces: `/me/delete` confirmation page and `onAccountDeleted()` session reset

- [ ] **Step 1: UI와 storage 실패 테스트 작성**

```ts
assert.match(pageSource, /Google로 본인 확인/);
assert.match(pageSource, /계정과 학습 기록 삭제/);
assert.match(pageSource, /복구할 수 없어요/);
assert.doesNotMatch(pageSource, /OAuth|토큰|파이프라인|공급자/);
assert.match(pageSource, /aria-live="polite"/);
```

storage test는 성공 뒤 localStorage와 sessionStorage의 모든 `studytube.`와 `studytube:` key가 없어지고 다른 앱 key는 유지되는지 확인한다.

- [ ] **Step 2: Web 테스트 실패 확인**

Run: `node --test web/tests/accountDeletion.test.ts web/tests/accountPagesBoundary.test.ts web/tests/studyStorageReset.test.ts`

Expected: FAIL because the page and API functions do not exist.

- [ ] **Step 3: API URL과 delete 함수 구현**

```ts
export function accountDeletionReauthUrl() {
  return `${apiBaseUrl()}/me/deletion/google/start`;
}

export function deleteMe() {
  return requestJson<void>('/me', { method: 'DELETE' });
}
```

- [ ] **Step 4: 한 화면 confirmation 구현**

화면에는 제목, 삭제 항목 한 문장, 복구 불가 확인 checkbox, `Google로 본인 확인`, `계정과 학습 기록 삭제`, `취소`만 둔다. Google 재확인 전에는 삭제 버튼을 비활성화한다. 삭제 요청 중에는 모든 action을 잠그고 두 번째 요청을 보내지 않는다.

```tsx
<button type="button" disabled={!verified || !confirmed || deleting}>
  계정과 학습 기록 삭제
</button>
```

- [ ] **Step 5: 성공 후 session과 storage 정리**

`deleteMe()`가 204를 반환하면 `clearStudyTubeStorage(window.localStorage)`와 sessionStorage 정리를 실행하고 App session을 null로 만든다. `/login?accountDeleted=1`로 replace 이동해 성공 문구를 한 번만 표시한다.

- [ ] **Step 6: 접근성 및 responsive CSS 작성**

버튼 touch target은 44px 이상, focus-visible outline은 주요 파란색, 위험 버튼은 어두운 면 위에서 4.5:1 이상 대비를 확보한다. 360px에서는 버튼을 세로로 배치하고 가로 넘침을 만들지 않는다.

- [ ] **Step 7: Web 전체 검증**

Run: `node --test web/tests/*.test.ts`

Run: `npm --prefix web run build`

Run: `npm --prefix web run lint`

Expected: PASS.

- [ ] **Step 8: 탈퇴 UI 커밋**

```bash
git add web/src/features/account/AccountDeletionPage.tsx web/src/features/account/AccountDeletionPage.css web/src/features/account/MyPage.tsx web/src/app/AppRoutes.tsx web/src/App.tsx web/src/api.ts web/src/studyStorageReset.ts web/tests/accountDeletion.test.ts web/tests/accountPagesBoundary.test.ts web/tests/studyStorageReset.test.ts
git commit -m "feat(account): Google 재확인 회원 탈퇴 화면 추가"
```

---

### Task 7: 전체 삭제 계약과 라이브 검증

**Files:**
- Modify only when verification finds a defect in Tasks 1 through 6

**Interfaces:**
- Consumes: completed Google auth, account deletion and production reset
- Produces: verified immediate deletion for a disposable Google test account

- [ ] **Step 1: 전체 API 단위 테스트 실행**

Run: `npm --prefix api test -- --runInBand`

Expected: PASS.

- [ ] **Step 2: 전체 PostgreSQL E2E 실행**

Run with isolated PostgreSQL and Valkey: `npm --prefix api run test:e2e -- --runInBand`

Expected: PASS, including shared source preservation and owned work deletion.

- [ ] **Step 3: Web 전체 gate 실행**

Run: `node --test web/tests/*.test.ts`

Run: `npm --prefix web run build`

Run: `npm --prefix web run lint`

Expected: PASS.

- [ ] **Step 4: disposable production account로 실제 흐름 확인**

전체 초기화가 끝난 뒤 새 Google test account로 가입한다. 학습 항목, 메모, 퀴즈와 코스를 하나씩 만든다. 회원 탈퇴에서 다른 Google 계정을 골랐을 때 차단되는지 확인한 다음 같은 계정으로 재확인해 삭제한다.

- [ ] **Step 5: production postcondition 확인**

Read-only query로 test account의 user, sessions, courses, learning items, notes, quiz attempts, owned work events가 모두 0인지 확인한다. shared source fixture는 남고 test account 전용 source는 제거되어야 한다. 이메일과 `sub`는 결과 보고에 포함하지 않는다.

- [ ] **Step 6: 실제 브라우저 상태 확인**

탈퇴 직후 로그인 화면으로 이동하고 성공 문구가 한 번만 보이는지, 뒤로 가기로 보호 화면에 들어갈 수 없는지, localStorage와 sessionStorage에 StudyTube user key가 없는지 확인한다.

- [ ] **Step 7: diff와 secret 누출 검사**

Run: `git diff --check origin/main...HEAD`

Run: `rg -n "google_subject|email" api/src/account api/src/auth/google -g '*.ts'`

검사 결과에서 로그 statement와 response DTO에 식별 정보가 포함되지 않았음을 확인한다.

- [ ] **Step 8: 검증 보완 커밋**

검증에서 수정이 있었다면 해당 Task가 소유한 파일만 stage하고 다음 메시지로 커밋한다.

```bash
git commit -m "fix(account): 회원 탈퇴 전체 삭제 계약 보완"
```

수정이 없으면 빈 커밋을 만들지 않는다.
