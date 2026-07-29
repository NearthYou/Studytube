# StudyTube Open Issues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining StudyTube backend, operations, deployment, and evidence issues with production code, reproducible verification, and a live HTTPS deployment.

**Architecture:** PostgreSQL remains the source of truth. Domain mutations write versioned outbox events in the same transaction, a BullMQ relay and worker provide durable background execution through Valkey, and typed NestJS modules own agent runs, learning progress, quizzes, retrieval, telemetry, and recovery. Caddy is the only public application edge, the API uses a Unix socket, AI and PostgreSQL stay on loopback, and GitHub Actions deploys a verified immutable SHA through AWS Systems Manager.

**Tech Stack:** Node.js 24.8+, NestJS 11, PostgreSQL 16 with pgvector and pg_trgm, BullMQ, Valkey, OpenTelemetry, Python 3.12, FastAPI, official Python MCP SDK, Caddy, systemd, GitHub Actions, AWS EC2 and Systems Manager.

## Global Constraints

- Do not modify `docs/presentation`.
- Keep GitHub issues and README focused on implementation evidence rather than promotional framing.
- Do not claim measured performance or reliability without a committed reproducible artifact.
- Store no plaintext session, verification, internal API, or provider token in application persistence, logs, tests, or evidence artifacts.
- Keep browser traffic on one HTTPS origin and expose no application or database port publicly.
- Use test-first red-green cycles for every behavior-bearing change.
- Preserve the existing authentication and Course aggregate transaction contracts.
- A final Route 53 domain purchase requires user confirmation of the exact name, period, price, and automatic-renewal state.

---

### Task 1: Add durable work and retrieval persistence

**Files:**
- Create: `api/migrations/1753660804000_reliability-learning.cjs`
- Create: `api/src/work/work.types.ts`
- Create: `api/src/work/work.repository.ts`
- Create: `api/src/work/postgres-work.repository.ts`
- Create: `api/src/work/postgres-work.repository.spec.ts`
- Modify: `api/migrations/1753660800000_baseline-schema.cjs`
- Modify: `api/src/app.module.ts`
- Modify: `api/src/database.service.ts`

**Interfaces:**
- Produces: `appendOutboxEvent(client, event)`, `claimOutboxBatch(limit, leaseOwner, leaseMs)`, `ackOutboxEvent(id, leaseToken)`, `retryOutboxEvent(id, leaseToken, failure)`, `recordJobResult(result)`, and `replayDeadLetter(id, actorId)`.
- Produces PostgreSQL tables for outbox events, job results, dead letters, replay audit, 1536-dimension embeddings with model version, agent runs, tool calls, progress, quizzes, and immutable attempts.

- [ ] **Step 1: Write migration and repository tests that require immutable event IDs, schema versions, lease tokens, unique handler results, and replay audits**

```ts
it('claims an event once and rejects a stale lease acknowledgement', async () => {
  const first = await repository.claimOutboxBatch(10, 'relay-a', 30_000);
  expect(first).toHaveLength(1);
  await expect(
    repository.ackOutboxEvent(first[0].id, 'stale-token'),
  ).rejects.toThrow('OUTBOX_LEASE_LOST');
});
```

- [ ] **Step 2: Run focused tests and observe failure because the migration and repository do not exist**

Run: `npm --prefix api test -- --runInBand postgres-work.repository.spec.ts migration-files.spec.ts`

Expected: FAIL because reliability tables and repository methods are missing.

- [ ] **Step 3: Add the migration and minimal PostgreSQL repository**

```ts
export type OutboxEvent = {
  id: string;
  eventType: string;
  aggregateId: string;
  aggregateVersion: number;
  payloadSchemaVersion: number;
  payload: Record<string, unknown>;
  occurredAt: string;
};
```

Use `FOR UPDATE SKIP LOCKED`, an opaque lease token, bounded attempts, `available_at`, and a unique `(event_id, handler_version)` result constraint.

- [ ] **Step 4: Run focused unit and migration tests until green**

Run: `npm --prefix api test -- --runInBand postgres-work.repository.spec.ts migration-files.spec.ts`

- [ ] **Step 5: Commit the persistence boundary**

```bash
git add api/migrations/1753660804000_reliability-learning.cjs api/src/work api/src/app.module.ts api/src/database.service.ts api/src/migration-files.spec.ts
git commit -m "feat(work): add durable outbox and learning persistence"
```

### Task 2: Replace the in-process video queue with BullMQ

