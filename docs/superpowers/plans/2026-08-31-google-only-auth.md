# StudyTube Google 전용 인증 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이메일 가입과 비밀번호 로그인을 제거하고 Google 계정만으로 신규 가입, 로그인과 안전한 세션 복귀를 제공한다.

**Architecture:** NestJS가 Google Authorization Code 흐름과 PKCE를 소유하고 기존 불투명 HttpOnly 세션 쿠키를 발급한다. Google `sub`만 계정 식별자로 사용하며 Web은 Google 이동, 콜백 완료와 한국어 상태 표시만 담당한다. 데이터 초기화와 회원 탈퇴 실행은 별도 계획에서 다룬다.

**Tech Stack:** Node.js 24.8 이상, NestJS 11, PostgreSQL 16, `google-auth-library` 11.0.2, React 19, TypeScript 6, Jest 30, Node test runner

**Spec:** `docs/superpowers/specs/2026-08-31-google-only-auth-reset-design.md`

## Global Constraints

- 공개 로그인 수단은 `Google로 계속하기` 하나뿐이다.
- 계정 식별자는 Google ID 토큰의 `sub`이며 이메일로 계정을 연결하지 않는다.
- Google scope는 `openid email profile`만 사용한다.
- Google access token, refresh token, authorization code와 ID token을 저장하거나 기록하지 않는다.
- 기존 `AuthCookiePolicy`의 production `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/` 정책을 유지한다.
- 운영 callback은 `https://studytube.page/api/auth/google/callback`이다.
- 사용자 오류 문구에는 OAuth, 토큰, state, nonce와 공급자 내부 오류를 쓰지 않는다.
- 기존 `artifacts/`와 `design-qa.md`는 수정, 이동, 삭제하거나 커밋하지 않는다.
- 이 계획에서는 운영 사용자 데이터를 삭제하지 않는다.

---

### Task 1: Google 사용자와 일회성 인증 시도 스키마 확장

**Files:**
- Create: `api/migrations/1753660821000_google-auth-expand.cjs`
- Modify: `api/src/migration-files.spec.ts`
- Modify: `api/test/auth.e2e-spec.ts`

**Interfaces:**
- Consumes: 현재 `users`, `sessions`, `auth_rate_limits` 스키마
- Produces: `users.google_subject`, `users.profile_image_url`, `users.last_login_at`, `google_auth_attempts`

- [ ] **Step 1: 마이그레이션 계약의 실패 테스트 작성**

`api/src/migration-files.spec.ts`에 다음 계약을 추가한다.

```ts
it('expands authentication for Google-only users without linking by email', () => {
  const migration = readMigration('1753660821000_google-auth-expand.cjs');
  expect(migration).toContain('ADD COLUMN google_subject TEXT');
  expect(migration).toContain('UNIQUE (google_subject)');
  expect(migration).toContain('CREATE TABLE google_auth_attempts');
  expect(migration).toContain("purpose IN ('login', 'delete_account')");
  expect(migration).toContain('DROP CONSTRAINT users_email_canonical_key');
  expect(migration).toContain('DROP CONSTRAINT users_email_key');
  expect(migration).toContain('ALTER COLUMN password_hash DROP NOT NULL');
  expect(migration).toContain('ALTER COLUMN password_version DROP DEFAULT');
});
```

- [ ] **Step 2: 계약 테스트가 실패하는지 실행**

Run: `npm --prefix api test -- --runInBand migration-files.spec.ts`

Expected: FAIL because `1753660821000_google-auth-expand.cjs` does not exist.

- [ ] **Step 3: 확장 마이그레이션 작성**

마이그레이션은 다음 모양을 사용한다.

```sql
ALTER TABLE users
  ADD COLUMN google_subject TEXT,
  ADD COLUMN profile_image_url TEXT,
  ADD COLUMN last_login_at TIMESTAMPTZ,
  ALTER COLUMN password_hash DROP NOT NULL,
  ALTER COLUMN password_algorithm DROP NOT NULL,
  ALTER COLUMN password_parameters DROP NOT NULL,
  ALTER COLUMN password_version DROP NOT NULL,
  ALTER COLUMN password_version DROP DEFAULT,
  DROP CONSTRAINT users_email_key,
  DROP CONSTRAINT users_email_canonical_key,
  DROP CONSTRAINT users_password_version_positive,
  DROP CONSTRAINT users_password_parameters_object,
  DROP CONSTRAINT users_password_algorithm_valid,
  DROP CONSTRAINT users_identity_assurance_valid,
  DROP CONSTRAINT users_email_verification_claim_valid,
  ADD CONSTRAINT users_google_subject_key UNIQUE (google_subject),
  ADD CONSTRAINT users_google_subject_nonempty CHECK (
    google_subject IS NULL OR length(btrim(google_subject)) > 0
  ),
  ADD CONSTRAINT users_auth_shape CHECK (
    (google_subject IS NOT NULL
      AND password_hash IS NULL
      AND password_algorithm IS NULL
      AND password_parameters IS NULL
      AND password_version IS NULL
      AND identity_assurance = 'google_verified'
      AND email_verified_at IS NOT NULL)
    OR
    (google_subject IS NULL
      AND password_hash IS NOT NULL
      AND password_algorithm IS NOT NULL
      AND password_parameters IS NOT NULL
      AND password_version >= 1
      AND identity_assurance IN ('legacy_grandfathered', 'email_verified'))
  );

CREATE TABLE google_auth_attempts (
  id UUID PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('login', 'delete_account')),
  state_digest BYTEA NOT NULL UNIQUE CHECK (octet_length(state_digest) = 32),
  nonce_digest BYTEA NOT NULL CHECK (octet_length(nonce_digest) = 32),
  encrypted_code_verifier BYTEA NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  return_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  CHECK (expires_at > created_at),
  CHECK (
    (purpose = 'login' AND user_id IS NULL AND session_id IS NULL)
    OR (purpose = 'delete_account' AND user_id IS NOT NULL AND session_id IS NOT NULL)
  )
);
```

