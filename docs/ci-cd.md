# CI/CD Setup

This project uses GitHub Actions for CI and EC2 deployment.

## What CI Checks

The workflow at `.github/workflows/ci-cd.yml` runs three jobs in parallel:

- Web: install, lint, Node tests, Vite build.
- API: install, lint, Jest tests, Nest build.
- AI: install Python dependencies, unittest discovery.

CI runs on pull requests and pushes to `main` and `sw`.

## What CD Does

The deploy job runs after all CI jobs pass when:

- code is pushed to `sw`, or
- the workflow is manually started with `workflow_dispatch`.

The deploy job connects to EC2 over SSH, updates the selected branch, installs dependencies, restarts `npm run all`, and checks:

- `http://localhost:3000/health`
- `http://localhost:3000/health/ai`
- `http://localhost:5173/`

The EC2 deploy step also ensures a 2GB `/swapfile` is active before installing dependencies. This keeps `npm ci --prefix api` from being killed on small instances.

Runtime secrets such as `.env`, YouTube cookies, and PO token files stay on EC2. They are not copied into GitHub Actions.

## Required GitHub Secrets

Set these in GitHub:

- `EC2_SSH_KEY`: private key content for the EC2 key pair.

Optional:

- `EC2_HOST`: EC2 public IP or DNS. Defaults to `15.164.98.162`.
- `EC2_USER`: SSH user. Defaults to `ubuntu`.
- `EC2_APP_DIR`: app path on EC2. Defaults to `/home/ubuntu/agentic-board` if empty.

If `EC2_SSH_KEY` is missing, the deploy job succeeds with a notice and skips deployment. This keeps CI green while deployment credentials are not configured.

## Manual Deploy

Open GitHub Actions, choose `CI/CD`, then run the workflow manually. Use the `sw` branch unless you intentionally want to deploy another branch.
