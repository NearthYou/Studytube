# StudyTube Backend Authentication Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Every behavior change starts with a failing test and records the expected failure before production code is added.

**Goal:** Finish a portfolio-ready backend authentication slice that replaces raw Bearer tokens and SHA-256 passwords with verified enrollment, race-safe PostgreSQL sessions, HttpOnly cookies, bounded Argon2 work, and durable rate limits.

**Architecture:** A Nest `auth` module owns bounded password hashing, pending registration and enrollment, token derivation, authentication use cases, cookie and Origin policy, client-address resolution, and session guards. `AuthService` depends on a narrow `AuthRepository` port implemented by `DatabaseService`; secure operations fail closed without PostgreSQL. Signup stores no user or password before email proof. The current portfolio cut uses a durable capture outbox boundary for local and automated proof, while production email-provider integration and the React authentication rebuild are deferred.

**Tech stack:** Node 24.8+, NestJS 11, TypeScript, built-in `node:crypto.argon2`, PostgreSQL 16, Jest, and Supertest. Existing Docker, CI, and deployment scripts remain supporting evidence; Terraform is not used.

---

## Authoritative decisions

- Follow `docs/superpowers/specs/2026-07-28-studytube-backend-auth-design.md` when a code detail is not repeated here.
- Use asynchronous Node built-in Argon2id and a strict PHC encoder/parser. Do not add a native Argon2 dependency.
- Keep the existing baseline migrations immutable. Add a new irreversible credential-cutover migration.
- Existing users receive `legacy_grandfathered`, never a false email-verified claim; every existing raw session is invalidated at migration time.
- Signup accepts only email. Verification establishes a short-lived HttpOnly enrollment cookie; name and password are selected only during verified registration completion.
- Admit Argon2 only after PostgreSQL rate limiting and through a memory-budgeted concurrency and queue limiter.
- Use application-generated UUIDs so the migration does not require `pgcrypto`.
- Keep repository ports narrow and define only behavior exercised by the portfolio-core authentication flow.
- Never use `MemoryBoardRepository` as an auth fallback.
- Keep immutable email rendering inputs and a payload hash in the durable outbox, but implement only the local/test capture boundary in this cut. Resend delivery is follow-up work.
- Register global Origin and session guards only after every route has an explicit public or protected classification.
- Keep `#11` limited to real HTTPS, reverse proxy, and browser Secure-cookie verification. Do not add Terraform.
- Do not deploy `#7` to the current HTTP service. `#11` owns the maintenance cutover, verified `pg_dump`, restore rehearsal, and cache invalidation.

## Portfolio-core finish line

This section overrides later task detail when the two conflict. The earlier detail remains as a follow-up backlog, not as the completion gate for this cut.

Active scope:

- Complete email-only signup, verification consumption, verified name/password selection, login, `/me`, logout, and password/session rotation through PostgreSQL-backed domain services.
- Expose the flow through strict DTOs, HttpOnly cookies, exact Origin checks, stable errors, and a session guard for the protected backend routes needed to demonstrate authorization.
- Keep a durable capture outbox boundary sufficient for local development and automated verification. Do not integrate the Resend production API in this cut.
- Add a compact PostgreSQL and Supertest proof set for the highest-value invariants: no password before proof, duplicate completion linearization, atomic rate increments, login/session expiry, logout revocation, and secret-free responses/logs.
- Keep existing CI, Docker, migration, backup guard, and deployment documentation as supporting infrastructure evidence. Do not add Terraform or a new platform layer.
- Finish with an API-focused README, architecture and transaction diagrams, exact verification evidence, one PR, and the development journal.

Deferred to follow-up work:

- Resend production delivery, retry tuning, and exhaustive outbox crash permutations beyond the durable capture proof.
- The React token-to-cookie rewrite, onboarding state-machine rebuild, and frontend polish. The portfolio deliverable is explicitly API-first.
- Broad route taxonomy redesign, optional public explore splits, and exhaustive race combinations that do not change the core authentication claim.
- Real HTTPS activation, reverse-proxy rollout, production backup and restore rehearsal, and browser Secure-cookie verification owned by `#11`.

Execution policy:

- Group work into enrollment transactions, session and HTTP integration, and verification plus documentation.
- Use one implementation review per group. Immediately fix only security, data-integrity, correctness, build, or test blockers; record minor style and optional hardening findings for follow-up.
- Prefer a small set of integration tests that prove the portfolio claims over exhaustive mock permutations.

## File structure

Create under `api/src/auth/`:

- `auth.constants.ts`: TTL, Argon2, rate-limit, cookie, and enrollment policy defaults.
- `auth.types.ts`: public user, stored auth user, session, principal, verification, and repository command/result types.
- `auth.repository.ts`: `AUTH_REPOSITORY` and `AuthRepository` port.
- `password-hasher.ts` and `password-hasher.spec.ts`: built-in Argon2id, legacy SHA-256 verification, PHC parsing, and password validation.
- `argon2-work-limiter.ts` and spec: memory-budgeted concurrency, bounded queue, and overload rejection.
- `auth-token.ts` and `auth-token.spec.ts`: session token, digest, verification token, and rate-subject HMAC functions.
- `auth-cookie.ts` and `auth-cookie.spec.ts`: exact cookie parsing and production/development response policy.
- `auth.service.ts` and `auth.service.spec.ts`: signup request, resend, verification consume, registration completion, login retry, session lookup, logout, and account mutation use cases.
- `auth.dto.ts`: class-validator request DTOs.
- `auth.controller.ts` and `auth.controller.spec.ts`: cookie-only HTTP contract.
- `public.decorator.ts`, `current-principal.decorator.ts`, `session.guard.ts`, and `session.guard.spec.ts`: route identity boundary.
- `origin.guard.ts` and `origin.guard.spec.ts`: exact Origin and JSON content-type policy.
- `client-address.resolver.ts` and spec: direct-peer and loopback-only one-hop proxy address policy.
- `auth-exception.filter.ts` and `auth-exception.filter.spec.ts`: stable error body and secret-safe mapping.
- `auth.module.ts`: provider wiring.

Create under `api/src/email/`:

- `verification-email-sender.ts`: application port and typed provider failure.
- `capture-verification-email.sender.ts` and spec.
- `resend-verification-email.sender.ts` and spec.
- `verification-email-outbox.repository.ts`: worker repository port.
- `email-outbox.worker.ts` and spec.
- `email.module.ts`: environment-specific sender and worker wiring.

Create or modify supporting files:

