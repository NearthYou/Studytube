# StudyTube Course Aggregate Migration Design

## Status

- GitHub issue: `#8 Backend domain: migrate playlists to a concurrency-safe course aggregate`
- Branch: `codex/issue-8-course-aggregate`
- Depends on: cookie principal and PostgreSQL migration foundation from `#6` and `#7`
- Follow-up: `#2` owns durable jobs and hybrid retrieval, while `#11` owns the minimum HTTPS boundary

## Problem

The current playlist API returns a `postIds` array and relies on the browser to join posts back into the learning route. Ownership, visibility, lifecycle, ordering, and concurrent edits are spread across controller, service, repository, and browser state instead of being expressed as one domain contract.

The current schema permits every playlist item to use the default position `0`, has no unique position constraint, and deletes an item when its source post is deleted. A second authenticated user can also add an item to another user's playlist because that service path ignores its actor. Last-write-wins updates, retry-created duplicates, and a published empty learning route are all possible.

## Goals

- Replace the playlist array contract with a Course aggregate rooted in PostgreSQL.
- Preserve legacy playlist IDs, owners, creation times, steps, and feedback through an observable backfill.
- Keep step order contiguous and unique after every committed transaction.
- Preserve video snapshots when the source post is deleted.
- Require an expected aggregate version for every owner mutation.
- Make create retries idempotent per owner and reject reuse of a key with a different payload.
- Keep draft and learning state private to the owner while exposing only published snapshots publicly.
- Import user-scoped browser drafts without crossing account boundaries or deleting local data before server acknowledgement.
- Leave the legacy tables intact until rollback through the previous application release is no longer required.

## Non-goals

- Terraform, Kubernetes, RDS migration, and deployment-platform redesign are excluded.
- Background jobs, transactional outbox, hybrid retrieval, progress tracking, and quizzes remain in `#2` and `#3`.
- Course recommendations and AI-generated course editing are not added here.
- The old playlist tables are not dropped in this issue.
- General account onboarding and the production HTTPS browser proof remain separate from the Course domain migration.

## Evidence and references

- PostgreSQL unique and foreign-key constraints: <https://www.postgresql.org/docs/current/ddl-constraints.html>
- PostgreSQL row-level locking: <https://www.postgresql.org/docs/current/explicit-locking.html>
- PostgreSQL Read Committed update semantics: <https://www.postgresql.org/docs/current/transaction-iso.html>
- PostgreSQL atomic `ON CONFLICT` behavior: <https://www.postgresql.org/docs/current/sql-insert.html>
- node-pg-migrate transaction and advisory-lock behavior: <https://salsita.github.io/node-pg-migrate/migrations/>

## Domain model

```mermaid
erDiagram
  USERS ||--o{ COURSES : owns
  COURSES ||--o{ COURSE_STEPS : contains
  POSTS o|--o{ COURSE_STEPS : sources
  COURSES ||--o{ COURSE_FEEDBACK : receives
  USERS ||--o{ COURSE_FEEDBACK : authors
  COURSES ||--|| COURSE_BACKFILL_AUDITS : records

  COURSES {
    int id PK
    int owner_id FK
    text title
    text description
    text visibility
    text status
    int version
    bytea idempotency_key_digest
    bytea idempotency_payload_hash
    timestamptz created_at
    timestamptz updated_at
    timestamptz published_at
    timestamptz archived_at
  }

  COURSE_STEPS {
    bigint id PK
    int course_id FK
    int source_post_id FK
    int position
    text title_snapshot
    text video_url_snapshot
    text thumbnail_url_snapshot
    text channel_name_snapshot
    jsonb owner_learning_state
  }

  COURSE_FEEDBACK {
    int id PK
    int course_id FK
    int author_id FK
    int rating
    text body
    timestamptz created_at
  }

  COURSE_BACKFILL_AUDITS {
    int legacy_playlist_id PK
    text order_strategy
    int step_count
    int feedback_count
    timestamptz completed_at
  }
```

Course is the aggregate root. `version` starts at 1 and increases once for each successful owner mutation. Feedback does not advance the owner-edit version because it is authored independently and does not change Course invariants.