**Files:**
- Create: `api/src/work/outbox-relay.service.ts`
- Create: `api/src/work/outbox-relay.service.spec.ts`
- Create: `api/src/work/video-asset.worker.ts`
- Create: `api/src/work/video-asset.worker.spec.ts`
- Create: `api/src/worker.ts`
- Create: `infra/systemd/studytube-worker.service.in`
- Modify: `api/src/video-asset.service.ts`
- Modify: `api/src/video-asset.service.spec.ts`
- Modify: `api/src/study-board.service.ts`
- Modify: `api/package.json`
- Modify: `api/package-lock.json`
- Modify: `docker-compose.yml`
- Modify: `infra/production.compose.yml`
- Modify: `.github/workflows/ci-cd.yml`

**Interfaces:**
- Consumes: Task 1 outbox lease and job result methods.
- Produces: deterministic BullMQ job IDs in the form `<event-id>:<handler-version>`, graceful relay shutdown, idempotent video asset processing, retryable versus terminal failures, and dead-letter replay.

- [ ] **Step 1: Write failing crash-window, duplicate-delivery, queue-outage, and shutdown tests**

```ts
it('does not lose an event when publish succeeds before acknowledgement', async () => {
  queue.add.mockResolvedValue({ id: `${EVENT_ID}:v1` });
  repository.ackOutboxEvent.mockRejectedValueOnce(new Error('crash'));
  await expect(relay.publishOnce()).rejects.toThrow('crash');
  await relay.publishOnce();
  expect(queue.add).toHaveBeenCalledWith(
    'video-asset.prepare',
    expect.any(Object),
    expect.objectContaining({ jobId: `${EVENT_ID}:v1` }),
  );
});
```

- [ ] **Step 2: Run tests and observe the current array-backed queue fail durability expectations**

Run: `npm --prefix api test -- --runInBand outbox-relay.service.spec.ts video-asset.worker.spec.ts video-asset.service.spec.ts`

- [ ] **Step 3: Add BullMQ and Valkey, publish outbox events transactionally, and run a separate worker process**

```ts
new Worker<VideoAssetJob>(
  WORK_QUEUE,
  (job) => handler.handle(job.data),
  { connection, concurrency: configuredConcurrency },
);
```

The API commits the post, video asset request, and outbox event together. It never waits for Valkey.

- [ ] **Step 4: Run focused tests and a real Valkey/PostgreSQL integration fixture**

Run: `docker compose up -d postgres valkey`

Run: `npm --prefix api run test:e2e -- --runInBand --testPathPattern=work`

- [ ] **Step 5: Commit durable jobs**

```bash
git add api/src/work api/src/worker.ts api/src/video-asset.service.ts api/src/video-asset.service.spec.ts api/src/study-board.service.ts api/package.json api/package-lock.json docker-compose.yml infra/production.compose.yml infra/systemd/studytube-worker.service.in .github/workflows/ci-cd.yml
git commit -m "feat(work): process video assets through a durable queue"
```

### Task 3: Implement provider-backed hybrid retrieval

**Files:**
- Create: `api/src/retrieval/retrieval.types.ts`
- Create: `api/src/retrieval/embedding.service.ts`
- Create: `api/src/retrieval/embedding.service.spec.ts`
- Create: `api/src/retrieval/postgres-retrieval.repository.ts`
- Create: `api/src/retrieval/postgres-retrieval.repository.spec.ts`
- Create: `api/src/retrieval/retrieval.service.ts`
- Create: `api/src/retrieval/retrieval.controller.ts`
- Create: `api/src/retrieval/retrieval.module.ts`
- Create: `api/evaluation/relevance.json`
- Create: `api/scripts/evaluate-retrieval.ts`
- Modify: `api/src/app.module.ts`
- Modify: `ai/main.py`
- Modify: `ai/test_main.py`

**Interfaces:**
- Produces: `EmbeddingService.embed(text): Promise<EmbeddingResult>`, explicit `provider_unavailable` failures, permission-filtered lexical and vector ranks, RRF fusion, source and timestamp citations, and a JSON evaluation report.

- [ ] **Step 1: Write failing tests for no hash fallback, owner filtering before ranking, RRF ordering, and citations**

```ts
it('returns provider_unavailable instead of a deterministic vector', async () => {
  provider.embed.mockRejectedValue(new Error('timeout'));
  await expect(service.search(query, actor)).rejects.toMatchObject({
    code: 'EMBEDDING_PROVIDER_UNAVAILABLE',
  });
});
```

- [ ] **Step 2: Run focused tests and observe deterministic fallback and missing retrieval module failures**

