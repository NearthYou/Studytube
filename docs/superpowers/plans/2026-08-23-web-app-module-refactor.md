# Web App Module Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce `web/src/App.tsx` to a session and application-shell module under 250 lines while preserving the deployed authentication, learning, account, and Course routes.

**Architecture:** Move active pages to feature-owned modules, move routing and navigation to `web/src/app`, then delete retired Board, Explore, post-management, and legacy Watch implementations instead of preserving them behind compatibility exports. Existing API clients and pure domain helpers remain in their current focused modules.

**Tech Stack:** React 19, React Router 8, TypeScript 6, Node test runner, ESLint, Vite

**Spec:** `docs/superpowers/specs/2026-08-23-large-module-refactor-design.md`

## Global Constraints

- Preserve `/`, `/watch`, `/tutorial`, `/courses`, `/me`, `/me/edit`, `/login`, `/signup`, `/signup/verify`, and `/signup/complete` behavior.
- Do not restore `/board`, `/explore`, `/playlists`, or `/me/posts`.
- Do not change HTTP paths, stored session shape, Course contracts, or visible Korean copy.
- Delete retired UI instead of moving it to a legacy module.
- Keep `web/src/App.tsx` at 250 lines or fewer.
- Keep at least 223 Web tests passing.
- Do not modify `docs/presentation`.

---

### Task 1: Extract authentication screens

**Files:**
- Create: `web/src/features/auth/AuthPage.tsx`
- Create: `web/src/features/auth/VerificationPage.tsx`
- Create: `web/src/features/auth/RegistrationCompletionPage.tsx`
- Modify: `web/src/App.tsx`
- Test: `web/tests/authPagesBoundary.test.ts`

**Interfaces:**
- Consumes: `Session`, `AuthMode`, `login`, `signUp`, `consumeEmailVerification`, `completeRegistration`, and existing registration flow helpers.
- Produces: `AuthPage({ mode, onComplete })`, `VerificationPage()`, and `RegistrationCompletionPage({ onComplete })`.

- [ ] **Step 1: Write the failing boundary test**

```ts
assert.equal(existsSync(sourcePath("features/auth/AuthPage.tsx")), true);
assert.match(readFileSync(sourcePath("App.tsx"), "utf8"), /from "\.\/features\/auth\/AuthPage"/);
assert.doesNotMatch(readFileSync(sourcePath("App.tsx"), "utf8"), /function AuthPage/);
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test tests/authPagesBoundary.test.ts`

Expected: FAIL because the feature files do not exist and `App.tsx` still owns the functions.

- [ ] **Step 3: Move the three screens with their local state and handlers**

```ts
export type AuthCompleteHandler = (session: Session) => void;

export function AuthPage({
  mode,
  onComplete,
}: {
  mode: AuthMode;
  onComplete: AuthCompleteHandler;
}) {
  // Existing implementation moves unchanged.
}
```

Each feature file imports its API calls and flow helpers directly. Remove the original function bodies from `App.tsx` and import the new exports.

- [ ] **Step 4: Run auth and registration tests**

Run: `node --test tests/apiAuth.test.ts tests/authFlow.test.ts tests/registration*.test.ts tests/authPagesBoundary.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/App.tsx web/src/features/auth/AuthPage.tsx web/src/features/auth/VerificationPage.tsx web/src/features/auth/RegistrationCompletionPage.tsx web/tests/authPagesBoundary.test.ts
git commit -m "refactor(web): 인증 화면 책임 분리"
```

### Task 2: Extract onboarding and account screens

**Files:**
- Create: `web/src/features/onboarding/TutorialPage.tsx`
- Create: `web/src/features/account/MyPage.tsx`
- Create: `web/src/features/account/MyEditPage.tsx`
- Create: `web/src/features/account/ProfileVerificationForm.tsx`
- Modify: `web/src/App.tsx`
- Test: `web/tests/accountPagesBoundary.test.ts`

**Interfaces:**
- Consumes: `Session`, `User`, existing profile helpers, and cookie-authenticated account API calls.
- Produces: `TutorialPage({ session, onSessionUpdate })`, `MyPage({ session, onSessionUpdate })`, and `MyEditPage({ session, onSessionUpdate })`.

- [ ] **Step 1: Write the failing module ownership test**

```ts
for (const file of ["TutorialPage.tsx", "MyPage.tsx", "MyEditPage.tsx"]) {
  assert.equal(existsSync(resolve(featureRoot, file)), true);
}
assert.doesNotMatch(appSource, /function (TutorialPage|MyPage|MyEditPage|ProfileVerificationForm)/);
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test tests/accountPagesBoundary.test.ts`

Expected: FAIL on missing modules.

- [ ] **Step 3: Move screens without changing verification timing**

```ts
export type SessionUserUpdateHandler = (user: User) => void;

export function MyPage({
  session,
  onSessionUpdate,
}: {
  session: Session;
  onSessionUpdate: SessionUserUpdateHandler;
}) {
  // Existing behavior and messages move unchanged.
}
```

Keep `ProfileVerificationForm` private to `MyEditPage.tsx` unless both account screens call it. Remove original definitions from `App.tsx`.

- [ ] **Step 4: Run account and onboarding tests**

Run: `node --test tests/profile*.test.ts tests/tutorial*.test.ts tests/accountPagesBoundary.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/App.tsx web/src/features/onboarding/TutorialPage.tsx web/src/features/account/MyPage.tsx web/src/features/account/MyEditPage.tsx web/src/features/account/ProfileVerificationForm.tsx web/tests/accountPagesBoundary.test.ts
git commit -m "refactor(web): 온보딩과 계정 화면 분리"
```

