# StudyTube Portfolio Evidence and README Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a human-readable StudyTube case study whose dynamic claims are generated from one validated, secret-safe evidence fact sheet.

**Architecture:** `docs/evidence/portfolio/facts.json` owns dynamic values and evidence status, while `README.md` owns the narrative. A dependency-free Node verifier rejects stale, untraceable, or sensitive facts before the README and external copy can change. AWS cost and production observations live in sanitized evidence documents and remain pending until the same evidence-subject commit passes CI and deployment.

**Tech Stack:** Markdown, JSON, Node.js 24 built-in test runner, GitHub CLI, AWS CLI, PowerShell, Chrome

## Global Constraints

- Do not edit `docs/presentation`.
- Never commit AWS account IDs, instance IDs, contact data, tokens, verification links, session material, or secret values.
- Record the deployed code as `evidenceSubjectSha` and the later documentation commit as `documentationSha`.
- Label every dynamic outcome `ci_verified`, `production_verified`, or `pending`.
- Do not claim load, RPO/RTO, SES production delivery, retrieval quality, or availability without a dated result artifact.
- Treat README prose as a human case study, not a technology inventory or marketing page.

---

### Task 1: Machine-readable portfolio fact contract

**Files:**
- Create: `docs/evidence/portfolio/facts.json`
- Create: `scripts/verify-portfolio-facts.mjs`
- Create: `scripts/tests/portfolio-facts-contract.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: Git commit SHAs, workflow URLs, sanitized evidence paths, ISO timestamps.
- Produces: `npm run portfolio:verify`, which exits zero only when `facts.json` is safe and internally consistent.

- [ ] **Step 1: Write the failing contract test**

Create fixtures in memory and test the exported `validatePortfolioFacts(document)` function:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { validatePortfolioFacts } from '../verify-portfolio-facts.mjs'

const validDocument = {
  schemaVersion: 1,
  evidenceSubjectSha: 'a'.repeat(40),
  documentationSha: null,
  generatedAt: '2026-07-30T00:00:00.000Z',
  facts: [{
    id: 'production.status',
    value: 'pending',
    status: 'pending',
    observedAt: '2026-07-30T00:00:00.000Z',
    expiresAt: '2026-08-06T00:00:00.000Z',
    evidenceSubjectSha: 'a'.repeat(40),
    workflowRun: null,
    publicEvidence: null,
    evidenceHash: null
  }]
}

test('accepts a pending fact with no fabricated evidence', () => {
  assert.deepEqual(validatePortfolioFacts(validDocument), [])
})

test('rejects operational identifiers and secret-shaped values', () => {
  const unsafe = structuredClone(validDocument)
  unsafe.facts[0].value = 'i-0123456789abcdef0'
  assert.match(validatePortfolioFacts(unsafe).join('\n'), /operational identifier/)
})

test('requires verified facts to have traceable evidence', () => {
  const untraceable = structuredClone(validDocument)
  untraceable.facts[0].status = 'production_verified'
  assert.match(validatePortfolioFacts(untraceable).join('\n'), /publicEvidence or evidenceHash/)
})
```

- [ ] **Step 2: Run the contract test and confirm the red state**

Run: `node --test scripts/tests/portfolio-facts-contract.test.mjs`

Expected: FAIL because `scripts/verify-portfolio-facts.mjs` does not exist.

- [ ] **Step 3: Implement the validator without third-party dependencies**

Export `validatePortfolioFacts(document)` and make the CLI read `docs/evidence/portfolio/facts.json`. Validate the exact status enum, 40-character lowercase SHA, unique fact IDs, chronological timestamps, matching per-fact SHA, evidence requirements, HTTPS workflow URLs, and these forbidden patterns:

```js
const forbiddenPatterns = [
  /\b\d{12}\b/u,
  /\bi-[0-9a-f]{8,17}\b/iu,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /(?:password|secret|token|private[_-]?key)\s*[:=]\s*[^\s,}]+/iu
]
```

The CLI prints one error per line and exits 1 on failure. Add this root script:

```json
"portfolio:verify": "node scripts/verify-portfolio-facts.mjs"
```

- [ ] **Step 4: Add the initial pending fact sheet**