Run: `npm --prefix api test -- --runInBand retrieval`

Run: `python -m unittest ai.test_main`

- [ ] **Step 3: Implement 1536-dimension provider embeddings, pg_trgm and pgvector ranks, and RRF**

```sql
WITH lexical AS (... WHERE visibility_filter ...),
vector AS (... WHERE visibility_filter ...),
fused AS (
  SELECT source_id,
         COALESCE(1.0 / (60 + lexical_rank), 0) +
         COALESCE(1.0 / (60 + vector_rank), 0) AS score
)
SELECT * FROM fused ORDER BY score DESC, source_id ASC LIMIT $1;
```

- [ ] **Step 4: Run unit, integration, and fixed-dataset evaluation**

Run: `npm --prefix api run retrieval:evaluate`

The command writes Recall@3, MRR, nDCG@5, citation coverage, provider cost, cache hit rate, and p95 latency to a dated JSON artifact.

- [ ] **Step 5: Commit hybrid retrieval**

```bash
git add api/src/retrieval api/evaluation api/scripts/evaluate-retrieval.ts api/package.json api/src/app.module.ts ai/main.py ai/test_main.py
git commit -m "feat(retrieval): add permissioned hybrid search"
```

### Task 4: Add durable agent runs, progress, and quizzes

**Files:**
- Create: `api/src/learning/agent-run.service.ts`
- Create: `api/src/learning/agent-run.service.spec.ts`
- Create: `api/src/learning/progress.service.ts`
- Create: `api/src/learning/progress.service.spec.ts`
- Create: `api/src/learning/quiz.service.ts`
- Create: `api/src/learning/quiz.service.spec.ts`
- Create: `api/src/learning/learning.controller.ts`
- Create: `api/src/learning/learning.module.ts`
- Create: `api/test/learning-concurrency.e2e-spec.ts`
- Modify: `api/src/app.module.ts`
- Modify: `api/src/work/video-asset.worker.ts`

**Interfaces:**
- Produces expected-version transitions for `queued`, `running`, `awaiting_approval`, `approved`, `completed`, `failed`, and `cancelled`.
- Produces watched-range normalization and completion only when watched coverage is at least 80 percent and the best quiz score is at least 70 percent.
- Produces private quiz attempts whose public projection omits correct answers and explanations before submission.

- [ ] **Step 1: Write failing transition-race, duplicate progress, out-of-order progress, quiz retry, and authorization tests**

```ts
it('merges duplicate and out-of-order watched intervals without inflating coverage', () => {
  expect(mergeWatchedRanges([[30, 60], [0, 40], [30, 60]])).toEqual([[0, 60]]);
});
```

- [ ] **Step 2: Run focused tests and observe missing learning domain failures**

Run: `npm --prefix api test -- --runInBand learning`

- [ ] **Step 3: Implement transactional state transitions, budgets, approvals, progress, and quizzes**

```ts
type RunBudget = {
  wallTimeMs: number;
  maxToolCalls: number;
  maxTokens: number;
  maxEstimatedCostUsd: number;
};
```

Approval updates the Course and appends asset and quiz outbox events in one PostgreSQL transaction.

- [ ] **Step 4: Run unit and real PostgreSQL concurrency tests**

Run: `npm --prefix api run test:e2e -- --runInBand learning-concurrency.e2e-spec.ts`

- [ ] **Step 5: Commit the learning loop**

```bash
git add api/src/learning api/test/learning-concurrency.e2e-spec.ts api/src/app.module.ts api/src/work/video-asset.worker.ts
git commit -m "feat(learning): persist agent runs progress and quizzes"
```

### Task 5: Replace the custom MCP endpoint

**Files:**
- Create: `ai/mcp_server.py`
- Create: `ai/test_mcp_server.py`
- Modify: `ai/main.py`
- Modify: `ai/requirements.txt`
- Modify: `api/src/ai-proxy.service.ts`
- Modify: `api/src/ai-proxy.service.spec.ts`

**Interfaces:**
- Produces official Streamable HTTP MCP `tools/list` and `tools/call` for read-only YouTube lookup and StudyTube search.
- Produces schema-versioned tool inputs and outputs, request/run IDs, bounded result size, timeouts, allowed hosts, and typed audit outcomes without credentials in payloads.

- [ ] **Step 1: Write failing official-client tests for list, call, schema mismatch, timeout, and audit redaction**

