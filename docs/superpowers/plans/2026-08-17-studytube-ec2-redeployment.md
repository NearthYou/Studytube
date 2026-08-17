# StudyTube EC2 Redeployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the verified StudyTube application as an always-on `studytube.page` service using the existing single-EC2, GitHub OIDC, S3 release, and SSM deployment path for about $16.42~$16.46 per month.

**Architecture:** Run Caddy, the NestJS API, FastAPI AI service, worker, PostgreSQL with pgvector, and Valkey on one Seoul `t3.micro`. Recreate only the StudyTube EC2, gp3 volume, Elastic IP, Route 53 zone, private release bucket, and deployment log group, then deploy the verified `main` SHA through the repository's existing immutable SSM workflow.

**Tech Stack:** AWS EC2, EBS, VPC, IAM, SSM, S3 Object Lock, Route 53, CloudWatch Logs, SES, GitHub Actions OIDC, Docker Compose, systemd, Caddy, Node.js 24, Python 3.12, PostgreSQL 16 with pgvector, Valkey 9.

## Global Constraints

- Do not modify `docs/presentation/**`.
- Keep the service available 24 hours a day; do not add scheduled shutdown.
- Limit StudyTube's expected recurring AWS cost to approximately $16.42~$16.46 per month.
- Create no StudyTube RDS, ElastiCache, ECS, NAT Gateway, load balancer, CloudFront, or OpenSearch resource.
- Allow public inbound traffic only on TCP 80 and 443; do not open SSH or application/data ports.
- Use the existing `StudyTubeGitHubDeployRole`, `StudyTubeEc2RuntimeRole`, OIDC, S3 release, and SSM deployment contracts when they still match the documented policy.
- Deploy only a commit that passed the required GitHub CI jobs and is present on `main`.
- Never print, commit, upload, or place runtime secrets in GitHub variables, workflow logs, public artifacts, screenshots, or evidence files.
- Treat new AWS resource creation as the approved approximately $16.4/month cost scope; stop before any resource class outside this plan.
- Do not change Amazon Q or SketchCatch infrastructure during StudyTube deployment.
- Do not claim exactly-once delivery; the worker contract remains at-least-once across external-call crash windows.

---

### Task 1: Reconcile the deployment branch with merged application code

**Files:**
- Existing: `docs/superpowers/specs/2026-08-17-studytube-ec2-redeployment-design.md`
- Existing: `docs/superpowers/plans/2026-08-17-studytube-ec2-redeployment.md`
- Do not modify: `docs/presentation/**`

**Interfaces:**
- Consumes: merged PR `#32`, local design commit `2a10498`, and `origin/main`.
- Produces: a branch whose application code is byte-equivalent to current `main` and whose only intended diff is the redeployment spec and plan.

- [ ] **Step 1: Prepare an isolated execution checkout**

Use `superpowers:using-git-worktrees` before making implementation changes. Reuse an already-isolated checkout only when the skill verifies it is safe and attached to `codex/fix-profile-and-watch-empty`.

- [ ] **Step 2: Refresh remote metadata and verify PR #32 is merged**

Run:

```powershell
git fetch origin
gh pr view 32 --repo NearthYou/studytube --json state,mergeCommit,headRefName,baseRefName,url
```

Expected: state is `MERGED`, base is `main`, and the merge commit is reachable from `origin/main`.

- [ ] **Step 3: Verify the branch contains no unmerged application change**

Run:

```powershell
git diff --name-status origin/main...HEAD
git diff --check
git diff -- docs/presentation
```

Expected: only the redeployment spec and plan are different from `origin/main`; `docs/presentation` has no output. If an application file appears, stop and reconcile the branch before continuing.

- [ ] **Step 4: Record the deployment subject SHA**

Run:

```powershell
gh api repos/NearthYou/studytube/commits/main --jq '.sha'
git rev-parse HEAD
```

Keep both values in session state. Do not write account IDs, instance IDs, or secret-bearing values to the repository.

---

### Task 2: Verify the existing release before creating paid resources