- `api/migrations/1753660802000_auth-hardening.cjs`
- `api/scripts/benchmark-password-hash.ts`
- `api/test/auth.e2e-spec.ts`
- `api/test/auth-races.e2e-spec.ts`
- `api/src/database.service.ts`
- `api/src/configure-application.ts`
- `api/src/study-board.controller.ts`
- `api/src/study-board.service.ts`
- `api/src/study-board.types.ts`
- `api/src/ai.controller.ts`
- `api/src/video-asset.controller.ts`
- `api/src/app.controller.ts`
- `api/src/app.module.ts`
- `api/src/main.ts`
- `api/src/cors-options.ts`
- `api/src/memory-board.repository.ts`
- `api/scripts/seed-demo.ts`
- migration, database, service, controller, and CORS specs already beside those files
- `api/package.json`, `api/package-lock.json`, `.env.example`, `api/.env.example`, `.gitignore`, `.github/workflows/ci-cd.yml`, `scripts/deploy-ec2.sh`, `docs/environment-setup.md`, and `docs/ci-cd.md`
- `web/src/api.ts`, `web/src/types.ts`, `web/src/authSession.ts`, `web/src/localStudyStorage.ts`, `web/src/watchQueueStorage.ts`, `web/src/onboarding.ts`, and `web/src/App.tsx`
- matching `web/tests/*.test.ts` files plus new `web/tests/api.test.ts` and `web/tests/authFlow.test.ts`

---

### Task 1: Establish the bounded Node 24 Argon2id password boundary

**Files:**

- Create: `api/src/auth/auth.constants.ts`
- Create: `api/src/auth/password-hasher.ts`
- Create: `api/src/auth/password-hasher.spec.ts`
- Create: `api/src/auth/argon2-work-limiter.ts`
- Create: `api/src/auth/argon2-work-limiter.spec.ts`
- Create: `api/scripts/benchmark-password-hash.ts`
- Modify: `api/package.json`
- Modify: `api/package-lock.json`

- [ ] **Step 1: Write failing password-hasher tests**

Cover these contracts in `password-hasher.spec.ts`:

```ts
it('hashes and verifies with the configured Argon2id PHC parameters');
it('uses a different 16-byte salt for the same password');
it('rejects a wrong password with a timing-safe digest comparison');
it('recognizes and verifies a lowercase legacy SHA-256 hash');
it('marks legacy and weaker PHC parameters for rehash');
it('keeps whitespace significant and rejects control characters');
it('accepts 8 bytes and rejects values outside 8 to 128 UTF-8 bytes');
it('rejects malformed or oversized PHC strings without invoking Argon2');
it('runs no more than the memory-budgeted Argon2 concurrency');
it('queues only the configured number of jobs and rejects overflow with retry metadata');
it('rejects startup policy whose concurrency exceeds the 64 MiB per-job budget');
```

The primary assertion must match a string beginning with `$argon2id$v=19$m=65536,t=3,p=1$` and must verify through the public `PasswordHasher` API rather than test-only parsing.

- [ ] **Step 2: Run the focused test and capture the expected failure**

```bash
npm --prefix api test -- auth/password-hasher.spec.ts auth/argon2-work-limiter.spec.ts --runInBand
```

Expected: FAIL because the auth password module does not exist.

- [ ] **Step 3: Implement strict PHC hashing and verification**

Use asynchronous `node:crypto.argon2('argon2id', ...)` with a random 16-byte nonce, 65,536 KiB memory, 3 passes, parallelism 1, and a 32-byte tag. Encode PHC base64 without padding. Parse by an anchored expression, reject unknown parameters and oversized input before allocating, recompute the tag, and compare with `timingSafeEqual`.

Expose:

```ts
export type PasswordVerification = {
  valid: boolean;
  needsRehash: boolean;
  algorithm: 'argon2id' | 'legacy_sha256' | 'unknown';
};

export class PasswordHasher {
  validate(password: string): void;
  hash(password: string): Promise<string>;
  verify(storedHash: string, password: string): Promise<PasswordVerification>;
  createDummyHash(): Promise<string>;
}
```

`Argon2WorkLimiter.run()` wraps every real or dummy hash and verify operation. Default concurrency is 2, default queue length is 16, and configured concurrency must be no greater than `floor(AUTH_ARGON2_MEMORY_BUDGET_MIB / 64)`. Queue overflow is a typed overload result, not an unbounded Promise backlog.

- [ ] **Step 4: Add a benchmark command and Node engine floor**

Set `engines.node` to `>=24.8.0`, refresh lockfile engine metadata, and add `auth:benchmark-password`. The script accepts sample, warmup, concurrency, and queue-saturation options. It reports median, p95, min, max, peak RSS, event-loop delay, overflow rejection, policy, Node version, platform, and timestamp as JSON. It exits nonzero when single-request median is outside 100 to 500 ms, peak RSS exceeds the declared budget, or overload fails to reject.

- [ ] **Step 5: Run tests and benchmark**

```bash
npm --prefix api test -- auth/password-hasher.spec.ts auth/argon2-work-limiter.spec.ts --runInBand
npm --prefix api run auth:benchmark-password -- --samples=5 --warmup=1 --concurrency=2 --saturate-queue
```

Expected: tests PASS and benchmark emits valid JSON. If the median is outside the range, record the measurement and adjust only through a design amendment.

- [ ] **Step 6: Commit the password boundary**

```bash
git add api/package.json api/package-lock.json api/src/auth/auth.constants.ts api/src/auth/password-hasher.ts api/src/auth/password-hasher.spec.ts api/src/auth/argon2-work-limiter.ts api/src/auth/argon2-work-limiter.spec.ts api/scripts/benchmark-password-hash.ts
git commit -m "feat(auth): add benchmarked Argon2id password hashing"
```

---

### Task 2: Add secret derivation, cookie, Origin, and request-ID primitives

**Files:**

- Create: `api/src/auth/auth-token.ts`
- Create: `api/src/auth/auth-token.spec.ts`
- Create: `api/src/auth/auth-cookie.ts`
- Create: `api/src/auth/auth-cookie.spec.ts`
- Create: `api/src/auth/origin.guard.ts`
- Create: `api/src/auth/origin.guard.spec.ts`
- Create: `api/src/auth/client-address.resolver.ts`
- Create: `api/src/auth/client-address.resolver.spec.ts`
- Create: `api/src/auth/request-id.middleware.ts`
- Modify: `api/src/cors-options.ts`
- Modify: `api/src/cors-options.spec.ts`

- [ ] **Step 1: Write failing crypto and cookie-policy tests**

Assert 32 random bytes produce a base64url session token; only its 32-byte SHA-256 digest is returned for persistence; verification tokens round-trip as `v1.<uuid>.<secret>` from a versioned HMAC pepper; malformed versions, UUIDs, and secret grammars are rejected; and rate-limit subject HMACs are domain-separated by action.

