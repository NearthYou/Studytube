# CI/CD Setup

This project lives at the repository root and uses GitHub Actions for CI and EC2 deployment. The EC2 deployment steps live in `scripts/deploy-ec2.sh` so local/manual deploys and GitHub Actions run the same commands.

## What CI Checks

The workflow at `.github/workflows/ci-cd.yml` runs three jobs in parallel:

- Web: install, lint, Node tests, Vite build.
- API: start a pgvector PostgreSQL service, apply migrations, verify the explicit demo seed is idempotent, run unit and database-backed end-to-end tests, lint, and build.
- AI: install Python dependencies, unittest discovery.

CI runs on pull requests and pushes to `main`. Because the repository contains only this application, every change is validated.

EC2 배포는 CI가 검증한 `github.sha`를 원격 브랜치와 다시 대조한 뒤 해당 SHA의 배포 스크립트와 소스만 사용합니다. 새 push는 진행 중인 배포를 취소하지 않으며, 브랜치가 앞서간 오래된 workflow는 실행 중인 서비스를 중단하기 전에 실패합니다.

## What CD Does

The deploy job runs after all CI jobs pass when:

- code is pushed to `main`, or
- the workflow is manually started with `workflow_dispatch`.

The deploy job connects to EC2 over SSH, updates the selected branch, installs dependencies, restarts `npm run all`, and checks:

- `http://localhost:3000/health/ready`
- `http://localhost:8000/health`
- `http://localhost:5173/`

The EC2 deploy step also ensures a 2GB `/swapfile` is active before installing dependencies. This keeps `npm ci --prefix api` from being killed on small instances.

Runtime secrets such as `.env`, YouTube cookies, and PO token files stay at the repository root on EC2. They are not copied into GitHub Actions.

## Pull-Based CD Without GitHub Secrets

If `EC2_SSH_KEY` is not configured in GitHub, EC2 can still deploy automatically by polling GitHub. The script `scripts/ec2-autodeploy.sh` checks `origin/main`, waits for the matching `CI/CD` workflow run to finish successfully, and then runs `scripts/deploy-ec2.sh`.

Install the EC2 timer once:

```bash
cd /home/ubuntu/studytube
APP_DIR=/home/ubuntu/studytube DEPLOY_BRANCH=main bash scripts/install-ec2-autodeploy.sh
```

This creates a user systemd timer that checks every two minutes. If user systemd is unavailable, the installer falls back to cron.

## Required GitHub Secrets

Set these in GitHub:

- `EC2_SSH_KEY`: private key content for the EC2 key pair.

Optional:

- `EC2_HOST`: EC2 public IP or DNS. Defaults to `15.164.98.162`.
- `EC2_USER`: SSH user. Defaults to `ubuntu`.
- `EC2_APP_DIR`: app path on EC2. Defaults to `/home/ubuntu/studytube` if empty.
- `EC2_REPO_DIR`: repository checkout path on EC2. Defaults to `/home/ubuntu/studytube` if empty.

If `EC2_SSH_KEY` is missing, the deploy job succeeds with a notice and skips deployment. This keeps CI green while deployment credentials are not configured.

## Manual Deploy

Open GitHub Actions, choose `CI/CD`, then run the workflow manually from `main`.

## Manual EC2 Deploy Check

After SSHing into EC2:

```bash
cd /home/ubuntu/studytube
APP_DIR=/home/ubuntu/studytube DEPLOY_BRANCH=main bash scripts/deploy-ec2.sh main
```