**Files:**
- Test: `web/tests/*.test.ts`
- Test: `api/src/**/*.spec.ts`
- Test: `api/test/*.e2e-spec.ts` through GitHub Backend Integration
- Test: `ai/test_*.py` and `ai/**/test_*.py`
- Test: `scripts/tests/immutable-deploy-contract.sh`
- Test: `operations/tests/Invoke-OperationsContractTests.ps1`
- Verify: `infra/production.compose.yml`
- Verify: `infra/Caddyfile`

**Interfaces:**
- Consumes: the application tree already verified by PR #32.
- Produces: fresh local build and deployment-contract evidence before AWS hourly resources start.

This task is verification-only. No red-green cycle is required because no application behavior is being added; any failure is a blocker to diagnose rather than permission to weaken a test.

- [ ] **Step 1: Run Web lint, tests, and production build**

Run:

```powershell
npm --prefix web run lint
Push-Location web
node --test tests/*.test.ts
npm run build
Pop-Location
```

Expected: all commands exit 0 and the production build completes without changing tracked files.

- [ ] **Step 2: Run API lint, unit tests, and production build**

Run:

```powershell
npm --prefix api run lint
npm --prefix api test -- --runInBand
npm --prefix api run build
```

Expected: all commands exit 0. Preserve the test count and failing seed if a test fails.

- [ ] **Step 3: Run AI tests with the repository virtual environment**

Run:

```powershell
Push-Location ai
.venv/Scripts/python.exe -m unittest discover -s .
Pop-Location
```

Expected: required tests pass; environment-dependent exclusions remain explicit.

- [ ] **Step 4: Verify deployment and operations contracts**

Run:

```powershell
bash scripts/tests/immutable-deploy-contract.sh
pwsh ./operations/tests/Invoke-OperationsContractTests.ps1
$env:POSTGRES_USER='app'
$env:POSTGRES_PASSWORD='compose-validation-only'
$env:POSTGRES_DB='app'
$env:STUDYTUBE_SITE_ADDRESS='http://localhost'
docker compose -f infra/production.compose.yml config --quiet
Remove-Item Env:POSTGRES_USER,Env:POSTGRES_PASSWORD,Env:POSTGRES_DB,Env:STUDYTUBE_SITE_ADDRESS
```

Expected: every contract passes and `git status --short` remains limited to the plan/spec work.

---

### Task 3: Audit free prerequisites and isolate the StudyTube target

**Files:**
- Reference: `docs/ci-cd.md`
- Reference: `docs/evidence/operations/aws-cost-baseline.md`
- Reference: `.github/workflows/ci-cd.yml`
- No repository modification.

**Interfaces:**
- Consumes: the documented AWS resource names and least-privilege policies.
- Produces: a verified inventory of reusable free resources and absent paid StudyTube resources.

- [ ] **Step 1: Confirm the authenticated AWS account and Seoul region**

Use the logged-in Chrome AWS console. Read the visible account label and compare it with the account that owns the existing deploy role, SES identity, and registered domain. Do not inspect cookies or browser storage.

Store the visible 12-digit account ID only in session state as `$awsAccountId` and verify it matches `^[0-9]{12}$`. Do not commit it.

- [ ] **Step 2: Verify reusable IAM and SES prerequisites**

Confirm:

- GitHub OIDC provider exists for `token.actions.githubusercontent.com`.
- `StudyTubeGitHubDeployRole` trusts only `repo:NearthYou/studytube:ref:refs/heads/main` with audience `sts.amazonaws.com`.
- Its inline deploy policy is limited to the documented release bucket paths, SSM document and instance target, and result reads.
- `StudyTubeEc2RuntimeRole` and its instance profile exist with SSM core, release read, deployment log write, and sender-restricted SES permissions.
- `studytube.page` SES identity and `studytube-transactional` configuration set still exist.
- `studytube.page` registration is active and auto-renew remains off.

If a role is absent, recreate only the documented role and policy. Do not widen existing SketchCatch or account-wide IAM permissions.

- [ ] **Step 3: Prove paid StudyTube resources are absent before recreation**

Check EC2 instances, EBS volumes, Elastic IPs, S3 buckets, Route 53 hosted zones, and `/studytube/deploy`. The prior instance, volume, address, bucket, zone, and log group must be absent or terminally deleted. Record only resource class and count in session notes.

- [ ] **Step 4: Verify GitHub configuration names without reading secret values**

Run:

```powershell
gh secret list --repo NearthYou/studytube
gh variable list --repo NearthYou/studytube
```

Expected: the three AWS secret names and seven documented variable names exist. Their instance and bucket values are stale until Task 6 updates them.

---

### Task 4: Recreate the bounded AWS infrastructure

**Files:**
- Reference: `docs/ci-cd.md`
- Reference: `docs/evidence/operations/aws-cost-baseline.md`
- No repository modification.

**Interfaces:**
- Consumes: the reusable IAM roles and verified AWS account from Task 3.
- Produces: one SSM-managed `t3.micro`, one 30GiB root volume, one Elastic IP, one release bucket, one deployment log group, and one `studytube.page` hosted zone.

- [ ] **Step 1: Recreate the private immutable release bucket**

In Seoul, create the bucket name produced by:

```powershell
$releaseBucket = "studytube-releases-$awsAccountId-ap-northeast-2"
```

Configure it with:

- Object Ownership set to bucket-owner enforced;
- every public-access block enabled;
- versioning enabled;
- Object Lock enabled at creation;
- default Governance retention 30 days;
- SSE-S3 default encryption;
- no public bucket policy.

Apply a lifecycle rule that aborts incomplete multipart uploads after 7 days and removes expired delete markers. Do not create a second bucket when the exact bucket already exists.

- [ ] **Step 2: Recreate deployment logging**

Create `/studytube/deploy` as a Standard CloudWatch log group with 30-day retention and deletion protection. Confirm no SketchCatch log group is selected or edited.

- [ ] **Step 3: Create the network boundary**

Create or reuse a StudyTube-only security group in the default Seoul VPC with inbound rules:

```text
TCP 80  from 0.0.0.0/0 and ::/0
TCP 443 from 0.0.0.0/0 and ::/0
```

Do not add port 22, 3000, 5173, 8000, 5432, or 6379. Leave normal outbound access enabled for package installation, AWS APIs, SES, YouTube, and the configured AI provider.

- [ ] **Step 4: Launch the cost-bounded instance**

Immediately before the final launch action, present the exact instance type, storage, IPv4, region, and estimated monthly cost for confirmation required by the browser safety boundary.

Launch one current Ubuntu 24.04 LTS x86_64 instance with:

- name `studytube-prod`;
- type `t3.micro`;
- CPU credit mode `standard`;
- encrypted gp3 root volume, 30GiB, 3,000 IOPS, 125MB/s, delete-on-termination enabled;
- `StudyTubeEc2RuntimeRole` instance profile;
- the StudyTube-only security group;
- IMDSv2 required;
- detailed monitoring disabled;
- termination protection enabled after bootstrap succeeds;
- no SSH key pair requirement and no port 22 rule.

Use user data only for prerequisite installation and SSM readiness. It must not contain runtime secrets.

- [ ] **Step 5: Retarget the least-privilege deploy policy**

Update only the `StudyTubeImmutableDeploy` inline policy statement that authorizes `ssm:SendCommand` so its EC2 resource is the newly launched `studytube-prod` instance ARN. Keep the repository/branch trust, SSM document, release bucket paths, diagnostics paths, and result-read actions unchanged. Remove the terminated instance ARN from the policy and verify no other instance is authorized.

The release bucket name is recreated with the same account-derived name, so the existing bucket ARN conditions remain valid after the bucket exists. Recheck the runtime role's bucket and CloudWatch resource statements without widening them.

- [ ] **Step 6: Allocate and associate one Elastic IP**

Allocate one VPC Elastic IP, associate it only with `studytube-prod`, and tag it for StudyTube. Verify that the instance has no second billable public IPv4 allocation.

- [ ] **Step 7: Recreate DNS without repurchasing the domain**

Create one public hosted zone for `studytube.page`. Copy its four authoritative name servers into the already-registered domain's name-server configuration, then create an apex A record pointing to the new Elastic IP. Do not register or renew the domain and keep auto-renew off.

---

### Task 5: Bootstrap the production runtime through SSM

**Files:**
- Reference: `scripts/install-production-runtime.sh`
- Reference: `scripts/ssm-deploy-release.sh`
- Reference: `infra/production.compose.yml`
- Reference: `infra/systemd/*.service.in`
- No repository modification unless a verified bootstrap defect requires a separate test-first fix.