Assert production uses `__Host-studytube_session` with HttpOnly, Secure, SameSite Lax, Path `/`, no Domain, and a seven-day Max-Age. Assert the 10-minute enrollment cookie uses the separate exact name `__Host-studytube_enrollment`. Assert development uses non-Host names without Secure. Cookie parsing matches the exact name and base64url grammar and never accepts a Bearer header.

- [ ] **Step 2: Write failing Origin and CORS tests**

Test safe GET, exact allowed Origin, missing Origin, `null`, malformed values, suffix lookalikes, a second origin, non-JSON unsafe bodies, bodyless logout, OPTIONS, and exact credentialed CORS. Test request IDs are generated when absent and reject unsafe or oversized incoming values.

Test direct IPv4, IPv6, IPv4-mapped IPv6, a forged forwarded header from a non-loopback peer, exactly one forwarded address from a loopback peer, multiple forwarded hops, malformed values, and production proxy trust enabled before loopback-only binding is declared.

- [ ] **Step 3: Run and confirm focused failures**

```bash
npm --prefix api test -- auth/auth-token.spec.ts auth/auth-cookie.spec.ts auth/origin.guard.spec.ts auth/client-address.resolver.spec.ts cors-options.spec.ts --runInBand
```

Expected: FAIL because the primitives do not exist and CORS is not credential-enabled.

- [ ] **Step 4: Implement the primitives without logging secrets**

Use `randomBytes`, `randomUUID`, `createHash`, `createHmac`, and `timingSafeEqual`. Cookie parsing must split pairs at the first `=` and accept only one exact cookie name. `OriginGuard` compares parsed `URL.origin` values for equality and requires `application/json` whenever an unsafe request has a body. `ClientAddressResolver` trusts exactly one forwarded address only behind a loopback direct peer and canonicalizes the result before HMAC. Update CORS to one exact configured origin with `credentials: true`.

- [ ] **Step 5: Run the focused suite**

```bash
npm --prefix api test -- auth/auth-token.spec.ts auth/auth-cookie.spec.ts auth/origin.guard.spec.ts auth/client-address.resolver.spec.ts cors-options.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit HTTP security primitives**

```bash
git add api/src/auth api/src/cors-options.ts api/src/cors-options.spec.ts
git commit -m "feat(auth): define cookie and origin security policy"
```

---

### Task 3: Add the irreversible digest-only authentication schema

**Files:**

- Create: `api/migrations/1753660802000_auth-hardening.cjs`
- Modify: `api/src/migration-files.spec.ts`
- Modify: `api/scripts/verify-migration-adoption.ts`
- Modify: `api/scripts/verify-demo-seed.ts`
- Modify: `api/scripts/seed-demo.ts`
- Test: `api/src/concurrent-index-migration.spec.ts`
- Modify: `.github/workflows/ci-cd.yml`
- Modify: `scripts/deploy-ec2.sh`
- Modify: `api/src/deploy-script.spec.ts`

- [ ] **Step 1: Add failing migration shape tests**

Require the migration to:

- run the exact application canonicalization order for legacy email: reject non-ASCII and controls, trim ASCII space bytes, validate grammar, lowercase, then report collisions before adding a unique constraint
- add `email_canonical`, `password_algorithm`, `password_parameters`, `password_version`, `identity_assurance`, and `email_verified_at`
- backfill canonical email with invalid-row and collision failure; tag only 64-character lowercase hexadecimal hashes as `legacy_sha256`, tag the exact `disabled:demo-seed-login` marker as `disabled`, and abort on any unknown password representation
- mark every migrated user `legacy_grandfathered` without claiming email verification
- drop and recreate `sessions` without a raw `token` column
- create session expiry and revocation columns without reusable reauthentication grants
- create `pending_registrations`, `auth_rate_limits`, and `verification_email_outbox`
- store pending verification and enrollment digests, immutable email-rendering inputs, payload hash, and claim-specific lease token
- create unique digest and idempotency constraints plus claim indexes
- refuse a destructive down migration with an explicit error

- [ ] **Step 2: Run the migration tests and observe failure**

```bash
npm --prefix api test -- migration-files.spec.ts concurrent-index-migration.spec.ts deploy-script.spec.ts --runInBand
```

Expected: FAIL because the auth migration is absent.

- [ ] **Step 3: Implement the migration**

Use application-supplied UUID columns, `BYTEA` digests, check constraints for attempt counts and expiry ordering, foreign keys with appropriate cascade behavior, and a partial index for claimable outbox rows. Replace the non-unique legacy lowercase index with an exact unique `email_canonical` constraint only after validating and backfilling with the same ordered printable-ASCII, ASCII-space trim, grammar, and lowercase algorithm used by the application. Do not mutate either baseline migration.

- [ ] **Step 4: Extend fresh and adopted-schema verification**

The adoption verifier must prove legacy user IDs and board data remain, existing users are explicitly grandfathered rather than verified, hexadecimal hashes become `legacy_sha256`, the demo marker becomes `disabled`, unknown hash formats abort, legacy sessions are gone, a new digest session can be inserted, and no raw secret column remains in `sessions` or `pending_registrations`. Add invalid non-ASCII, control-character, surrounding-space, and trim-induced collision fixtures. Update demo seed to write password hash, algorithm, parameters, assurance, and canonical email consistently.

Replace CI's unconditional latest-migration down rehearsal. Keep rollback/reapply testing only for the earlier concurrent-index migration in a disposable database; the auth cutover is intentionally irreversible. Add a deploy-script preflight that refuses to apply the auth migration to a production-like database without an explicit verified-backup marker. This branch remains non-deployable until `#11` performs that preflight.

- [ ] **Step 5: Run migration verification against PostgreSQL**

```bash
npm --prefix api run db:migrate:up
npm --prefix api run db:migrate:status
npm --prefix api test -- migration-files.spec.ts concurrent-index-migration.spec.ts deploy-script.spec.ts --runInBand
npm --prefix api run db:migrate:setup-legacy-fixture
npm --prefix api run db:migrate:test-adoption
```

Expected: fresh and adopted migrations PASS, while the migration unit test proves the auth down function rejects with the documented irreversible-cutover error. CI no longer executes latest-down against the auth migration.

- [ ] **Step 6: Commit the schema cutover**

```bash
git add api/migrations/1753660802000_auth-hardening.cjs api/src/migration-files.spec.ts api/src/concurrent-index-migration.spec.ts api/src/deploy-script.spec.ts api/scripts/verify-migration-adoption.ts api/scripts/verify-demo-seed.ts api/scripts/seed-demo.ts .github/workflows/ci-cd.yml scripts/deploy-ec2.sh
git commit -m "feat(auth): migrate credentials to digest-only storage"
```

---

### Task 4: Implement atomic rate limits and pre-hijacking-safe enrollment transactions

**Files:**