### Task 3: Extract the active Course screen

**Files:**
- Create: `web/src/features/course/CoursePage.tsx`
- Modify: `web/src/App.tsx`
- Modify: Course-related tests that currently inspect `App.tsx`
- Test: `web/tests/coursePageBoundary.test.ts`

**Interfaces:**
- Consumes: `Session`, Course API clients, Course discovery helpers, playlist draft storage, and existing Course domain types.
- Produces: `CoursePage({ session }: { session: Session })`.

- [ ] **Step 1: Write the failing Course ownership test**

```ts
assert.equal(existsSync(sourcePath("features/course/CoursePage.tsx")), true);
assert.match(courseSource, /export function CoursePage/);
assert.doesNotMatch(appSource, /function CoursePage/);
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test tests/coursePageBoundary.test.ts`

Expected: FAIL because the Course screen is still in `App.tsx`.

- [ ] **Step 3: Move the complete Course screen and private render helpers**

```ts
export function CoursePage({ session }: { session: Session }) {
  // Existing Course lifecycle, optimistic version, and publication behavior.
}
```

Move only helpers called by `CoursePage`. Leave shared pure helpers in their existing modules. Update source-inspection tests to read `CoursePage.tsx`.

- [ ] **Step 4: Run all Course tests**

Run: `node --test tests/course*.test.ts tests/playlist*.test.ts tests/coursePageBoundary.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/App.tsx web/src/features/course/CoursePage.tsx web/tests/coursePageBoundary.test.ts web/tests/course*.test.ts web/tests/playlist*.test.ts
git commit -m "refactor(web): Course 화면 책임 분리"
```

### Task 4: Replace App with the application shell and delete retired UI

**Files:**
- Create: `web/src/app/AppRoutes.tsx`
- Create: `web/src/app/ProtectedRoute.tsx`
- Create: `web/src/app/SiteNav.tsx`
- Create: `web/src/app/GuardedLink.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/tests/productCutover.test.ts`
- Modify: `web/tests/authenticatedLearningFlow.test.ts`
- Modify: `web/tests/watchAccessibility.test.ts`
- Test: `web/tests/appShellBoundary.test.ts`

**Interfaces:**
- Consumes: active feature page exports and session callbacks.
- Produces: `AppRoutes`, `ProtectedRoute`, `SiteNav`, `GuardedLink`, and the default `App` export.

- [ ] **Step 1: Write the failing application-shell test**

```ts
assert.ok(appSource.split("\n").length <= 250);
assert.doesNotMatch(appSource, /void (BoardPage|ExplorePage|MyPostsPage|HomePage|WatchPage)/);
for (const file of ["AppRoutes.tsx", "ProtectedRoute.tsx", "SiteNav.tsx", "GuardedLink.tsx"]) {
  assert.equal(existsSync(resolve(appRoot, file)), true);
}
```

- [ ] **Step 2: Run the shell test and confirm RED**

Run: `node --test tests/appShellBoundary.test.ts`

Expected: FAIL because `App.tsx` is larger than 250 lines and the app modules do not exist.

- [ ] **Step 3: Implement the shell modules**

```tsx
export function AppRoutes({
  session,
  onAuthComplete,
  onSessionUpdate,
}: AppRoutesProps) {
  return (
    <Routes>
      {/* Preserve the exact active route set from the spec. */}
    </Routes>
  );
}
```

`App.tsx` retains only session ownership, unauthorized-handler registration, logout, user update, and composition of `SiteNav` plus `AppRoutes`. Delete the retired screen implementations and their private YouTube player types, constants, and helpers.

- [ ] **Step 4: Move obsolete source-inspection assertions**

`watchAccessibility.test.ts` must inspect `LearningVideoPlayer.tsx` and `LearningWorkspace.tsx`, not the deleted legacy Watch implementation. `productCutover.test.ts` must inspect `SiteNav.tsx` and `AppRoutes.tsx`.

- [ ] **Step 5: Run all Web verification**

Run: `node --test tests/*.test.ts`

Expected: at least 223 tests pass.

Run: `npm run lint`

Expected: exit 0 with no warnings.

Run: `npm run build`

Expected: exit 0 and a Vite production bundle.

- [ ] **Step 6: Confirm the final module boundaries**

Run: `node -e "const fs=require('fs'); for (const f of ['src/App.tsx','src/app/AppRoutes.tsx']) console.log(f,fs.readFileSync(f,'utf8').split(/\\r?\\n/).length)"`

Expected: `src/App.tsx` is at most 250 lines and no retired page implementation remains.

- [ ] **Step 7: Commit**

```bash
git add web/src/App.tsx web/src/app web/tests/appShellBoundary.test.ts web/tests/productCutover.test.ts web/tests/authenticatedLearningFlow.test.ts web/tests/watchAccessibility.test.ts
git commit -m "refactor(web): 애플리케이션 조립 경계 완성"
```

## Self-review result

- Spec coverage: active auth, onboarding, account, Course, learning routes, shell extraction, retired UI deletion, and Web verification are mapped to Tasks 1 through 4.
- Placeholder scan: no deferred implementation marker remains; each code change is tied to an exact interface and verification command.
- Type consistency: `AuthCompleteHandler` and `SessionUserUpdateHandler` carry `Session` and `User` consistently into `AppRoutes` and `App`.
- Separate follow-up plans remain required for Python core, captions and summaries, MCP gateway, and Python test-file splitting.