**Interfaces:**
- Consumes: the managed EC2 instance, runtime role, release bucket, and DNS target.
- Produces: a root-owned production configuration and all prerequisites required by the first immutable release.

- [ ] **Step 1: Wait for the managed node and inspect prerequisites**

Use Fleet Manager or Systems Manager Managed Nodes until `studytube-prod` is online. Run a read-only SSM command that reports only versions and service state for `aws`, `git`, `tar`, `sha256sum`, `flock`, `systemctl`, `npm`, `python3`, `docker`, and `amazon-ssm-agent`.

- [ ] **Step 2: Install missing runtime prerequisites**

Through one bounded `AWS-RunShellScript` command, install Docker Engine with Compose v2, Git, AWS CLI v2, Node.js 24, npm, Python 3.12 with venv, build tools, `curl`, `jq`, `tar`, `gzip`, `flock`, and CA certificates. Add `ubuntu` to the Docker group and enable Docker. Do not install an SSH daemon or open a port.

Expected: a second version-only SSM command exits 0 for every prerequisite.

- [ ] **Step 3: Generate server-local secrets and write the deployment config**

Generate separate 32-byte hexadecimal values on the instance for the PostgreSQL password, internal AI key, verification pepper, rate-limit pepper, and MCP assertion secret. Because hexadecimal has no URL-reserved characters, use the same PostgreSQL value in `POSTGRES_PASSWORD` and the password segment of `DATABASE_URL`.

Write `/etc/studytube/deployment.env` as root, mode `0600`, with these non-secret values plus the generated values:

```dotenv
APP_USER=ubuntu
APP_GROUP=ubuntu
WEB_ORIGIN=https://studytube.page
STUDYTUBE_SITE_ADDRESS=studytube.page
STUDYTUBE_PUBLIC_URL=https://studytube.page
DATABASE_URL=postgresql://app:${postgres_password}@127.0.0.1:5432/app
POSTGRES_USER=app
POSTGRES_PASSWORD=${postgres_password}
POSTGRES_DB=app
VALKEY_URL=redis://127.0.0.1:6379
COURSE_CUTOVER_MODE=course
COURSE_CUTOVER_STATE_DIR=/var/lib/studytube/course-cutover
AI_SERVICE_URL=http://127.0.0.1:8000
INTERNAL_AI_API_KEY=${internal_ai_key}
AUTH_VERIFICATION_PEPPER=${auth_verification_pepper}
AUTH_RATE_LIMIT_PEPPER=${auth_rate_limit_pepper}
AUTH_MINIMUM_RESPONSE_MS=250
AUTH_RATE_LIMIT_WINDOW_SECONDS=900
AUTH_RATE_LIMIT_MAX_ATTEMPTS=5
AUTH_EMAIL_PROVIDER=ses
AUTH_EMAIL_SENDER=no-reply@studytube.page
AUTH_EMAIL_AWS_CREDENTIAL_SOURCE=instance-role
AUTH_EMAIL_AWS_REGION=ap-northeast-2
AUTH_EMAIL_SES_CONFIGURATION_SET=studytube-transactional
AUTH_EMAIL_POLL_INTERVAL_MS=1000
AUTH_EMAIL_LEASE_MS=30000
AUTH_EMAIL_SEND_TIMEOUT_MS=10000
AUTH_EMAIL_MAX_ATTEMPTS=5
AUTH_EMAIL_RETRY_BASE_MS=1000
AUTH_EMAIL_RETRY_MAX_MS=60000
MCP_SERVICE_ASSERTION_SECRET=${mcp_assertion_secret}
STUDYTUBE_API_SOCKET_PATH=/run/studytube/api.sock
MCP_ALLOWED_HOSTS=127.0.0.1:*,localhost:*,[::1]:*
OTEL_SDK_DISABLED=true
```

The SSM command generates and writes secrets without echoing them. Its output may report only the file owner, mode, required-key presence, and a SHA-256 fingerprint of the complete config.

- [ ] **Step 4: Handle the external AI credential without exposing it**