- Create: `api/src/auth/auth.types.ts`
- Create: `api/src/auth/auth.repository.ts`
- Create: `api/src/auth/auth.service.ts`
- Create: `api/src/auth/auth.service.spec.ts`
- Modify: `api/src/database.service.ts`
- Modify: `api/src/database.service.spec.ts`

- [ ] **Step 1: Define the auth repository port and fake-repository test fixture**

The port must use command/result objects rather than exposing `pg` types. Include methods for atomic rate consumption, auth-user lookup, pending registration creation, verification consume, registration completion, login commit compare-and-set, session lookup/touch, revoke, sensitive account update, and password replacement. Split worker claim/ack/retry methods into the separate outbox port in Task 6, but keep shared row types in `auth.types.ts`.

Public user types must never contain password metadata or a credential. Stored-user types must be confined to the auth module.

- [ ] **Step 2: Write failing service tests for enumeration and verification**

Cover:

```ts
it('returns the same signup acceptance for pending, existing, and raced emails');
it('accepts only email and performs no Argon2 work before email proof');
it('creates no user and stores no password during signup or resend');
it('returns the same resend acceptance for absent and existing users');
it('consumes one valid verification into one digest-only enrollment grant');
it('completes a verified enrollment by selecting name and password once');
it('rejects attacker pre-registration because no password exists before proof');
it('allows only one of two verified pending registrations to create the email account');
it('increments rate limits before expensive work and returns Retry-After metadata');
it('uses fake clock and sleeper to keep acceptance timing in the configured bucket');
```

Use deterministic fake UUID, clock, HMAC pepper, hasher, and sleeper dependencies. No test may wait for real timing.

- [ ] **Step 3: Write failing database transaction tests**

Mock `PoolClient` calls and assert:

- rate limit is one `INSERT ... ON CONFLICT ... attempts + 1 RETURNING`
- signup begins, checks account existence, inserts pending registration and immutable outbox payload metadata, then commits without touching users or Argon2
- resend follows the same generic pending-registration contract
- verification consume rejects malformed or unresolved token identities before mutation; for a well-formed target it locks the pending row, validates digest and attempts, installs an enrollment digest and expiry, then commits
- a wrong secret atomically increments `attempt_count` and commits only that failed-attempt state so `max_attempts` is enforceable; expired, exhausted, and consumed proofs make no mutation and roll back, and no failure path creates a user
- completion locks the pending row, validates the enrollment digest, inserts the canonical verified user and first digest session, marks completion, then commits; this is the pending-registration → user insert → first-session lock family
- SQLSTATE `23505` on the user insert rolls back and returns a consumed/conflict result without leaking database detail or creating a session

- [ ] **Step 4: Run focused tests and confirm failure**

```bash
npm --prefix api test -- auth/auth.service.spec.ts database.service.spec.ts --runInBand
```

Expected: FAIL on missing port, service, and SQL methods.

- [ ] **Step 5: Implement fail-closed PostgreSQL methods**

Add `DatabaseService` methods that do not call its memory fallback. Normalize `23505` to a typed result and map other failures to a sanitized internal exception. Use explicit `BEGIN`, `COMMIT`, and guarded `ROLLBACK`. Compute fixed-window boundaries from PostgreSQL time. Never include email, password, token, SQL parameters, or the original PostgreSQL error object in a user-facing exception.

Verification consume compares the supplied digest in application code with `timingSafeEqual` after locking the pending row, then installs a new enrollment digest while the lock is held. Registration completion performs Argon2 only after rate admission and email proof, then locks pending registration before the unique user insert and first session insert.

- [ ] **Step 6: Implement AuthService signup, resend, and consume**

Canonicalize ASCII email once, consume both email and resolved-IP rate-limit subjects, run the enumeration-reducing timing policy in `finally`, and return only stable domain results. Insert raw-token-free commands into the repository: pending UUID, verification digest, key version, recipient, expiry, immutable render inputs, payload hash, and deterministic outbox key.

Consume returns an internal raw enrollment token only for immediate HttpOnly cookie serialization. Completion accepts that cookie plus name and password only, never an email or pending ID, runs hashing through `Argon2WorkLimiter`, resolves the pending row exclusively from the cookie digest, and returns an internal raw session token only for immediate cookie serialization.

- [ ] **Step 7: Run focused tests**

```bash
npm --prefix api test -- auth/auth.service.spec.ts database.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 8: Commit signup and verification transactions**

```bash
git add api/src/auth/auth.types.ts api/src/auth/auth.repository.ts api/src/auth/auth.service.ts api/src/auth/auth.service.spec.ts api/src/database.service.ts api/src/database.service.spec.ts
git commit -m "feat(auth): add verified pending registration enrollment"
```

---

### Task 5: Implement login retry, session lifecycle, and atomic account rotation

**Files:**

- Modify: `api/src/auth/auth.service.ts`
- Modify: `api/src/auth/auth.service.spec.ts`
- Modify: `api/src/database.service.ts`
- Modify: `api/src/database.service.spec.ts`

- [ ] **Step 1: Write failing AuthService session tests**

Cover:

```ts
it('runs dummy Argon2 verification and returns the generic 401 for an absent user');
it('rejects an invalid assurance state without creating a session');
it('upgrades legacy SHA-256 and inserts a digest session in one winning transaction');
it('retries once when a concurrent login already upgraded the same valid password');
it('rejects when a concurrent password change wins the compare-and-set');
it('never returns a raw token in the login body');
it('returns a principal for an active session and touches only after 15 minutes');
it('rejects revoked, idle-expired, and absolute-expired sessions');
it('revokes the current session on logout');
it('requires current password in the same request as a name or password change');
it('rotates password and session while revoking every prior session');
it('retries an account update after a concurrent same-password legacy upgrade');
it('rejects an account update after a concurrent password change wins');
it('allows preference-only updates without current-password proof');
```

- [ ] **Step 2: Write failing SQL and lock-order tests**

Require login commit to lock user, compare verified hash and version, optionally update the PHC hash, verify email state, and insert the digest session in one transaction. Return `stale` instead of throwing when compare-and-set loses.

Require session lookup to filter all expiry and revocation conditions and use one capped atomic touch. Require a sensitive account update to compare the hash and version that were just verified, lock user, lock current session, update name or password/version, revoke all sessions for password change, insert the replacement digest session, and commit in that order.

- [ ] **Step 3: Run and observe failures**

```bash
npm --prefix api test -- auth/auth.service.spec.ts database.service.spec.ts --runInBand
```

Expected: FAIL on missing session use cases and repository methods.

- [ ] **Step 4: Implement the bounded login loop**

Keep Argon2 outside database locks. On `stale`, refetch and verify once more. A concurrent same-password upgrade may succeed on retry; a concurrent password change must fail the new verification. Generate a fresh session token and digest for each commit attempt, discard material from a lost attempt, and expose the raw token only in the internal login result consumed immediately by the controller.

- [ ] **Step 5: Implement lifecycle and account-control transactions**

Use database time for expiry decisions. Touch idle expiry with `LEAST`. Keep revoked rows for audit. Store only a bounded revocation enum. Submit current password in the same use case, verify through the work limiter outside locks, and compare hash plus `password_version` after locking. Password change returns a replacement raw token only to the immediate HTTP boundary.

- [ ] **Step 6: Run the focused suite**

```bash
npm --prefix api test -- auth/auth.service.spec.ts database.service.spec.ts --runInBand
```

Expected: PASS, including the two-login upgrade retry and password-change winner cases.

- [ ] **Step 7: Commit session lifecycle work**

```bash
git add api/src/auth/auth.service.ts api/src/auth/auth.service.spec.ts api/src/database.service.ts api/src/database.service.spec.ts
git commit -m "feat(auth): add race-safe cookie session lifecycle"
```

---

### Task 6: Add idempotent verification email delivery and crash recovery

**Files:**

- Create: `api/src/email/verification-email-sender.ts`
- Create: `api/src/email/capture-verification-email.sender.ts`
- Create: `api/src/email/capture-verification-email.sender.spec.ts`
- Create: `api/src/email/resend-verification-email.sender.ts`
- Create: `api/src/email/resend-verification-email.sender.spec.ts`
- Create: `api/src/email/verification-email-outbox.repository.ts`
- Create: `api/src/email/email-outbox.worker.ts`
- Create: `api/src/email/email-outbox.worker.spec.ts`
- Create: `api/src/email/email.module.ts`
- Modify: `api/src/database.service.ts`
- Modify: `api/src/database.service.spec.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Write failing sender contract tests**