기존 password 알고리즘 검증은 `users_auth_shape`의 legacy 분기 안에 그대로 포함한다. `down`은 검증된 백업 복구를 요구하는 irreversible 오류를 반환한다.

- [ ] **Step 4: 실제 PostgreSQL에서 새 제약 검증 테스트 추가**

`api/test/auth.e2e-spec.ts`에 Google 사용자 insert 성공, 같은 `google_subject` 충돌, 같은 이메일을 가진 서로 다른 `sub` 허용, 자격 증명이 둘 다 없는 사용자 거부를 추가한다.

```ts
await pool.query(
  `INSERT INTO users (
     name, email, email_canonical, google_subject,
     password_hash, password_algorithm, password_parameters, password_version,
     identity_assurance, email_verified_at
   ) VALUES ($1, $2, $3, $4, NULL, NULL, NULL, NULL, 'google_verified', now())`,
  ['Google learner', email, email.toLowerCase(), subject],
);
```

- [ ] **Step 5: migration 단위 및 PostgreSQL 테스트 실행**

Run: `npm --prefix api test -- --runInBand migration-files.spec.ts`

Run with the isolated PostgreSQL test environment: `npm --prefix api run test:e2e -- --runInBand auth.e2e-spec.ts`

Expected: PASS.

- [ ] **Step 6: 스키마 확장 커밋**

```bash
git add api/migrations/1753660821000_google-auth-expand.cjs api/src/migration-files.spec.ts api/test/auth.e2e-spec.ts
git commit -m "feat(auth): Google 계정 스키마 확장"
```

---

### Task 2: Google 설정, PKCE와 토큰 검증 adapter

**Files:**
- Create: `api/src/auth/google/google-auth.config.ts`
- Create: `api/src/auth/google/google-auth.config.spec.ts`
- Create: `api/src/auth/google/google-attempt.crypto.ts`
- Create: `api/src/auth/google/google-attempt.crypto.spec.ts`
- Create: `api/src/auth/google/google-identity.client.ts`
- Create: `api/src/auth/google/google-identity.client.spec.ts`
- Modify: `api/package.json`
- Modify: `api/package-lock.json`
- Modify: `api/.env.example`

**Interfaces:**
- Consumes: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_AUTH_ATTEMPT_ENCRYPTION_KEY`, `STUDYTUBE_PUBLIC_URL`
- Produces: `GoogleAuthConfig`, `GoogleAttemptCrypto`, `GoogleIdentityClient`

- [ ] **Step 1: production 설정 검증 실패 테스트 작성**

```ts
expect(() => resolveGoogleAuthConfig({
  NODE_ENV: 'production',
  STUDYTUBE_PUBLIC_URL: 'https://studytube.page',
})).toThrow('GOOGLE_OAUTH_CLIENT_ID');