Check only whether the approved StudyTube SecureString parameter exists; do not print its value. If it exists, grant the runtime role read access to that exact parameter and have the instance append `OPENAI_API_KEY` locally. If it does not exist, pause for the user to enter the key directly into an AWS SecureString field, then continue. Do not copy a key from browser storage, local files, shell history, chat, or logs.

- [ ] **Step 5: Preflight the config boundary without exposing values**

Before the first release exists, run a read-only SSM preflight that reports only ownership, mode, regular-file status, duplicate key names, and the presence of required key names. It must not print values.

```bash
sudo stat -c '%U:%G %a %F' /etc/studytube/deployment.env
sudo awk -F= '{print $1}' /etc/studytube/deployment.env | sort | uniq -d
sudo awk -F= '{print $1}' /etc/studytube/deployment.env | sort
```

Expected: `root:root 600 regular file`, no duplicate-key output, and every required key name appears once. During Task 6, the uploaded checked-in `ssm-deploy-release.sh` performs the authoritative content validation before loading the config. Any command substitution, symlink, wrong owner, wrong mode, duplicate key, or malformed line blocks deployment without replacing the active release.

---

### Task 6: Update GitHub delivery targets and deploy verified main

**Files:**
- Existing: `.github/workflows/ci-cd.yml`
- Existing: `scripts/build-release-artifact.sh`
- Existing: `scripts/send-ssm-deployment.sh`
- Existing: `scripts/ssm-deploy-release.sh`
- Existing: `docs/superpowers/specs/2026-08-17-studytube-ec2-redeployment-design.md`
- Existing: `docs/superpowers/plans/2026-08-17-studytube-ec2-redeployment.md`

**Interfaces:**
- Consumes: the new release bucket and managed instance ID.
- Produces: a green documentation-only PR and a successful main deployment of the same merged SHA.

- [ ] **Step 1: Update only the stale GitHub deployment targets**

Use prompt-based `gh secret set` so values do not appear in arguments or history:

```powershell
gh secret set AWS_RELEASE_BUCKET --repo NearthYou/studytube
gh secret set AWS_SSM_INSTANCE_ID --repo NearthYou/studytube
```

Verify `AWS_DEPLOY_ROLE_ARN` still names `StudyTubeGitHubDeployRole`; reset it only if its existing value is stale. Keep the documented variables unchanged unless the console audit proves drift.

- [ ] **Step 2: Push the documentation-only branch**

Run:

```powershell
git status --short
git diff --name-status origin/main...HEAD
git push origin codex/fix-profile-and-watch-empty
```

Expected: only the redeployment spec and plan differ from `main`.

- [ ] **Step 3: Open the redeployment PR**

Create a PR to `main` whose body states:

- the approved `$16.42~$16.46` cost boundary;
- the exact AWS resource classes being recreated;
- local verification commands and results;
- `docs/presentation` exclusion;
- that merging triggers the immutable SSM deploy.

Run:

```powershell
$prBodyPath = Join-Path $env:TEMP 'studytube-redeploy-pr.md'
gh pr create --repo NearthYou/studytube --base main --head codex/fix-profile-and-watch-empty --title "Document and restore the StudyTube EC2 deployment" --body-file $prBodyPath
Remove-Item -LiteralPath $prBodyPath
```

Create the temporary PR body outside the repository and remove it after the command succeeds.

- [ ] **Step 4: Wait for every required PR check**

Run:

```powershell
$prNumber = gh pr view codex/fix-profile-and-watch-empty --repo NearthYou/studytube --json number --jq '.number'
gh pr checks $prNumber --repo NearthYou/studytube --watch
```

Expected: Security, Web, API, Backend Integration, and AI succeed. The deploy job is skipped on the pull request. Diagnose a failed check from its first failing step before changing code.

- [ ] **Step 5: Merge and watch the main deployment**

Merge the green PR using the repository's allowed merge method, then capture the merge SHA. Watch the resulting `CI/CD` main run until Security, Web, API, Backend Integration, AI, and `Deploy immutable release with SSM` all succeed.

Run:

```powershell
gh pr merge $prNumber --repo NearthYou/studytube --merge --delete-branch=false
gh run list --repo NearthYou/studytube --branch main --workflow ci-cd.yml --limit 3
$mainRunId = gh run list --repo NearthYou/studytube --branch main --workflow ci-cd.yml --limit 1 --json databaseId --jq '.[0].databaseId'
gh run watch $mainRunId --repo NearthYou/studytube --exit-status
```

