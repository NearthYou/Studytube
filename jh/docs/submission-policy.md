# Submission Policy

## Submission Unit

Submit the project root archive, not the nested `backend` git repository alone.

The archive must include:

- `README.md`
- `.env.example`
- `frontend`
- `backend`
- `AI`
- `docs`
- `scripts`

The nested `backend/.git` directory is local development metadata and must not be included in the submitted archive.

## Excluded Runtime Artifacts

Do not include:

- `.env` or service-specific `.env` files
- `node_modules`
- `dist`
- `coverage`
- `.venv`
- `uploads`
- `.playwright-cli`
- `.pytest_cache`
- `__pycache__`
- `tmp`
- `output`
- log files and OS metadata files such as `.DS_Store`

## Required Dry Run

Run this from the project root before packaging:

```bash
node scripts/check-submission-manifest.mjs
```

The dry run verifies that required source, lockfile, migration, test, and documentation paths are present in the intended archive set while local runtime artifacts are excluded. It also fails on token-like committed secrets, high-risk files such as `.key`, `.pem`, `.log`, `.db`, `.sqlite`, and live-smoke target drift between `.env.example`, docs, and `scripts/live-smoke.mjs`.