The capture adapter must atomically converge on one file per idempotency key and return the same provider message ID for an identical retry. Reusing a key with a different recipient, subject, or body must fail terminally. Test every immutable template version as a golden canonical payload.

The Resend adapter test injects fake `fetch` and asserts exact URL, sending-only Bearer key, JSON payload, timeout signal, and `Idempotency-Key`. Map 408, 409 concurrent request, 429, and 5xx to retryable failures; map authentication, invalid sender, invalid key reuse, and other validation failures to terminal sanitized codes. Never expose the response body or API key in thrown messages.

- [ ] **Step 2: Write failing worker and repository tests**

Cover empty polling, active pending-registration filtering, `FOR UPDATE SKIP LOCKED` claim, fresh lease token per claim, send outside the transaction, success acknowledgement, bounded exponential retry, terminal failure, lease loss, verification expiry or consumption, max attempts, and shutdown. Shutdown must stop new claims immediately and await an in-flight send only up to the configured send timeout. Add the critical crash test: send succeeds, acknowledgement is withheld, lease expires, retry uses the same key and payload, and the fake provider records one delivery. Also test a late response with the old lease token, same worker reclaim, and a template deployment between attempts.

- [ ] **Step 3: Run and observe failures**

```bash
npm --prefix api test -- email --runInBand
```

Expected: FAIL because sender and worker modules do not exist.

- [ ] **Step 4: Implement outbox SQL methods**

Claim in a short transaction with a fresh UUID lease token and lease expiry. Return pending UUID, key version, recipient, expiry, idempotency key, sender, public origin, locale, subject, immutable template version, and payload hash, never a raw token. Ack and retry updates must include `WHERE id = $id AND lease_token = $token AND lease_expires_at > now()` so a stale or same-name worker cannot overwrite a new claim.

- [ ] **Step 5: Implement adapters and worker**

Reconstruct the verification token and fragment URL only immediately before sending. Render only through the stored immutable template version, escape every interpolated HTML value, hash the canonical payload, and refuse mismatches before provider I/O. Stop retries before the provider's 24-hour idempotency window. Validate provider timeout plus margin is shorter than the lease. Use unref'd timers where appropriate and stop claiming during module destruction.

- [ ] **Step 6: Wire environment-specific provider selection**

`EMAIL_PROVIDER=capture|resend`; production rejects capture and missing `PUBLIC_WEB_URL`, `EMAIL_FROM`, or `RESEND_API_KEY`. Test defaults to capture. Add `tmp/email-capture/` to `.gitignore`.

- [ ] **Step 7: Run sender, worker, database, and canary tests**

```bash
npm --prefix api test -- email database.service.spec.ts --runInBand
```

Expected: PASS and captured logs contain none of the password, token, verification URL, or provider-key canaries.

- [ ] **Step 8: Commit durable email delivery**

```bash
git add .gitignore api/src/email api/src/database.service.ts api/src/database.service.spec.ts
git commit -m "feat(auth): deliver verification email through an idempotent outbox"
```

---

### Task 7: Expose a validated cookie-only auth HTTP contract

**Files:**

- Create: `api/src/auth/auth.dto.ts`
- Create: `api/src/auth/auth.controller.ts`
- Create: `api/src/auth/auth.controller.spec.ts`
- Create: `api/src/auth/public.decorator.ts`
- Create: `api/src/auth/current-principal.decorator.ts`
- Create: `api/src/auth/session.guard.ts`
- Create: `api/src/auth/session.guard.spec.ts`
- Create: `api/src/auth/auth-exception.filter.ts`
- Create: `api/src/auth/auth-exception.filter.spec.ts`
- Create: `api/src/auth/auth.module.ts`
- Create: `api/src/configure-application.ts`
- Create: `api/src/main.spec.ts`
- Modify: `api/src/study-board.controller.ts`
- Modify: `api/src/app.module.ts`
- Modify: `api/src/main.ts`

- [ ] **Step 1: Write failing DTO, controller, cookie, and error tests**

Assert signup and resend always return the fixed 202 body; consume returns 204 with an enrollment Set-Cookie but no JSON credential; `GET /auth/registrations/current` returns only `{ status: 'ready' }` for a valid enrollment cookie and 401 for an absent, expired, or invalid cookie; completion accepts only name and password with the enrollment cookie, rejects email or pending-ID fields, resolves identity only from the cookie digest, returns `{ user }`, clears enrollment, and sets the first session cookie; login is 200 with `{ user }`; logout is 204 and clears the cookie; `/me` uses the principal; password change sets a replacement cookie; and no response JSON contains `token`.

Assert invalid DTOs are rejected by a global transform-and-whitelist `ValidationPipe`. Assert the exception filter emits `{ code, message, requestId }`, maps unknown errors to a generic 500, and never serializes database detail or a canary.

- [ ] **Step 2: Write failing guard tests**

Cover public metadata, absent cookie, malformed cookie, invalid digest session, active session, decorator extraction, and a database failure that returns 503 rather than falling back to memory. Explicitly prove Authorization headers are ignored.