Do not rerun a failed deployment blindly. Inspect the restricted SSM/CloudWatch diagnostics, fix the specific target or bootstrap problem, and dispatch the same main SHA only after the cause is resolved.

---

### Task 7: Verify the live service and the cost boundary

**Files:**
- Verify: `api/openapi/current.json`
- Verify: `web/tests/watchAccessibility.test.ts`
- Verify: `docs/evidence/operations/aws-cost-baseline.md`
- No production evidence file is required for this scoped redeployment.

**Interfaces:**
- Consumes: the successfully deployed main SHA.
- Produces: live DNS, TLS, browser-flow, service-state, port-boundary, and cost-inventory evidence.

- [ ] **Step 1: Verify DNS, HTTP, and TLS**

Run:

```powershell
Resolve-DnsName studytube.page -Type A
curl.exe -I --max-time 15 http://studytube.page
curl.exe -I --max-time 15 https://studytube.page
curl.exe -I --max-time 15 https://studytube.page/api/internal
curl.exe -I --max-time 15 https://studytube.page/api/health/ready
```

Expected: DNS points to the new Elastic IP, HTTP redirects to HTTPS, the public page responds successfully, and internal/readiness routes return 404 at the Caddy boundary.

- [ ] **Step 2: Verify service and port isolation through SSM**

Run a read-only SSM command for:

```bash
systemctl is-active studytube-api studytube-ai studytube-worker studytube-caddy
docker compose -f /opt/studytube/current/infra/production.compose.yml ps
ss -lnt
readlink -f /opt/studytube/current
```

Expected: all application services are active, PostgreSQL and Valkey are healthy, only 80 and 443 are public listeners, application/data listeners are loopback or Unix sockets, and the current link ends in the deployed main SHA.

- [ ] **Step 3: Verify the repaired browser flows**

Using a dedicated test account in Chrome:

1. Request a signup email and confirm the user-facing error language is Korean when a request fails.
2. Complete login through the production proxy.
3. Save profile preferences and confirm no `Cannot PUT /me` error appears.
4. Open `/watch` with no registered videos and confirm the empty-state guidance is visible.
5. Confirm the session cookie is `Secure`, `HttpOnly`, and host-only without exposing its value.

Do not run broad load or fault-injection tests against the portfolio deployment.

- [ ] **Step 4: Verify the AWS resource and cost inventory**

Confirm exactly one StudyTube `t3.micro`, one 30GiB gp3 root volume, one associated Elastic IP, one hosted zone, one release bucket, and one deployment log group. Confirm no StudyTube RDS, ElastiCache, ECS, NAT Gateway, load balancer, CloudFront, or OpenSearch resource exists.

After billing data has refreshed, compare the StudyTube daily cost against the `$16.42~$16.46` monthly estimate. Report billing lag separately and do not treat a partial first day as a full-month observation.

- [ ] **Step 5: Record the final handoff**

Report:

- deployed main SHA and GitHub run URL;
- public URL and live verification result;
- created StudyTube resource classes and counts without exposing operational IDs;
- expected monthly StudyTube cost;
- SES sandbox and single-instance availability limitations;
- Amazon Q deletion automation as a separate SketchCatch cost action.

## Plan Self-Review

- Spec coverage: Tasks 3 and 4 implement the bounded AWS inventory; Task 5 restores the private runtime and secret boundary; Task 6 restores OIDC/SSM delivery; Task 7 covers DNS, TLS, repaired flows, service recovery, port isolation, and cost verification.
- Placeholder scan: runtime values are represented by named PowerShell or shell variables; there are no deferred implementation markers, angle-bracket placeholders, or unspecified error-handling steps.
- Type and name consistency: the release bucket, roles, log group, config path, deploy root, and GitHub secret/variable names match `docs/ci-cd.md` and `.github/workflows/ci-cd.yml`.
- Scope check: no task modifies `docs/presentation`, Amazon Q, SketchCatch infrastructure, or an excluded managed service.
- Verification depth: existing behavior is characterized locally, fully checked again in PR CI, deployed only from `main`, and verified with bounded live checks rather than production load or fault injection.