Include these stable IDs: `project.name`, `project.repository`, `service.url`, `production.status`, `ci.api.tests`, `ci.web.tests`, `ci.ai.tests`, `security.runtime_dependencies`, `cost.domain.annual`, and `cost.aws.monthly_estimate`. Use `pending` and null evidence for values not yet verified; never insert guessed numbers.

- [ ] **Step 5: Run the tests and validator**

Run:

```powershell
node --test scripts/tests/portfolio-facts-contract.test.mjs
npm run portfolio:verify
```

Expected: all Node tests pass and the validator exits 0.

- [ ] **Step 6: Commit the fact contract**

```powershell
git add package.json scripts/verify-portfolio-facts.mjs scripts/tests/portfolio-facts-contract.test.mjs docs/evidence/portfolio/facts.json
git commit -m "docs(portfolio): add verified fact contract"
```

---

### Task 2: CI and production evidence capture

**Files:**
- Modify: `docs/evidence/portfolio/facts.json`
- Create: `docs/evidence/operations/results/2026-07-30-production-smoke.md`

**Interfaces:**
- Consumes: the successful `main` workflow run for `evidenceSubjectSha`, Chrome smoke observations, sanitized AWS CLI output.
- Produces: traceable CI facts and a production checklist that contains no private AWS identifiers.

- [ ] **Step 1: Prove the workflow and deployed SHA match**

Run:

```powershell
gh run view $env:STUDYTUBE_EVIDENCE_RUN --json headSha,status,conclusion,event,url,jobs
```

Require `event=push`, `conclusion=success`, `headSha` equal to `evidenceSubjectSha`, and successful Security, Web, API, AI, Backend Integration, and Deploy jobs. Stop and keep production facts pending if any requirement fails.

- [ ] **Step 2: Extract test results from the named job steps**

Run:

```powershell
gh run view $env:STUDYTUBE_EVIDENCE_RUN --log | Select-String -Pattern 'Test Suites:|Tests:|Ran [0-9]+ tests|pass [0-9]+|skipped [0-9]+|No known vulnerabilities|found 0 vulnerabilities'
```

Record separate API, Web, AI, database integration, and dependency-audit facts. Do not add the counts into a single total because suite overlap makes that number ambiguous.

- [ ] **Step 3: Capture sanitized production checks**

Record only pass/fail, UTC time, hostname, HTTP status, certificate hostname and expiry, cookie attribute names, expected service states, and the evidence-subject SHA. Replace any account, instance, IP, email, token, or command ID with `[redacted]` before hashing or committing the document.

- [ ] **Step 4: Hash non-public raw evidence**

Use SHA-256 on the local raw evidence file and store only the digest in `evidenceHash`:

```powershell
(Get-FileHash -Algorithm SHA256 -LiteralPath $env:STUDYTUBE_RAW_EVIDENCE).Hash.ToLowerInvariant()
```

- [ ] **Step 5: Validate the updated evidence**

Run:

```powershell
npm run portfolio:verify
rg -n "\b[0-9]{12}\b|\bi-[0-9a-f]{8,17}\b|AKIA|BEGIN .*PRIVATE KEY" docs/evidence/portfolio docs/evidence/operations/results/2026-07-30-production-smoke.md
```

Expected: validator exits 0 and `rg` returns no matches.

- [ ] **Step 6: Commit the evidence snapshot**

```powershell
git add docs/evidence/portfolio/facts.json docs/evidence/operations/results/2026-07-30-production-smoke.md
git commit -m "docs(evidence): record production deployment snapshot"
```

---

### Task 3: Reproducible student-budget cost baseline

**Files:**
- Create: `docs/evidence/operations/aws-cost-baseline.md`
- Modify: `docs/evidence/portfolio/facts.json`

**Interfaces:**
- Consumes: actual AWS resource types and quantities plus dated official AWS and registrar prices.
- Produces: auditable monthly and annual estimates with explicit free-tier and tax assumptions.

- [ ] **Step 1: Inventory billable resources without identifiers**

Record only resource classes and quantities: EC2 family and size, EBS type and GB, public IPv4 hours, Route 53 hosted zones, S3 GB and request assumptions, CloudWatch log GB and alarms, SES messages, and domain annual price.