```py
async with streamable_http_client(url) as streams:
    async with ClientSession(*streams) as session:
        await session.initialize()
        result = await session.list_tools()
        assert {tool.name for tool in result.tools} == {
            "youtube_lookup",
            "studytube_search",
        }
```

- [ ] **Step 2: Run the tests and observe failure against the custom JSON-RPC endpoint**

Run: `python -m unittest ai.test_mcp_server`

- [ ] **Step 3: Mount the official MCP server and pass authenticated user context through trusted internal headers**

Tool payloads contain actor IDs and scopes, never session credentials.

- [ ] **Step 4: Run official client tests and FastAPI tests**

Run: `python -m unittest discover -s ai`

- [ ] **Step 5: Commit the MCP boundary**

```bash
git add ai/mcp_server.py ai/test_mcp_server.py ai/main.py ai/requirements.txt api/src/ai-proxy.service.ts api/src/ai-proxy.service.spec.ts
git commit -m "feat(ai): expose the learning tools through official MCP"
```

### Task 6: Add telemetry, load, fault, and restore verification

**Files:**
- Create: `api/src/observability/telemetry.ts`
- Create: `api/src/observability/redacting-logger.ts`
- Create: `api/src/observability/redacting-logger.spec.ts`
- Create: `operations/load/core-flows.k6.js`
- Create: `operations/faults/run-fault-drills.ps1`
- Create: `operations/recovery/backup-restore.ps1`
- Create: `operations/recovery/verify-restored-database.ts`
- Create: `docs/evidence/operations/README.md`
- Modify: `api/src/main.ts`
- Modify: `api/src/auth/request-id.middleware.ts`
- Modify: `api/src/ai-proxy.service.ts`
- Modify: `api/package.json`
- Modify: `api/package-lock.json`
- Modify: `infra/production.compose.yml`

**Interfaces:**
- Produces trace propagation from public request through queue and FastAPI, structured secret-redacted logs, API and queue metrics, reproducible k6 output, deterministic fault scenarios, and a separate-database restore report with measured RPO/RTO.

- [ ] **Step 1: Write failing redaction, trace propagation, and metric tests**

```ts
it.each(['cookie', 'authorization', 'verificationToken', 'password'])(
  'redacts %s on success and error paths',
  (field) => {
    expect(JSON.stringify(logger.sanitize({ [field]: 'canary-secret' })))
      .not.toContain('canary-secret');
  },
);
```

- [ ] **Step 2: Run focused tests and observe missing observability behavior**

Run: `npm --prefix api test -- --runInBand observability ai-proxy`

- [ ] **Step 3: Implement OpenTelemetry, redaction, k6, fault injection, and restore drill**

The recovery script creates a temporary database, restores the dump, runs row-count and authenticated Course-flow checks, records UTC start/end times, and removes only the verified temporary database.

- [ ] **Step 4: Run the local smoke and recovery commands**

Run: `powershell -File operations/recovery/backup-restore.ps1 -Mode Verify`

Run: `k6 run operations/load/core-flows.k6.js --duration 30s --vus 5`

- [ ] **Step 5: Commit operations verification**

```bash
git add api/src/observability api/src/main.ts api/src/auth/request-id.middleware.ts api/src/ai-proxy.service.ts api/package.json api/package-lock.json operations docs/evidence/operations infra/production.compose.yml
git commit -m "feat(ops): add telemetry load and recovery drills"
```

### Task 7: Strengthen CI and the HTTPS runtime

**Files:**
- Create: `api/scripts/export-openapi.ts`
- Create: `api/scripts/verify-openapi-compatibility.ts`
- Create: `api/scripts/verify-query-plans.ts`
- Create: `api/openapi/baseline.json`
- Modify: `.github/workflows/ci-cd.yml`
- Modify: `infra/Caddyfile`
- Modify: `infra/systemd/studytube-api.service.in`
- Modify: `infra/systemd/studytube-worker.service.in`
- Modify: `scripts/deploy-ec2.sh`
- Modify: `scripts/install-production-runtime.sh`
- Modify: `api/src/runtime-listener.ts`
- Modify: `api/src/runtime-listener.spec.ts`
- Modify: `api/src/deploy-script.spec.ts`

**Interfaces:**
- Produces CI checks for PostgreSQL, Valkey, migrations, auth, Course, outbox, agent runs, OpenAPI compatibility, and query plans.
- Produces a permissioned Unix API socket, loopback AI and PostgreSQL, public liveness only, Caddy-managed HTTPS, and no development executors.

- [ ] **Step 1: Write failing runtime and workflow contract tests**