expect(resolveGoogleAuthConfig(validEnvironment).redirectUri).toBe(
  'https://studytube.page/api/auth/google/callback',
);
```

- [ ] **Step 2: 설정 테스트 실패 확인**

Run: `npm --prefix api test -- --runInBand google-auth.config.spec.ts`

Expected: FAIL because the config module does not exist.

- [ ] **Step 3: 정확한 설정 계약 구현**

```ts
export type GoogleAuthConfig = Readonly<{
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  attemptEncryptionKey: Buffer;
  attemptTtlMs: 600_000;
}>;
```

`GOOGLE_AUTH_ATTEMPT_ENCRYPTION_KEY`는 base64로 해석한 뒤 정확히 32바이트인지 확인한다. production에는 fallback을 두지 않는다. `STUDYTUBE_PUBLIC_URL`은 path, query, fragment와 userinfo가 없는 HTTPS origin만 허용한다.

- [ ] **Step 4: 암호화와 변조 거부 테스트 작성**

```ts
const encrypted = crypto.encryptVerifier('verifier-value');
expect(crypto.decryptVerifier(encrypted)).toBe('verifier-value');
encrypted[encrypted.length - 1] ^= 1;
expect(() => crypto.decryptVerifier(encrypted)).toThrow('Invalid Google attempt');
```

- [ ] **Step 5: AES-256-GCM 암호화 구현**

`encrypted_code_verifier`는 `version | 12-byte iv | ciphertext | 16-byte tag` 순서의 Buffer로 저장한다. state와 nonce는 SHA-256 digest만 저장한다. 오류에는 verifier나 암호문을 포함하지 않는다.

- [ ] **Step 6: Google adapter 실패 테스트 작성**

mock `OAuth2Client`가 code exchange와 ID token payload를 반환하게 하고 다음을 검사한다.

```ts
expect(identity).toEqual({
  subject: 'google-subject-1',
  email: 'learner@example.com',
  emailVerified: true,
  name: 'Learner',
  pictureUrl: 'https://example.com/avatar.png',
});
expect(getToken).toHaveBeenCalledWith({ code, codeVerifier, redirect_uri: redirectUri });
```

`sub` 없음, `email_verified !== true`, audience 불일치와 nonce digest 불일치를 각각 거부한다.

- [ ] **Step 7: 공식 Google client 최소 구현**

```ts
export interface GoogleIdentityClient {
  authorizationUrl(input: GoogleAuthorizationInput): string;
  exchange(input: GoogleCodeExchangeInput): Promise<GoogleIdentity>;
}
```

`authorizationUrl`에는 `response_type=code`, `scope=openid email profile`, `state`, `nonce`, `code_challenge`, `code_challenge_method=S256`만 넣는다. `exchange`는 token 응답에서 ID token만 검증하며 access token과 refresh token은 반환하거나 저장하지 않는다.

- [ ] **Step 8: 의존성과 테스트 실행**

Run: `npm.cmd --prefix api install --save-exact google-auth-library@11.0.2`

Run: `npm --prefix api test -- --runInBand google-auth.config.spec.ts google-attempt.crypto.spec.ts google-identity.client.spec.ts`

Expected: PASS.

- [ ] **Step 9: adapter 커밋**

```bash
git add api/package.json api/package-lock.json api/.env.example api/src/auth/google
git commit -m "feat(auth): Google 인증 검증 경계 추가"
```

---

### Task 3: 일회성 요청 저장과 Google 세션 생성 서비스

**Files:**
- Create: `api/src/auth/google/google-auth.types.ts`
- Create: `api/src/auth/google/google-auth.service.ts`
- Create: `api/src/auth/google/google-auth.service.spec.ts`
- Modify: `api/src/auth/auth.types.ts`
- Modify: `api/src/auth/auth.repository.ts`
- Modify: `api/src/database.service.ts`
- Modify: `api/src/database.service.spec.ts`

**Interfaces:**
- Consumes: `GoogleIdentityClient`, `GoogleAttemptCrypto`, 기존 `SessionMaterial`
- Produces: `GoogleAuthService.startLogin`, `GoogleAuthService.completeLogin`, repository의 attempt 및 Google user transaction

- [ ] **Step 1: start와 callback 서비스 실패 테스트 작성**

```ts
const started = await service.startLogin({ returnPath: '/courses' });
expect(started.authorizationUrl).toContain('code_challenge_method=S256');

const completed = await service.completeLogin({ state, code: 'one-use-code' });
expect(completed).toMatchObject({
  status: 'authenticated',
  returnPath: '/courses',
  newUser: true,
});
```

같은 state 재사용, 만료, 잘못된 return path, 같은 이메일의 다른 `sub`, 같은 `sub` 동시 callback을 각각 테스트한다.

- [ ] **Step 2: 서비스 테스트 실패 확인**

Run: `npm --prefix api test -- --runInBand google-auth.service.spec.ts`

Expected: FAIL because service and repository contracts do not exist.

- [ ] **Step 3: repository 계약 추가**

```ts
export type CreateGoogleAttemptCommand = {
  id: string;
  purpose: 'login';
  stateDigest: Buffer;
  nonceDigest: Buffer;
  encryptedCodeVerifier: Buffer;
  returnPath: string;
  expiresAt: Date;
};

export type CommitGoogleLoginCommand = SessionMaterial & {
  googleSubject: string;
  email: string;
  name: string;
  profileImageUrl: string | null;
  authenticatedAt: Date;
};
```

`consumeGoogleAttempt(stateDigest, now)`는 `SELECT FOR UPDATE SKIP LOCKED`와 `consumed_at` update를 한 트랜잭션에서 처리한다. 만료 또는 사용 완료 행은 `invalid`를 반환한다.

- [ ] **Step 4: Google user upsert와 session insert 구현**

`commitGoogleLogin`은 다음 순서를 한 transaction에서 수행한다.

1. `google_subject`로 사용자 row를 lock하거나 insert한다.
2. 새 사용자는 Google name을 서비스 name으로 사용한다.
3. 기존 사용자는 email, canonical email, profile image와 `last_login_at`만 갱신하고 name은 덮어쓰지 않는다.
4. session digest와 만료 시각을 저장한다.
5. `{ user, newUser }`를 반환한다.

이메일 충돌로 계정을 찾거나 합치지 않는다.

- [ ] **Step 5: service 최소 구현**

```ts
export class GoogleAuthService {
  startLogin(input: { returnPath?: string }): Promise<{
    authorizationUrl: string;
  }>;

