# Board Comments CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the board behave like a discussion board by supporting visible comment creation and comment deletion while preserving existing post CRUD.

**Architecture:** Comments remain embedded on `StudyPost` responses. The API authorizes public comment creation by post existence, and comment deletion by either comment ownership or post ownership. The React board and public explore views reuse one small comments section UI pattern.

**Tech Stack:** NestJS, TypeScript, PostgreSQL via `pg`, in-memory repository fallback, React, Vite.

---

### Task 1: Service Tests

**Files:**
- Modify: `api/src/study-board.service.spec.ts`
- Test: `api/src/study-board.service.spec.ts`

- [ ] **Step 1: Add failing tests for comment permissions**

Add tests that create Ada, Linus, and Grace sessions. Ada creates a post. Linus comments on Ada's post. Linus can delete his own comment. Ada can delete a later Linus comment. Grace cannot delete Linus's comment.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm.cmd --prefix api test -- study-board.service.spec.ts`

Expected before implementation: failure because `deleteComment` does not exist and `addComment` currently requires post ownership.

### Task 2: API and Repository Support

**Files:**
- Modify: `api/src/study-board.types.ts`
- Modify: `api/src/memory-board.repository.ts`
- Modify: `api/src/database.service.ts`
- Modify: `api/src/study-board.service.ts`
- Modify: `api/src/study-board.controller.ts`

- [ ] **Step 1: Add repository contract**

Add `deleteComment(postId: number, commentId: number): Promise<boolean>;` to `BoardRepository`.

- [ ] **Step 2: Implement memory repository deletion**

Find the post, filter `post.comments` by id, and return whether the comment count changed.

- [ ] **Step 3: Implement database deletion**

Run `DELETE FROM comments WHERE post_id = $1 AND id = $2` and return `rowCount > 0`.

- [ ] **Step 4: Update service authorization**

Change `addComment` to require an authenticated session and existing post, not ownership. Add `deleteComment` that loads the post, finds the comment, allows comment author or post author, and throws `ForbiddenException` otherwise.

- [ ] **Step 5: Add controller route**

Add `DELETE /posts/:postId/comments/:commentId` and delegate to `studyBoardService.deleteComment`.

- [ ] **Step 6: Run service tests**

Run: `npm.cmd --prefix api test -- study-board.service.spec.ts`

Expected: all tests in that file pass.

### Task 3: Web API and Comments UI

**Files:**
- Modify: `web/src/api.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/App.css`
- Test: `npm.cmd --prefix web run build`

- [ ] **Step 1: Add `deleteComment` API client**

Add a function that calls `DELETE /posts/:postId/comments/:commentId` with auth.

- [ ] **Step 2: Import and use `addComment`**

Import `addComment` and `deleteComment` in `App.tsx`.

- [ ] **Step 3: Add comment state and handlers**

In `BoardPage`, add a comment draft, create handler, delete handler, and reload selected posts after comment changes.

- [ ] **Step 4: Render comments on selected post**

Show comments, author/date/body, a form, and delete buttons when the current user is the comment author or post author.

- [ ] **Step 5: Build web**

Run: `npm.cmd --prefix web run build`

Expected: TypeScript and Vite build pass.

### Task 4: Integration Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run API test**

Run: `npm.cmd --prefix api test -- study-board.service.spec.ts`

Expected: pass.

- [ ] **Step 2: Run web build**

Run: `npm.cmd --prefix web run build`

Expected: pass.

- [ ] **Step 3: Smoke check running services**

Run: `curl.exe -f -s -o NUL -w "%{http_code}" http://localhost:5173/`

Expected: `200`.