```ts
expect(apiService).toContain('ListenStream=@RUN_DIR@/api.sock');
expect(caddy).toContain('reverse_proxy unix//run/studytube/api.sock');
expect(workflow).toContain('verify-openapi-compatibility');
expect(workflow).toContain('verify-query-plans');
```

- [ ] **Step 2: Run focused tests and observe loopback-only API and missing CI contracts**

Run: `npm --prefix api test -- --runInBand runtime-listener.spec.ts deploy-script.spec.ts`

- [ ] **Step 3: Add Unix-socket activation, health separation, OpenAPI diff, query-plan checks, and failure artifacts**

Use systemd socket permissions for the Caddy group. Do not expose detailed readiness through Caddy.

- [ ] **Step 4: Run Compose, shell syntax, build, tests, and workflow static checks**

Run: `docker compose -f infra/production.compose.yml config`

Run: `bash -n scripts/deploy-ec2.sh scripts/install-production-runtime.sh`

- [ ] **Step 5: Commit CI and runtime hardening**

```bash
git add .github/workflows/ci-cd.yml api/scripts api/openapi infra scripts api/src/runtime-listener.ts api/src/runtime-listener.spec.ts api/src/deploy-script.spec.ts
git commit -m "feat(ops): verify contracts and serve the API by socket"
```

### Task 8: Publish evidence, merge, deploy, and close issues

**Files:**
- Create: `docs/evidence/reliability/README.md`
- Create: `docs/evidence/learning/README.md`
- Create: `docs/evidence/ci/README.md`
- Modify: `README.md`
- Modify: GitHub issues `#1`, `#2`, `#3`, `#4`, `#5`, `#9`, `#11`, and `#12`
- Do not modify: `docs/presentation/**`

**Interfaces:**
- Consumes all earlier verification outputs.
- Produces natural Korean issue titles and bodies without the prohibited term, traceable commit/PR/CI/evidence links, required branch checks, an immutable SSM deployment, live HTTP then HTTPS verification, and closed issues.

- [ ] **Step 1: Run the complete local verification matrix**

Run:

```powershell
npm --prefix api run lint
npm --prefix api test -- --runInBand
npm --prefix api run test:e2e -- --runInBand
npm --prefix api run build
npm --prefix web run lint
Push-Location web
node --test tests/*.test.ts
npm run build
Pop-Location
Push-Location ai
python -m unittest discover -s .
Pop-Location
docker compose -f infra/production.compose.yml config
```

- [ ] **Step 2: Create and merge a PR only after CI is green**

The PR body links every implemented issue, exact verification commands, measured artifacts, residual limits, and the preserved `docs/presentation` exclusion.

- [ ] **Step 3: Configure GitHub rules and AWS immutable delivery**

Require the verified API, Web, AI, integration, OpenAPI, and query-plan checks. Configure GitHub OIDC, a least-privilege deploy role, Systems Manager execution, immutable SHA/artifact/config fingerprints, last-known-good release metadata, and deterministic resume or rollback.

- [ ] **Step 4: Deploy the verified main SHA and verify external boundaries**

Confirm EC2 identity, Elastic IP, and security group ports 22, 80, and 443 before deployment. Verify API, AI, worker, PostgreSQL, Valkey, Caddy, the deployed SHA marker, HTTP access, and that 3000, 5173, 8000, 5432, and 6379 are externally closed.

- [ ] **Step 5: Pause only at the final Route 53 purchase action**

Show the exact domain, registration period, price, and auto-renewal state. After user confirmation, register it, create the A record to the verified Elastic IP, and verify certificate issuance and HTTPS.

- [ ] **Step 6: Update and close the completed issues**

Each issue body links its tests, result artifacts, PR, merge commit, CI run, and public verification. Close only when every non-optional completion item has fresh evidence.

- [ ] **Step 7: Commit evidence changes**

```bash
git add README.md docs/evidence
git commit -m "docs: connect backend decisions to verified evidence"
```

## Plan Self-Review

- Spec coverage: Tasks 1 through 3 cover #2, Tasks 4 and 5 cover #3, Task 6 covers #4, Task 7 covers #9 and #11, Task 8 covers #1, #5, #12, AWS deployment, GitHub rules, and issue closure.
- Placeholder scan: no deferred implementation markers or unspecified error-handling steps remain.
- Type consistency: Tasks 2 and 4 consume the Task 1 outbox repository; Task 5 supplies tools used by Task 4; Task 6 propagates traces through Tasks 2, 4, and 5; Task 7 verifies all preceding contracts.