  completeLogin(input: { state: string; code: string }): Promise<{
    status: 'authenticated';
    sessionToken: string;
    user: AuthPublicUser;
    newUser: boolean;
    returnPath: string;
  }>;
}
```

허용 return path는 `/`, `/watch`, `/courses`, `/me`와 그 하위 상대 경로로 제한한다. `//`, scheme, backslash, 제어 문자와 `/auth` 경로는 `/`로 바꾼다.

- [ ] **Step 6: DatabaseService와 service 테스트 실행**

Run: `npm --prefix api test -- --runInBand database.service.spec.ts google-auth.service.spec.ts`

Expected: PASS.

- [ ] **Step 7: 세션 서비스 커밋**

```bash
git add api/src/auth/auth.types.ts api/src/auth/auth.repository.ts api/src/auth/google/google-auth.types.ts api/src/auth/google/google-auth.service.ts api/src/auth/google/google-auth.service.spec.ts api/src/database.service.ts api/src/database.service.spec.ts
git commit -m "feat(auth): Google 계정 세션 생성"
```

---

### Task 4: Google HTTP 시작과 callback

**Files:**
- Create: `api/src/auth/google/google-auth.controller.ts`
- Create: `api/src/auth/google/google-auth.controller.spec.ts`
- Create: `api/test/google-auth.e2e-spec.ts`
- Modify: `api/src/auth/auth.module.ts`
- Modify: `api/src/auth/auth-http.exception.ts`

**Interfaces:**
- Consumes: `GoogleAuthService`, `AuthCookiePolicy`
- Produces: `GET /auth/google/start`, `GET /auth/google/callback`

- [ ] **Step 1: controller redirect 실패 테스트 작성**

```ts
expect(response.redirect).toHaveBeenCalledWith(
  expect.stringContaining('accounts.google.com'),
);
expect(cookies.setSessionCookie).toHaveBeenCalledWith(response, 'opaque-session');
expect(response.redirect).toHaveBeenCalledWith(
  '/auth/google/complete?new=1&returnTo=%2Ftutorial',
);
```

Google callback의 `error=access_denied`, code 없음, state 없음과 service failure가 각각 `/login?googleError=`의 허용 코드로만 이동하는지 확인한다.

- [ ] **Step 2: controller 테스트 실패 확인**

Run: `npm --prefix api test -- --runInBand google-auth.controller.spec.ts`

Expected: FAIL because the controller does not exist.

- [ ] **Step 3: public GET controller 구현**

callback query는 raw token을 validation error body에 반영하지 않는다. 성공 시 세션 cookie를 먼저 설정한 뒤 Web completion route로 이동한다. 오류 코드는 `cancelled`, `expired`, `unavailable` 세 개로 고정한다.

- [ ] **Step 4: 실제 Nest HTTP 계약 테스트 작성**

`api/test/google-auth.e2e-spec.ts`에서 `GOOGLE_IDENTITY_CLIENT` provider를 mock으로 교체한다. 다음을 검증한다.

- start 응답 302와 Google host
- callback 응답 302와 session cookie
- callback 재사용 거부
- `/me`가 callback으로 만든 사용자를 반환
- cookie와 body에 Google token이 없음
- 허용하지 않은 return path가 `/`로 바뀜

- [ ] **Step 5: controller 단위 및 e2e 실행**

Run: `npm --prefix api test -- --runInBand google-auth.controller.spec.ts`

Run with isolated PostgreSQL: `npm --prefix api run test:e2e -- --runInBand google-auth.e2e-spec.ts`

Expected: PASS.

- [ ] **Step 6: HTTP 흐름 커밋**

```bash
git add api/src/auth/google/google-auth.controller.ts api/src/auth/google/google-auth.controller.spec.ts api/src/auth/auth.module.ts api/src/auth/auth-http.exception.ts api/test/google-auth.e2e-spec.ts
git commit -m "feat(auth): Google 로그인 HTTP 흐름 연결"
```

---

### Task 5: Google 로그인만 남기는 Web 전환과 이전 저장소 초기화

**Files:**
- Create: `web/src/features/auth/GoogleAuthCompletePage.tsx`
- Create: `web/src/studyStorageReset.ts`
- Delete: `web/src/features/auth/VerificationPage.tsx`
- Delete: `web/src/features/auth/RegistrationCompletionPage.tsx`
- Modify: `web/src/features/auth/AuthPage.tsx`
- Modify: `web/src/app/AppRoutes.tsx`
- Modify: `web/src/app/SiteNav.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/api.ts`
- Modify: `web/tests/authPagesBoundary.test.ts`
- Modify: `web/tests/api.test.ts`
- Create: `web/tests/studyStorageReset.test.ts`
- Delete: `web/tests/registrationEmailFlow.test.ts`
- Delete: `web/tests/verificationFlow.test.ts`
- Delete: `web/tests/registrationTerminology.test.ts`

**Interfaces:**
- Consumes: API base URL, `GET /me`, server callback completion query
- Produces: Google-only login page, session hydration, storage epoch `google-only-v1`

- [ ] **Step 1: Google-only 화면과 저장소 실패 테스트 작성**