- [ ] **Step 2: Fetch dated official prices**

Use AWS pricing pages or AWS Price List API for Seoul region and record each direct source URL and retrieval date. Record the registrar receipt amount for `studytube.page` as USD 14/year and auto-renew off. Do not record account or order identifiers.

- [ ] **Step 3: Calculate the baseline with explicit arithmetic**

For each line use `quantity × unit price = subtotal`, then show monthly AWS subtotal, annual domain subtotal, tax exclusion, free-tier assumption, and the cost when the EC2 instance is stopped. Do not use a range unless both lower and upper assumptions are shown.

- [ ] **Step 4: Update cost facts and validate**

Set `cost.domain.annual` and `cost.aws.monthly_estimate` from the worksheet, including `observedAt`, `expiresAt`, source path, and evidence subject SHA. Run `npm run portfolio:verify`.

- [ ] **Step 5: Commit the cost evidence**

```powershell
git add docs/evidence/operations/aws-cost-baseline.md docs/evidence/portfolio/facts.json
git commit -m "docs(cost): document student AWS baseline"
```

---

### Task 4: Rewrite the README as an evidence-first case study

**Files:**
- Modify: `README.md`
- Create: `docs/evidence/portfolio/sync-copy.md`

**Interfaces:**
- Consumes: validated fact IDs and committed evidence documents from Tasks 1 through 3.
- Produces: the canonical human narrative and exact shorter variants for external surfaces.

- [ ] **Step 1: Replace volatile opening claims**

State the product premise without claiming user research. Show service, repository, and API contract status from the fact sheet. Label the existing screenshot as local demo data until a sanitized production screenshot is committed.

- [ ] **Step 2: Keep five decision narratives**

For server sessions, Course aggregate, transactional outbox, hybrid retrieval, and immutable activation, use this order: code-review or test-reproduced failure mode, choice, reason, tradeoff, implementation link, verification link.

- [ ] **Step 3: Correct reliability wording**

State that automatic reactivation is conditional on a prepared compatible release before schema and Course barriers. State that migrations are not automatically reversed and unsupported previous releases remain sealed while recovery rolls forward.

- [ ] **Step 4: Replace stale outcome and cost text**

Use the fact sheet's per-job counts, dependency audit scope, deployment status, domain price, and dated AWS estimate. Keep retrieval quality, load, SES production access, availability, RPO, and RTO in the limitations section until their fact status changes.

- [ ] **Step 5: Write exact external copy variants**

In `sync-copy.md`, include one Notion section, one blog outline, four Google Docs resume bullets, and three Wanted bullets. Every number and URL must include its fact ID in an adjacent HTML comment such as `<!-- fact:ci.api.tests -->` so drift can be checked before publication.

- [ ] **Step 6: Validate prose and evidence**

Run:

```powershell
npm run portfolio:verify
rg -n "85건|16\.38|17~19|자동 rollback|production-ready" README.md docs/evidence/portfolio/sync-copy.md
git diff --check
git diff --exit-code -- docs/presentation
```

Expected: the stale/overstated phrase scan returns no matches, diff check passes, and `docs/presentation` has no diff.

- [ ] **Step 7: Commit the narrative**

```powershell
git add README.md docs/evidence/portfolio/sync-copy.md
git commit -m "docs(readme): present StudyTube as an evidenced case study"
```

---

### Task 5: Documentation SHA and final repository verification

**Files:**
- Modify: `docs/evidence/portfolio/facts.json`

**Interfaces:**
- Consumes: the documentation commit from Task 4.
- Produces: a fact sheet that distinguishes deployed code evidence from its publishing commit.

- [ ] **Step 1: Record the documentation commit**

Run `git rev-parse HEAD` and set `documentationSha` to that exact 40-character value. Keep `evidenceSubjectSha` unchanged.

- [ ] **Step 2: Run final verification**

```powershell
npm run portfolio:verify
node --test scripts/tests/portfolio-facts-contract.test.mjs
git diff --check
git diff --exit-code -- docs/presentation
```

Expected: all commands exit 0.

- [ ] **Step 3: Commit the documentation linkage**

```powershell
git add docs/evidence/portfolio/facts.json
git commit -m "docs(evidence): link portfolio publication commit"
```
