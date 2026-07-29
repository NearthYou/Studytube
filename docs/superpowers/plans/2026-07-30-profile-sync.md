# StudyTube External Profile Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply one reviewed StudyTube story to Notion, the existing blog, Google Docs resume, and Wanted resume without touching unrelated personal content or creating fact drift.

**Architecture:** The committed `facts.json` and `sync-copy.md` are immutable inputs for one sync attempt. Target identifiers and snapshots remain session-local. Each target advances through an explicit state machine, and all public diffs receive one bundled user approval before any live write.

**Tech Stack:** Chrome control, Notion, blog editor, Google Docs, Wanted, SHA-256 content hashes

## Global Constraints

- Do not automate authentication or MFA.
- Do not read or modify content outside each target's StudyTube section.
- Do not copy existing contact fields into logs, screenshots, fact sheets, or chat.
- Do not publish any public change before one bundled preview approval.
- Keep target account labels, document IDs, and post IDs session-local.
- Do not edit `docs/presentation`.

---

### Task 1: Discover and snapshot exact targets

**Files:**
- Read only: `docs/evidence/portfolio/facts.json`
- Read only: `docs/evidence/portfolio/sync-copy.md`

**Interfaces:**
- Consumes: already-open authenticated Chrome tabs and final committed copy.
- Produces: a session-local allowlist with one record per target.

- [ ] **Step 1: Verify immutable sync inputs**

Run `npm run portfolio:verify`, record `git rev-parse HEAD`, and calculate SHA-256 for both input files. Stop if the working tree changes afterward.

- [ ] **Step 2: Discover each StudyTube section**

For Notion, blog, Google Docs, and Wanted, record only the platform, a local opaque target key, StudyTube section start and end markers, and current draft/public state. If a section does not exist, classify the operation as a new section or new post before previewing it.

- [ ] **Step 3: Capture sanitized prior state**

Copy only the StudyTube section into memory, remove contact and operational identifiers, and calculate a SHA-256 hash. Set each target state to `snapshotted`.

- [ ] **Step 4: Verify scope boundaries**

Confirm that the intended replacement range does not include the document title, contact block, employment history, unrelated project, navigation, comments, or publication settings.

---

### Task 2: Produce one bundled public-change preview

**Files:**
- Read only: `docs/evidence/portfolio/sync-copy.md`

**Interfaces:**
- Consumes: the session-local allowlist and exact copy variants.
- Produces: four sanitized before-and-after diffs tied to one fact-sheet hash.

- [ ] **Step 1: Adapt formatting without changing facts**

Preserve the existing platform's heading, bullet, and link style. Remove internal fact-ID comments from rendered copy but retain their mapping in memory.

- [ ] **Step 2: Build target previews**

For each target, show current StudyTube text, proposed text, public/draft impact, and required fact IDs. Mark new posts and new public sections explicitly.

- [ ] **Step 3: Run the drift comparison**

Compare every number, date, URL, status, and cost phrase in the previews to `facts.json`. Any unmapped dynamic value blocks approval.

- [ ] **Step 4: Request one bundled approval**

Present all public diffs together. The approval applies only to those exact previews and the recorded fact-sheet hash. A changed preview or hash requires a new bundled approval.

---

### Task 3: Apply, verify, and reconcile partial failure

**Files:**
- No repository files are modified.

**Interfaces:**
- Consumes: the approved previews and target snapshots.
- Produces: `applied`, `verified`, `failed`, or `rolled_back` state per target.

- [ ] **Step 1: Recheck target and input hashes**

Before each write, confirm the current StudyTube section still matches its snapshot hash and the fact sheet still matches the approved hash. Stop that target on a mismatch.

- [ ] **Step 2: Apply only the approved section replacement**

Write the exact previewed content, preserve the prior draft/public setting, and never click a new publish action unless that target was explicitly included as public in the approval.

- [ ] **Step 3: Verify rendered content**

Reload the target and compare project name, service URL, repository URL, status, test facts, cost facts, and limitation wording. Set the target to `verified` only when every required value matches.

- [ ] **Step 4: Handle partial failure**

Freeze the approved input hashes. Mark failed targets with the exact failing stage and retry only the same idempotent section replacement. Roll back to the captured prior text only when the platform supports a verified restoration; otherwise roll forward the remaining approved targets.

- [ ] **Step 5: Report the final state table**

Return one row per target containing platform, prior public/draft state, final state, verified fact-sheet hash, and any remaining manual action. Do not claim synchronized when any target is `failed` or unverified.