```ts
assert.match(authPageSource, /Google로 계속하기/);
assert.doesNotMatch(authPageSource, /type="password"|회원가입|이메일 인증/);
assert.doesNotMatch(routesSource, /\/signup|VerificationPage|RegistrationCompletionPage/);
assert.doesNotMatch(navSource, /회원가입/);
assert.match(authPageSource, /Google 로그인을 취소했어요/);
assert.match(authPageSource, /로그인 시간이 지났어요/);
assert.match(authPageSource, /지금은 로그인할 수 없어요/);
```

저장소 테스트는 localStorage와 sessionStorage에서 `studytube.` 또는 `studytube:`로 시작하는 키만 삭제하고 `other-app.key`는 유지하는지 확인한다.

- [ ] **Step 2: Web 테스트 실패 확인**

Run: `node --test web/tests/authPagesBoundary.test.ts web/tests/studyStorageReset.test.ts`

Expected: FAIL because the old forms and routes still exist.

- [ ] **Step 3: API URL helper와 completion API 작성**

```ts
export function googleLoginUrl(returnTo: string) {
  const query = new URLSearchParams({ returnTo });
  return `${apiBaseUrl()}/auth/google/start?${query.toString()}`;
}

export async function completeGoogleLogin(): Promise<Session> {
  return { user: await fetchMe() };
}
```

이메일 가입, 인증, login과 `verifyMe` client 함수 및 관련 오류 문구를 삭제한다.

- [ ] **Step 4: 로그인 화면과 completion route 구현**

`AuthPage`는 서비스 설명 한 문장과 Google 링크 하나만 렌더링한다. `GoogleAuthCompletePage`는 `fetchMe()`를 한 번 호출해 `onComplete({ user })`를 실행하고 new flag가 있으면 `/tutorial`, 아니면 검증된 `returnTo`로 이동한다.

```tsx
<a className="primary-link google-login" href={googleLoginUrl(returnTo)}>
  Google로 계속하기
</a>
```

- [ ] **Step 5: storage epoch를 session 읽기 전에 적용**

```ts
export const STUDYTUBE_STORAGE_EPOCH = 'google-only-v1';

export function ensureStudyTubeStorageEpoch(local: Storage, session: Storage) {
  if (local.getItem('studytube.storageEpoch') === STUDYTUBE_STORAGE_EPOCH) return;
  clearStudyTubeStorage(local);
  clearStudyTubeStorage(session);
  local.setItem('studytube.storageEpoch', STUDYTUBE_STORAGE_EPOCH);
}
```

`App`의 session state initializer에서 `readSession()`보다 먼저 호출한다.

- [ ] **Step 6: 모든 Web 계약과 build 실행**

Run: `node --test web/tests/*.test.ts`

Run: `npm --prefix web run build`

Run: `npm --prefix web run lint`

Expected: PASS, and no `/signup` route or email/password control remains.

- [ ] **Step 7: Web 전환 커밋**

```bash
git add web/src/features/auth/AuthPage.tsx web/src/features/auth/GoogleAuthCompletePage.tsx web/src/features/auth/VerificationPage.tsx web/src/features/auth/RegistrationCompletionPage.tsx web/src/studyStorageReset.ts web/src/app/AppRoutes.tsx web/src/app/SiteNav.tsx web/src/App.tsx web/src/api.ts web/tests/authPagesBoundary.test.ts web/tests/api.test.ts web/tests/studyStorageReset.test.ts web/tests/registrationEmailFlow.test.ts web/tests/verificationFlow.test.ts web/tests/registrationTerminology.test.ts
git commit -m "feat(web): Google 로그인만 제공"
```

---

### Task 6: 계정 수정에서 비밀번호 확인과 변경 제거

**Files:**
- Delete: `web/src/features/account/ProfileVerificationForm.tsx`
- Modify: `web/src/features/account/MyPage.tsx`
- Modify: `web/src/features/account/MyEditPage.tsx`
- Modify: `web/src/features/account/AccountEditPage.css`
- Modify: `web/src/profileEdit.ts`
- Modify: `web/src/api.ts`
- Modify: `web/tests/accountPagesBoundary.test.ts`
- Modify: `web/tests/profileEdit.test.ts`
- Modify: `api/src/auth/auth.controller.ts`
- Modify: `api/src/auth/auth.dto.ts`
- Modify: `api/src/auth/auth.service.ts`
- Modify: `api/src/auth/auth.service.spec.ts`

**Interfaces:**
- Consumes: authenticated session
- Produces: `PUT /me` with `name` or `preferences` only

- [ ] **Step 1: password-free profile 계약 테스트 작성**

```ts
assert.doesNotMatch(myEditSource, /currentPassword|새 비밀번호|ProfileVerificationForm/);
assert.match(myPageSource, /to="\/me\/edit"/);
assert.doesNotMatch(apiSource, /me\/verify|verifyMe/);
```