CourseStep owns immutable display snapshots. `source_post_id` is nullable and uses `ON DELETE SET NULL`, so deleting a post removes only the optional reference. The title, video URL, thumbnail URL, channel name, position, and owner learning state remain.

`owner_learning_state` stores the current browser learning state as validated JSON. It is included only in owner projections. Public projections never include playback marks, loop ranges, captions, or notes.

## Lifecycle

```mermaid
stateDiagram-v2
  [*] --> Draft: create or legacy backfill
  Draft --> Draft: patch or replace steps
  Draft --> Published: publish non-empty course
  Draft --> Archived: archive
  Published --> Published: patch or replace non-empty steps
  Published --> Archived: archive
  Archived --> Archived: read by owner
```

The lifecycle intentionally has no unarchive transition in this issue. A draft is private. Publishing atomically sets `status = published` and `visibility = public`. Archiving atomically sets `status = archived` and `visibility = private`. The database rejects any state and visibility combination outside those pairs.

A published Course must contain at least one step. Draft and archived Courses may be empty. No physical Course deletion endpoint is added.

## Ordering invariants

Every committed Course with steps satisfies all of these rules:

1. Position starts at 1.
2. Position is unique within a Course.
3. Maximum position equals the number of steps.
4. The API accepts an ordered array and derives positions instead of trusting client-provided integers.

PostgreSQL owns uniqueness through a deferrable unique constraint on `(course_id, position)`. A deferred constraint trigger verifies contiguity and the non-empty published rule at transaction end. Application validation rejects malformed arrays early, but database enforcement remains the final boundary for alternate writers and race conditions.

## Concurrency model

The public API uses optimistic concurrency. Every patch, step replacement, publish, and archive request includes `expectedVersion`. A stale request receives conflict semantics and never overwrites the winner.

Simple metadata updates can use one compare-and-set statement whose predicate includes owner and version. PostgreSQL re-evaluates the predicate after a concurrent updater commits under Read Committed isolation, so only one request can advance a given version.

Compound mutations lock the Course row first:

```mermaid
sequenceDiagram
  participant A as Request A
  participant B as Request B
  participant DB as PostgreSQL

  A->>DB: lock Course and check expected version
  DB-->>A: version matches
  B->>DB: lock same Course
  A->>DB: replace steps or transition state
  A->>DB: increment version and commit
  DB-->>B: lock acquired with new version
  B->>DB: compare expected version
  DB-->>B: stale version conflict
```

The client contract is optimistic even though a short row lock protects each multi-statement transaction internally. Transactions never wait for user input or external services.

Publish and step replacement follow the same lock order. This prevents a publish request from racing with removal of the last step. One request commits first and advances the version; the other must retry from the new representation.

## Idempotent create

`POST /courses` requires an `Idempotency-Key`. The server hashes the key and a canonical request payload. A non-deferrable unique constraint on owner plus key digest is the concurrency arbiter.

The insert uses PostgreSQL `ON CONFLICT` semantics so concurrent retries converge on one Course. Reusing the key with the same payload returns the existing Course. Reusing it with a different payload returns a conflict and does not alter the original Course.

The key is scoped by the authenticated owner. Two users may present the same browser draft ID without sharing a Course or learning state.

## Projections and authorization

Mixed public and private behavior is split into explicit routes, following the authentication boundary established in `#7`:

- `GET /courses` returns the authenticated owner's draft, published, and archived Courses with owner-only learning state.
- `GET /courses/:id` returns an owner projection or 404.
- `GET /explore/courses` returns only published Courses and public step snapshots.
- `GET /explore/courses/:id` returns only a published public projection or 404.

Every mutation derives `owner_id` from the cookie principal. It never accepts an owner ID in a request body. A missing Course and a Course owned by another user both return 404 on private routes.

Owner and public lists use cursor pagination with a stable timestamp and ID tie-breaker. The cursor is opaque to clients and rejects malformed values without falling back to an ambiguous page.

## HTTP surface