- [ ] **Step 3: Run and observe failures**

```bash
npm --prefix api test -- auth/auth.controller.spec.ts auth/session.guard.spec.ts auth/auth-exception.filter.spec.ts --runInBand
```

Expected: FAIL because the HTTP module is absent.

- [ ] **Step 4: Implement controller and module**

Move `/auth/signup` and `/auth/login` out of `StudyBoardController`. Add resend, consume, enrollment-cookie validation, registration completion, logout, `/me`, and update-me endpoints. Resolve canonical source IP through `ClientAddressResolver`; do not pass Express request or response objects into the domain service. Set and clear enrollment and session cookies only in the controller through `AuthCookiePolicy`.

- [ ] **Step 5: Configure global validation, request ID, filter, and guards**

Create `configureApplication(app)` for loopback-only proxy trust, validation, CORS, and the global exception filter. Call it from `main.ts` and every E2E bootstrap. Call `app.enableShutdownHooks()` in `main.ts`, add a bootstrap/static test for that call, and prove the outbox worker stops claiming then drains only up to its configured send timeout when application shutdown is triggered. Register request-ID middleware through the module so it runs before guards. Do not register `SessionGuard` globally until Task 8 has marked every route. Register `OriginGuard` globally now and update every existing unsafe controller test to send the exact test Origin.

- [ ] **Step 6: Run API unit tests and build**

```bash
npm --prefix api test -- --runInBand
npm --prefix api run build
```

Expected: PASS with existing auth endpoints removed from `StudyBoardController` and no Bearer-compatible auth route exposed.

- [ ] **Step 7: Commit the HTTP auth boundary**

```bash
git add api/src/auth api/src/configure-application.ts api/src/study-board.controller.ts api/src/app.module.ts api/src/main.ts api/test
git commit -m "feat(auth): expose validated cookie authentication endpoints"
```

---

### Task 8: Make authorization guard-driven across the API

**Files:**

- Modify: `api/src/study-board.types.ts`
- Modify: `api/src/study-board.service.ts`
- Modify: `api/src/study-board.service.spec.ts`
- Modify: `api/src/memory-board.repository.ts`
- Modify: `api/src/study-board.controller.ts`
- Modify: `api/src/ai.controller.ts`
- Modify: `api/src/video-asset.controller.ts`
- Modify: `api/src/app.controller.ts`
- Modify: `api/src/app.module.ts`
- Modify: `api/src/study-board.policy.ts`
- Modify: `api/src/study-board.policy.spec.ts`

- [ ] **Step 1: Add failing static and controller authorization tests**

Assert:

- no controller reads `Authorization`
- no service accepts a token string to establish identity
- no public `Session` type contains a token
- memory fallback state contains no auth session or raw credential collection
- `/health`, `/health/live`, secret-free `/health/ready`, and explicit explore reads are `@Public()` while detailed `/health/ai` and `/health/db` require a session
- every private board, AI, caption, summary, agent, and video-asset route is rejected without a cookie principal
- owner checks still reject a different authenticated user
- global `SessionGuard` defaults to protected when `@Public()` is absent
- `GET /explore/playlists` is always public while `GET /playlists` is always authenticated; no query parameter switches policy

- [ ] **Step 2: Run focused tests and observe failure**

```bash
npm --prefix api test -- study-board.service.spec.ts study-board.policy.spec.ts auth/session.guard.spec.ts --runInBand
```

Expected: FAIL because board methods and controllers still use Bearer token strings.

- [ ] **Step 3: Refactor service identity parameters**

Replace token parameters with `AuthenticatedActor = { userId: number }` or a numeric owner ID. Remove auth signup, login, `requireSession`, `normalizeBearerToken`, and raw session repository methods from the board module. Remove the memory repository's auth methods and persisted sessions collection. Rewrite test setup to seed users directly and create actors without creating credentials.

Object-level ownership remains in `StudyBoardService` and repository queries. Public read methods take no actor and must not branch on an optional cookie.

- [ ] **Step 4: Refactor controllers and classify routes**

Use `@CurrentPrincipal()` on protected handlers and pass `{ userId: principal.userId }`. Split mixed playlist scope into public `GET /explore/playlists` and authenticated `GET /playlists`. Mark `/health`, `/health/live`, a secret-free `/health/ready`, signup/login/verification/enrollment-cookie validation/enrollment completion, and intentionally public explore reads with `@Public()`. Keep detailed `/health/ai` and `/health/db` protected. Update the deployment script to probe `/health/ready` and the AI process's loopback health endpoint directly rather than calling the protected API diagnostic route.

- [ ] **Step 5: Register global SessionGuard and remove Bearer policy**

Register `APP_GUARD` after OriginGuard. Delete `normalizeBearerToken` and raw session token helpers. A repository search must show no production `Authorization` or `Bearer` logic except the Resend adapter's outbound provider authorization.

- [ ] **Step 6: Run the complete API unit suite and build**

```bash
npm --prefix api test -- --runInBand
npm --prefix api run build
rg -n "normalizeBearerToken|session\.token|Authorization.*Bearer|@Headers\(['\"]authorization" api/src
```

Expected: tests and build PASS; the source scan returns no inbound credential handling.

- [ ] **Step 7: Commit guard-driven authorization**

```bash
git add api/src
git commit -m "refactor(auth): enforce identity through session guards"
```

---

### Task 9: Replace the web token API and preserve account-scoped local data

**Files:**

- Modify: `web/src/types.ts`
- Modify: `web/src/api.ts`
- Modify: `web/src/authSession.ts`
- Modify: `web/src/localStudyStorage.ts`
- Modify: `web/src/watchQueueStorage.ts`
- Create: `web/tests/api.test.ts`
- Modify: `web/tests/authSession.test.ts`
- Modify: `web/tests/localStudyStorage.test.ts`
- Modify: `web/tests/watchQueueStorage.test.ts`
- Modify: `web/tests/apiBaseUrl.test.ts`

- [ ] **Step 1: Write failing API-facade tests**

Inject fake `fetch` and assert:

- public reads use `credentials: 'omit'`
- session-setting and session-required calls use `credentials: 'include'`
- no function accepts a token or creates Authorization
- login returns `User`, logout handles 204, and signup returns acceptance
- verification consume handles the enrollment Set-Cookie through credentials and registration completion returns `User`
- public playlists call `/explore/playlists` while private playlists call `/playlists`
- required 401 invokes the centralized expiry callback
- login and public-read 401 do not invoke the expiry callback
- production defaults to same-origin `/api` and development uses the configured local base URL

- [ ] **Step 2: Replace storage tests with one-way legacy migration tests**

Cover valid legacy user ID extraction, invalid JSON, invalid IDs, removal even when parsing fails, absence of the canary token in every resulting value, server-user override, logout marker clearing, and preservation of user-scoped queue and draft keys.