API unit test는 name update가 password lookup 없이 repository `updateProfile`을 호출하는지 확인한다.

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test web/tests/accountPagesBoundary.test.ts web/tests/profileEdit.test.ts`

Run: `npm --prefix api test -- --runInBand auth.service.spec.ts`

Expected: FAIL on existing password verification behavior.

- [ ] **Step 3: profile 수정 단순화**

`UpdateProfileDto`에서 `currentPassword`와 `password`를 제거한다. `AuthService.updateProfile`은 name 또는 preferences만 정규화하고 현재 session user id로 update한다. `POST /me/verify` controller route를 제거한다.

`MyPage`의 `내 정보 수정`은 `/me/edit`로 바로 이동한다. `MyEditPage`는 name과 읽기 전용 email만 표시한다.

- [ ] **Step 4: API와 Web 회귀 테스트 실행**

Run: `npm --prefix api test -- --runInBand auth.service.spec.ts auth-http.spec.ts`

Run: `node --test web/tests/accountPagesBoundary.test.ts web/tests/profileEdit.test.ts web/tests/api.test.ts`

Expected: PASS.

- [ ] **Step 5: profile 전환 커밋**

```bash
git add api/src/auth/auth.controller.ts api/src/auth/auth.dto.ts api/src/auth/auth.service.ts api/src/auth/auth.service.spec.ts web/src/features/account/ProfileVerificationForm.tsx web/src/features/account/MyPage.tsx web/src/features/account/MyEditPage.tsx web/src/features/account/AccountEditPage.css web/src/profileEdit.ts web/src/api.ts web/tests/accountPagesBoundary.test.ts web/tests/profileEdit.test.ts
git commit -m "refactor(account): 비밀번호 기반 수정 제거"
```

---

### Task 7: Google 전용 모드와 운영 비밀 전달

**Files:**
- Modify: `api/src/auth/auth.module.ts`
- Modify: `api/src/auth/auth.controller.ts`
- Create: `api/src/auth/legacy-email-auth.controller.ts`
- Create: `api/src/auth/legacy-email-auth.controller.spec.ts`
- Modify: `api/test/google-auth.e2e-spec.ts`
- Modify: `api/test/auth.e2e-spec.ts`
- Modify: `scripts/install-production-runtime.sh`
- Modify: `scripts/tests/runtime-isolation-contract.sh`
- Modify: `scripts/deploy-ec2.sh`
- Modify: `api/.env.example`
- Modify: `docs/ci-cd.md`

**Interfaces:**
- Consumes: `AUTH_MODE=legacy|google_only` and Google secrets
- Produces: production fail-closed configuration and retired email endpoints returning 404

- [ ] **Step 1: runtime config와 retired route 실패 테스트 작성**

`scripts/tests/runtime-isolation-contract.sh`의 expected API keys에 다음을 넣는다.

```text
AUTH_MODE
GOOGLE_AUTH_ATTEMPT_ENCRYPTION_KEY
GOOGLE_OAUTH_CLIENT_ID
GOOGLE_OAUTH_CLIENT_SECRET
```

Google e2e는 `AUTH_MODE=google_only`에서 기존 signup, login, verification과 registration이 모두 404인지 확인한다. `POST /auth/logout`, `GET /me`와 `PUT /me`는 계속 동작해야 한다.

- [ ] **Step 2: 계약 테스트 실패 확인**

Run: `bash scripts/tests/runtime-isolation-contract.sh`

Run: `npm --prefix api test -- --runInBand legacy-email-auth.controller.spec.ts`

Run with isolated PostgreSQL: `npm --prefix api run test:e2e -- --runInBand google-auth.e2e-spec.ts`

Expected: FAIL because the new environment keys and route gate are missing.

- [ ] **Step 3: production fail-closed mode 구현**

production은 `AUTH_MODE`가 없으면 부팅을 거부한다. 기존 `AuthController`에는 logout, `GET /me`와 `PUT /me`만 남긴다. 이메일 가입, 인증과 비밀번호 login route는 `LegacyEmailAuthController`로 옮긴다.

```ts
const controllers = [AuthController, GoogleAuthController];
if (resolveAuthMode(process.env) === 'legacy') {
  controllers.push(LegacyEmailAuthController);
}
```

`google_only`에서는 session과 profile route를 유지하면서 legacy controller를 route table에 등록하지 않는다. `legacy`는 초기 비공개 검증 release에만 허용한다.

설치 스크립트의 API environment allowlist에 Google secret을 추가하되 값은 stdout, unit 파일과 SSM command body에 출력하지 않는다.

- [ ] **Step 4: 문서에 Google Console 설정 기록**

`docs/ci-cd.md`에 OAuth Web Client 생성, 운영과 로컬 callback, required secrets, `AUTH_MODE=google_only` cutover 순서를 기록한다. 실제 secret 값이나 client id는 기록하지 않는다.

- [ ] **Step 5: runtime, API, OpenAPI 검증**

Run: `bash scripts/tests/runtime-isolation-contract.sh`

Run: `npm --prefix api run openapi:export`

Run: `npm --prefix api run openapi:verify`

Run: `npm --prefix api run build`

Run: `npm --prefix api run lint`

Expected: PASS, with retired routes absent from OpenAPI.

- [ ] **Step 6: 운영 설정 커밋**

```bash
git add api/src/auth/auth.module.ts api/src/auth/auth.controller.ts api/src/auth/legacy-email-auth.controller.ts api/src/auth/legacy-email-auth.controller.spec.ts api/test/google-auth.e2e-spec.ts api/test/auth.e2e-spec.ts scripts/install-production-runtime.sh scripts/tests/runtime-isolation-contract.sh scripts/deploy-ec2.sh api/.env.example docs/ci-cd.md
git commit -m "chore(auth): Google 전용 운영 모드 고정"
```

---

### Task 8: Google 인증 통합 검증과 다음 계획 인계

**Files:**
- Modify only if verification finds a defect in files owned by Tasks 1 through 7

**Interfaces:**
- Consumes: completed Google-only auth branch
- Produces: green local gate and exact handoff to `2026-08-31-google-account-deletion.md`

- [ ] **Step 1: focused test 전체 실행**

Run: `npm --prefix api test -- --runInBand google-auth auth.service auth-cookie origin.guard migration-files`

Run with isolated PostgreSQL: `npm --prefix api run test:e2e -- --runInBand google-auth.e2e-spec.ts auth.e2e-spec.ts`

Run: `node --test web/tests/*.test.ts`

Expected: PASS.

- [ ] **Step 2: build와 lint 실행**

Run: `npm --prefix api run build`

Run: `npm --prefix api run lint`

Run: `npm --prefix web run build`

Run: `npm --prefix web run lint`

Expected: PASS.

- [ ] **Step 3: secret과 내부 용어 누출 검사**

Run: `rg -n "GOOGLE_OAUTH_CLIENT_SECRET=|access_token|refresh_token|id_token" api web scripts docs -g '!package-lock.json'`

Expected: no credential values and no token logging or persistence.

- [ ] **Step 4: diff 품질 검사**

Run: `git diff --check origin/main...HEAD`

Run: `git status --short`

Expected: only planned tracked files plus untouched user-owned `artifacts/` and `design-qa.md`.

- [ ] **Step 5: integration 결과 커밋**

If verification required fixes:

```bash
git diff --name-only
# Review each listed path, then stage only the reviewed defect files explicitly.
git commit -m "fix(auth): Google 전용 인증 통합 보완"
```

If no fixes were required, do not create an empty commit.

---

### Task 9: 초기화 안정화 뒤 legacy 이메일 인증 계약 제거

**Execution Gate:** `2026-08-31-user-data-reset.md` Task 7의 production reset과 Google login smoke test가 통과하기 전에는 시작하지 않는다.

**Files:**
- Create: `api/migrations/1753660824000_google-auth-contract.cjs`
- Delete: `api/src/auth/legacy-email-auth.controller.ts`
- Delete: `api/src/auth/legacy-email-auth.controller.spec.ts`
- Delete: `api/src/auth/argon2-work-limiter.ts`
- Delete: `api/src/auth/argon2-work-limiter.spec.ts`
- Delete: `api/src/auth/password-hasher.ts`
- Delete: `api/src/auth/password-hasher.spec.ts`
- Delete: `api/src/auth/verification-email-outbox.repository.ts`
- Delete: `api/src/auth/verification-email-outbox.repository.spec.ts`
- Delete: `api/src/auth/verification-email-outbox.worker.ts`
- Delete: `api/src/auth/verification-email-outbox.worker.spec.ts`
- Delete: `api/src/auth/verification-email-sender.ts`
- Delete: `api/src/auth/verification-email-sender.spec.ts`
- Delete: `api/src/auth/verification-email.config.ts`
- Delete: `api/src/auth/verification-email.config.spec.ts`
- Delete: `api/src/auth/verification-email.ts`
- Delete: `api/src/auth/verification-email.spec.ts`
- Modify: `api/src/auth/auth-token.ts`
- Modify: `api/src/auth/auth-token.spec.ts`
- Modify: `api/src/auth/auth.dto.ts`
- Modify: `api/src/auth/auth.types.ts`
- Modify: `api/src/auth/auth.repository.ts`
- Modify: `api/src/auth/auth.service.ts`
- Modify: `api/src/auth/auth.service.spec.ts`
- Modify: `api/src/auth/auth.module.ts`
- Modify: `api/src/database.service.ts`
- Modify: `api/src/database.service.spec.ts`
- Modify: `api/src/work/worker.module.ts`
- Modify: `api/src/migration-files.spec.ts`
- Modify: `api/src/maintenance/user-data-reset.manifest.ts`
- Modify: `api/src/maintenance/user-data-reset.plan.spec.ts`
- Modify: `api/test/user-data-reset.e2e-spec.ts`
- Modify: `api/test/auth.e2e-spec.ts`
- Modify: `api/package.json`
- Modify: `api/package-lock.json`
- Modify: `scripts/install-production-runtime.sh`
- Modify: `scripts/tests/runtime-isolation-contract.sh`
- Modify: `docs/ci-cd.md`

**Interfaces:**
- Consumes: empty legacy auth tables and verified Google-only production mode
- Produces: Google-only user schema, session/profile AuthService and worker without email delivery

- [ ] **Step 1: contract migration과 dead-code 실패 테스트 작성**

```ts
expect(migration).toContain('DROP TABLE verification_email_outbox');
expect(migration).toContain('DROP TABLE pending_registrations');
expect(migration).toContain('DROP COLUMN password_hash');
expect(migration).toContain('DROP COLUMN password_algorithm');
expect(migration).toContain('DROP COLUMN password_parameters');
expect(migration).toContain('DROP COLUMN password_version');
expect(migration).toContain('DROP COLUMN identity_assurance');
```

새 boundary test는 `api/src/auth`와 `worker.module.ts`에 signup, password hasher, verification email, enrollment과 SES sender import가 없음을 확인한다.

- [ ] **Step 2: RED 확인**

Run: `npm --prefix api test -- --runInBand migration-files.spec.ts auth.service.spec.ts`

Expected: FAIL because legacy schema and code are still present.

- [ ] **Step 3: irreversible contract migration 작성**

마이그레이션은 `verification_email_outbox`, `pending_registrations`가 비어 있고 모든 user가 non-null `google_subject`를 갖는지 preflight한다. 한 조건이라도 어기면 중단한다.

```sql
ALTER TABLE users
  DROP CONSTRAINT users_auth_shape,
  ALTER COLUMN google_subject SET NOT NULL,
  DROP COLUMN password_hash,
  DROP COLUMN password_algorithm,
  DROP COLUMN password_parameters,
  DROP COLUMN password_version,
  DROP COLUMN identity_assurance;

DROP TABLE verification_email_outbox;
DROP TABLE pending_registrations;
```

`down`은 7일 backup 복구 또는 roll-forward를 요구한다.

- [ ] **Step 4: AuthService와 repository를 session/profile 전용으로 축소**

`AuthService`에는 `authenticateSession`, `logout`, `updateProfile`만 남긴다. `auth-token.ts`에는 opaque session 발급, digest와 rate limit subject digest만 남긴다. DatabaseService의 pending registration, password login과 verification repository method를 제거한다.

- [ ] **Step 5: verification worker와 SES 의존성 제거**

`worker.module.ts`에서 email sender와 worker provider를 제거하고 DatabaseService의 email outbox accessor를 삭제한다. `@aws-sdk/client-sesv2` 3.1097.0을 package와 lockfile에서 제거한다. runtime allowlist와 `docs/ci-cd.md`에서 `AUTH_EMAIL_*`와 `AUTH_VERIFICATION_PEPPER`를 제거한다. `AUTH_RATE_LIMIT_PEPPER`는 Google start rate limit에 사용하므로 유지한다.

reset manifest에서는 이제 존재하지 않는 `pending_registrations`와 `verification_email_outbox`를 제거하고 planner 및 reset E2E를 현재 Google-only schema에 맞춘다.

- [ ] **Step 6: Google-only auth E2E로 기존 auth test 교체**

`api/test/auth.e2e-spec.ts`는 session cookie, `/me`, name/preferences update와 logout만 검증하도록 줄인다. 가입과 로그인은 `google-auth.e2e-spec.ts`, 탈퇴는 `account-deletion.e2e-spec.ts`가 소유한다.

- [ ] **Step 7: 전체 API 검증**

Run: `npm --prefix api test -- --runInBand`

Run with isolated PostgreSQL: `npm --prefix api run test:e2e -- --runInBand`

Run: `npm --prefix api run openapi:export`

Run: `npm --prefix api run openapi:verify`

Run: `npm --prefix api run build`

Run: `npm --prefix api run lint`

Expected: PASS, with no email/password route or worker.

- [ ] **Step 8: legacy 인증 제거 커밋**

```bash
git add api/migrations/1753660824000_google-auth-contract.cjs api/src/auth/legacy-email-auth.controller.ts api/src/auth/legacy-email-auth.controller.spec.ts api/src/auth/argon2-work-limiter.ts api/src/auth/argon2-work-limiter.spec.ts api/src/auth/password-hasher.ts api/src/auth/password-hasher.spec.ts api/src/auth/verification-email-outbox.repository.ts api/src/auth/verification-email-outbox.repository.spec.ts api/src/auth/verification-email-outbox.worker.ts api/src/auth/verification-email-outbox.worker.spec.ts api/src/auth/verification-email-sender.ts api/src/auth/verification-email-sender.spec.ts api/src/auth/verification-email.config.ts api/src/auth/verification-email.config.spec.ts api/src/auth/verification-email.ts api/src/auth/verification-email.spec.ts api/src/auth/auth-token.ts api/src/auth/auth-token.spec.ts api/src/auth/auth.dto.ts api/src/auth/auth.types.ts api/src/auth/auth.repository.ts api/src/auth/auth.service.ts api/src/auth/auth.service.spec.ts api/src/auth/auth.module.ts api/src/database.service.ts api/src/database.service.spec.ts api/src/work/worker.module.ts api/src/migration-files.spec.ts api/src/maintenance/user-data-reset.manifest.ts api/src/maintenance/user-data-reset.plan.spec.ts api/test/auth.e2e-spec.ts api/test/user-data-reset.e2e-spec.ts api/package.json api/package-lock.json scripts/install-production-runtime.sh scripts/tests/runtime-isolation-contract.sh docs/ci-cd.md
git commit -m "refactor(auth): 이메일과 비밀번호 인증 제거"
```