- `POST /courses` creates a draft and optional initial steps under an idempotency key.
- `GET /courses` lists the current owner's Courses.
- `GET /courses/:id` reads an owner projection.
- `PATCH /courses/:id` changes title or description with an expected version.
- `PUT /courses/:id/steps` replaces the ordered step set with an expected version.
- `POST /courses/:id/publish` publishes a non-empty draft with an expected version.
- `POST /courses/:id/archive` archives a draft or published Course with an expected version.
- `POST /courses/:id/feedback` appends feedback to a published Course.
- `GET /explore/courses` and `GET /explore/courses/:id` expose public projections.

Legacy playlist mutations are removed from the active controller at cutover. The old schema remains untouched so rollback means redeploying the previous application release, not reversing or deleting migrated data.

## Resumable expand and contract migration

```mermaid
flowchart TB
  Expand["Expand: create Course tables and constraints"] --> Backfill["Backfill: one legacy playlist transaction at a time"]
  Backfill --> Audit["Persist completed playlist audit row"]
  Audit --> Verify{"Shadow comparison passes?"}
  Verify -->|no| Stop["Stop cutover and keep old application"]
  Verify -->|yes| Contract["Contract: deploy Course reads and close playlist writes"]
  Contract --> Observe["Retain legacy tables for rollback window"]
```

The schema migration creates only additive tables, indexes, constraints, and validation functions. It does not drop or rewrite playlist data.

The backfill process acquires one process-wide advisory lock and handles each playlist in its own transaction. A completion row is written only after the Course, steps, feedback, snapshots, and counts are committed. If the process stops, completed playlists are skipped and the first incomplete playlist is retried without changing IDs.

Legacy order is interpreted in two ways:

- If every item position is positive and unique, relative legacy position then post ID determines the new order.
- If position data is missing or ambiguous, post ID determines the new order.

The chosen strategy is stored in `course_backfill_audits`, and both strategies normalize the final positions to `1..N`.

Shadow verification compares old and new IDs, owners, timestamps, item ordering, feedback rows, counts by owner, and snapshot completeness. Sequence values are advanced only when behind the copied IDs and are never moved backward.

## Browser draft import

The browser already stores drafts under a user-scoped key. Course import preserves that boundary and adds a server boundary:

1. Read only the active cookie user's scoped drafts.
2. Convert video order directly into the request step order.
3. Carry validated learning marks, playback rate, caption settings, and loop state as owner-only step state.
4. Use a deterministic idempotency key derived from the local draft ID.
5. Remove or mark a local draft imported only after the server returns the Course.
6. Leave the draft intact on timeout or error so a retry converges on the same Course.

For a step with `sourcePostId`, the server loads the post and creates authoritative snapshots. For a local or recommended video without a persisted post, the request must contain complete snapshot fields and the source reference remains null.

## Error contract

- Invalid text, cursor, step shape, or learning state is a bad request.
- Missing or non-owned private resources are not found.
- Stale versions, invalid lifecycle transitions, and idempotency-key payload reuse are conflicts.
- Constraint races are translated into stable domain errors and never leak a raw PostgreSQL error as a server error.
- Unexpected database failures keep the existing sanitized request-ID error boundary.

## Verification strategy

Unit tests cover domain validation, cursor encoding, canonical payload hashing, projection privacy, and repository error translation.

PostgreSQL integration tests provide the portfolio evidence:

- Two title patches from the same version yield one success and one conflict.
- Two step replacements from the same version yield one committed contiguous order.
- Publishing and removing the last step cannot create an empty published Course.
- Deleting a source post preserves snapshots and ordering.
- Concurrent create retries with one key yield one Course.
- One key with a different payload is rejected.
- A stopped backfill resumes without changing IDs, row counts, or feedback.
- Public reads expose only published snapshots and never owner learning state.

Web tests cover local user scoping, learning-state conversion, retry idempotency, and the rule that local data survives an unsuccessful import.

## Rollout and rollback

The rollout order is schema migration, backfill, shadow verification, application deployment, and smoke verification. A failed backfill or comparison stops before the application cutover.

Rollback before destructive cleanup is an application rollback: deploy the previous release and continue using the untouched playlist tables. New Course writes made after cutover are not reverse-copied into playlists, so rollback after accepting production Course writes requires a deliberate maintenance window or roll-forward fix. The deployment runbook must call out that boundary.