Change storage helpers to accept an explicit `ownerId: number | null`; never infer current authority from a stored session object. Prove user 42 cannot read user 43 or anonymous data and no automatic merge occurs.

- [ ] **Step 3: Run and observe failures**

```bash
node --test web/tests/api.test.ts web/tests/authSession.test.ts web/tests/localStudyStorage.test.ts web/tests/watchQueueStorage.test.ts web/tests/apiBaseUrl.test.ts
```

Expected: FAIL because the facade and storage still depend on Bearer sessions.

- [ ] **Step 4: Implement the request policy and legacy migration**

Define `RequestAuth = 'public-read' | 'session-setting' | 'session-required'`. Add `credentials` centrally, parse 204 without JSON, keep errors stable, and notify one injected expiry handler only for required requests.

Replace `Session` with authenticated user state. `migrateLegacySessionOwner` must use `try/finally` so `studytube.session` is removed even after malformed input or storage write failure. Store only a positive safe integer owner ID.

- [ ] **Step 5: Run web storage and API tests**

```bash
node --test web/tests/api.test.ts web/tests/authSession.test.ts web/tests/localStudyStorage.test.ts web/tests/watchQueueStorage.test.ts web/tests/apiBaseUrl.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit token-free web foundations**

```bash
git add web/src/types.ts web/src/api.ts web/src/authSession.ts web/src/localStudyStorage.ts web/src/watchQueueStorage.ts web/tests
git commit -m "feat(web): remove browser token persistence"
```

---

### Task 10: Rebuild the React authentication, verification, and logout flow

**Files:**

- Modify: `web/src/App.tsx`
- Modify: `web/src/onboarding.ts`
- Create: `web/src/authFlow.ts`
- Create: `web/tests/authFlow.test.ts`
- Modify: `web/tests/onboarding.test.ts`
- Modify: static source and accessibility tests that assert old token flows

- [ ] **Step 1: Extract and test the auth state machine**

Write failing pure tests for:

- boot begins `checking`, migrates legacy owner, and awaits `/me`
- `/me` success confirms server user before private mount
- `/me` 401 becomes anonymous without exposing an old owner
- a server user different from the legacy owner never merges drafts
- a stale response from an earlier auth generation is ignored
- logout success or 401 clears active identity and broadcasts
- logout network failure keeps authenticated state and reports retry
- another-tab logout advances the generation and clears identity
- verification consume transitions to enrollment without creating authenticated state
- registration completion transitions from enrollment to the server user
- page reload calls `GET /auth/registrations/current` and resumes enrollment only after its ready response, without a JavaScript token

- [ ] **Step 2: Add failing onboarding and verification tests**

Signup asks only for email and routes to a generic check-email state without creating a user or session. Verification reads only a fragment token, calls `history.replaceState` before the consume request, rejects an external `next` destination, and routes to the name/password completion form backed by the HttpOnly enrollment cookie. Reload validates that cookie through `GET /auth/registrations/current`; the UI does not render name or password fields until the server returns ready. Completion sends no email or pending ID, creates the authenticated user, and continues to first-login tutorial routing from server preferences.

- [ ] **Step 3: Run and observe failures**

```bash
node --test web/tests/authFlow.test.ts web/tests/onboarding.test.ts
```

Expected: FAIL because the state machine and verification flow are absent.

- [ ] **Step 4: Integrate cookie boot and centralized 401 handling**

App state is `checking`, `anonymous`, or `authenticated`. Do not mount private routes, queues, drafts, or owner-specific effects during `checking`. Remove every `session.token` prop and API argument. Rehydrate drafts whenever the confirmed user ID changes.

Use `BroadcastChannel` with a storage-event fallback for logout. Disable duplicate logout clicks. Preserve the current path for re-login without accepting external URLs.

- [ ] **Step 5: Replace router-state password handling**

Remove the separate password-verification route and any password in React Router state. The sensitive profile form submits `currentPassword` in the same request as name or new password. Do not trim current or new passwords. Preference-only updates omit current password.

- [ ] **Step 6: Add check-email and fragment verification UI**

Use the fixed generic signup message for every accepted request. Do not echo an email-existence error. Verification token values must never enter React state longer than the single consume call, localStorage, telemetry, or visible URLs after initial parsing. Name and password fields are not rendered before the enrollment cookie exists, closing the pre-hijacking path found during design review.

- [ ] **Step 7: Run all web tests, lint, and build**

```bash
node --test web/tests/*.test.ts
npm --prefix web run lint
npm --prefix web run build
rg -n "session\.token|Authorization|Bearer|studytube\.session" web/src web/dist
```

Expected: tests, lint, and build PASS. The scan may find `studytube.session` only in the one-way migration constant and must find no token or Bearer construction.

- [ ] **Step 8: Commit the React auth flow**

```bash
git add web/src web/tests
git commit -m "feat(web): boot authentication from secure cookie sessions"
```

---

### Task 11: Prove PostgreSQL and HTTP race invariants end to end

**Files:**

- Create: `api/test/auth.e2e-spec.ts`
- Create: `api/test/auth-races.e2e-spec.ts`
- Modify: `api/test/app.e2e-spec.ts`
- Modify: `api/test/jest-e2e.json` only if test timeout needs one explicit increase

- [ ] **Step 1: Build a reusable cookie and Origin E2E harness**

Use Supertest agents for session and enrollment cookie jars, exact `Origin: http://localhost:5173` on unsafe requests, the shared `configureApplication(app)` bootstrap, direct PostgreSQL inspection through a test pool, and capture-email lookup by idempotency key. Never parse a credential from JSON.

- [ ] **Step 2: Write failing HTTP security tests**

Cover uniform email-only signup, pending registration with no user/password row, consume-to-enrollment, name/password completion, session cookie attributes in production mode, no token in response, `/me`, logout revocation, absolute and idle expiry, password-change rotation, missing and wrong Origin, wrong content type, DTO whitelist, exact error shape, trusted-proxy address handling, and rate-limit persistence after rebuilding the Nest app.

- [ ] **Step 3: Write failing deterministic race tests**

Use PostgreSQL advisory locks or explicit row/table lock barriers and polling of `pg_stat_activity`; do not rely on arbitrary sleeps. Cover duplicate signup acceptance, concurrent verification consume, competing verified-registration completion, the attacker pre-registration regression, two valid legacy logins, both login/password-change queue orders, concurrent password changes, logout/request linearization, renewal cap, concurrent rate increments on two Nest instances, and outbox crash recovery with old lease-token rejection.

- [ ] **Step 4: Run and observe the intended failures**

```bash
npm --prefix api run test:e2e -- auth.e2e-spec.ts auth-races.e2e-spec.ts --runInBand
```

Expected: new assertions fail until any missing transaction or HTTP details are corrected.

- [ ] **Step 5: Correct only behavior exposed by the E2E failures**

Keep the operation-specific lock families: pending registration → user insert → first session for new-account completion, and user → current session → related sessions for existing-account changes. Verification consume locks only its pending row, while the outbox worker locks only outbox rows. Do not fix races with process-local mutexes or extra timing sleeps. Add database constraints or transaction compare-and-set conditions at the linearization point.

- [ ] **Step 6: Add digest-only and log-canary assertions**

Query schema and rows to prove there is no raw session or verification token column and that password storage is PHC or tagged legacy SHA-256. Capture Nest Logger, stdout, and stderr across success, rejection, unique race, provider failure, and retry. Assert none contains unique password, cookie, verification URL, provider key, or legacy Authorization canaries.

- [ ] **Step 7: Run all API tests and build**

```bash
npm --prefix api test -- --runInBand
npm --prefix api run test:e2e -- --runInBand
npm --prefix api run lint
npm --prefix api run build
```

Expected: PASS.

- [ ] **Step 8: Commit race evidence**

```bash
git add api/test api/src api/scripts
git commit -m "test(auth): prove session and verification race invariants"
```

---

### Task 12: Configure CI, environments, and operator documentation

**Files:**

- Modify: `.env.example`
- Modify: `api/.env.example`
- Modify: `.github/workflows/ci-cd.yml`
- Modify: `docs/environment-setup.md`
- Modify: `docs/ci-cd.md`
- Create: `docs/evidence/auth/README.md`
- Create from command output: `docs/evidence/auth/argon2-benchmark.json`

- [ ] **Step 1: Add failing configuration tests**

Test that production rejects development cookies, capture email, HTTP public URL, short peppers, missing Resend sender/key, an unmaintained Node version, Argon2 concurrency over its memory budget, provider timeout greater than or equal to lease minus margin, and proxy trust before loopback-only binding is declared. Test that test/local defaults are explicit and never inferred from a missing production value. Add a source or bootstrap test proving shutdown hooks remain enabled.

- [ ] **Step 2: Document and configure all variables**

Add separate versioned verification and rate-limit peppers, cookie mode, public web URL, email provider/from/key, worker enabled flag, poll interval, batch size, lease, send timeout, retry maximum, session and enrollment TTLs, Argon2 memory budget/concurrency/queue, loopback-only proxy trust, API bind address, and exact web Origin. Remove the unused `JWT_SECRET` example.

Document local capture, pending enrollment flow, pre-hijacking protection, Resend sending-only key and verified domain, worker lifecycle, rate-limit inspection, forced session revocation, digest-only verification queries, legacy grandfathering, Argon2 memory sizing, and the `#11` maintenance cutover requiring a verified dump. State clearly that Terraform is not used and that this PR must not deploy to the direct-HTTP service.

- [ ] **Step 3: Extend CI**

Set deterministic test peppers, memory budget, loopback proxy policy, and capture provider. Run the concurrent password benchmark, migration adoption, full unit and E2E suites, source secret scans, and web tests/build. Do not activate production email or perform a deployment from a pull request. Keep the earlier concurrent-index rollback rehearsal isolated from the irreversible auth migration.

- [ ] **Step 4: Generate benchmark evidence**

```bash
npm --prefix api run auth:benchmark-password -- --samples=10 --warmup=2 --concurrency=2 --saturate-queue --output=../docs/evidence/auth/argon2-benchmark.json
```

Validate that the JSON contains no hostname, username, path, or secret and that the median meets the accepted policy.

- [ ] **Step 5: Run the CI-equivalent local suite**

```bash
npm --prefix api run db:migrate:status
npm --prefix api run lint
npm --prefix api test -- --runInBand
npm --prefix api run test:e2e -- --runInBand
npm --prefix api run build
npm --prefix web run lint
node --test web/tests/*.test.ts
npm --prefix web run build
```

Expected: PASS.

- [ ] **Step 6: Commit configuration and evidence**

```bash
git add .env.example api/.env.example .github/workflows/ci-cd.yml docs/environment-setup.md docs/ci-cd.md docs/evidence/auth
git commit -m "docs(auth): record secure runtime and benchmark evidence"
```

---

### Task 13: Review, publish the PR, and capture the backend case study

**Files:**

- Modify only files required by valid review findings.
- Do not read, edit, stage, or delete `docs/presentation/studytube-presentation-qna-architecture.md`.

- [ ] **Step 1: Run focused correctness, security, test, and simplicity reviews**

Review the complete `main...HEAD` diff. Prioritize pre-hijacking, authentication bypass, token exposure, Argon2 resource exhaustion, canonical-email mismatch, transaction lock order, expiry math, outbox payload drift and lease loss, proxy address spoofing, provider idempotency assumptions, account-draft isolation, missing negative tests, and unnecessary abstraction. Resolve every valid P0 or P1 issue with a regression test first.

- [ ] **Step 2: Run final verification from a clean process state**

```bash
git status --short --branch
npm --prefix api test -- --runInBand
npm --prefix api run test:e2e -- --runInBand
npm --prefix api run lint
npm --prefix api run build
node --test web/tests/*.test.ts
npm --prefix web run lint
npm --prefix web run build
git diff --check
```

Expected: all checks PASS and only the preserved user-owned presentation file may remain untracked in the original checkout, not this worktree.

- [ ] **Step 3: Push and open the issue-linked PR**

Push `codex/issue-7-auth`. The PR body must link `Closes #7`, describe the corrected pending-enrollment flow, password/session/outbox transaction decisions, include exact verification commands, disclose the legacy-grandfathering risk and that production activation plus real HTTPS browser verification remain in `#11`, and state that Terraform is intentionally absent.

- [ ] **Step 4: Wait for CI and resolve feedback**

Do not merge while required checks are pending or failing. Reproduce failures locally, add regression tests, push fixes, and wait again. Merge only after the diff is reviewed and all checks pass.

- [ ] **Step 5: Publish the Notion development log**

Create a new entry in the existing StudyTube engineering log database. Write it as a decision journal with problem discovery, evidence, competing options, rejected approaches, root causes, transaction and lock decisions, implementation, races found, recovery behavior, measured outcomes, and limitations. Include:

- credential-flow before/after diagram
- rejected pre-hijackable signup flow and corrected pending-registration sequence
- concurrent legacy-login sequence diagram
- outbox crash-window diagram
- Argon2 concurrency, RSS, event-loop, and overload benchmark table
- PostgreSQL digest-only query capture
- CI race-test capture
- browser storage and Network captures showing no token

Link the GitHub issue, PR, merged commit, and source design. Update the Notion hub with the new article link. Do not claim production Secure-cookie proof until `#11` completes the HTTPS browser E2E.
