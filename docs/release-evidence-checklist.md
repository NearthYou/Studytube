# Release Evidence Checklist

Use this checklist before calling a staging, demo, or production release `GO`.
Do not paste secrets, tokens, provider query strings, or raw `.env` values into this file.

## Environment Identity

- Environment name:
- Verification date/time with timezone:
- Frontend URL:
- Backend primary URL:
- Backend secondary URL for upload read:
- AI worker URL:
- Commit/archive identifier:
- Reviewer:

## Preflight Evidence

- `node scripts/verify-local-gates.mjs`: `PASS` / `FAIL`
- `node scripts/check-submission-manifest.mjs`: `PASS` / `FAIL`
- Final frontend origin is registered in Kakao Developers: `YES` / `NO`
- Backend `FRONTEND_ORIGINS` includes the final frontend origin: `YES` / `NO`
- Frontend bundle API base origin matches the final backend origin: `YES` / `NO`
- `UPLOAD_LOCAL_ROOT` is an absolute shared persistent mount and exists/writable, or the deployment is explicitly accepted as a single-instance demo: `YES` / `NO`
- Production smoke account is dedicated, secret-managed, and password-rotated for this run: `YES` / `NO`

## Strict Live Smoke

Run the same target set unless a release manager explicitly scopes a feature out.

```bash
RUN_LIVE_SMOKE=true \
LIVE_SMOKE_FAIL_ON_SKIP=true \
LIVE_SMOKE_TARGETS=frontend,frontend-api,backend,auth,agent,crud,upload,tourapi,kakao-map,ai,openai \
node scripts/live-smoke.mjs
```

Record only the non-secret summary:

- Overall: `PASS` / `FAIL`
- `frontend`: `PASS` / `FAIL`
- `frontend-api`: `PASS` / `FAIL`
- `backend`: `PASS` / `FAIL`
- `auth`: `PASS` / `FAIL`
- `agent`: `PASS` / `FAIL`
- `crud`: `PASS` / `FAIL`
- `upload`: `PASS` / `FAIL`
- `tourapi`: `PASS` / `FAIL`
- `kakao-map`: `PASS` / `FAIL`
- `ai`: `PASS` / `FAIL`
- `openai`: `PASS` / `FAIL`
- Any `SKIP`: `YES` / `NO`
- Any `OMIT`: `YES` / `NO`

## Upload And Cleanup Evidence

- Primary backend uploaded and read WebP image URLs: `YES` / `NO`
- Secondary backend read the same uploaded image path: `YES` / `NO`
- Post/image delete cleanup made the old image URL return non-`200`: `YES` / `NO`
- `npm run smoke:user:delete` succeeded after the run: `YES` / `NO`
- Smoke account deletion reported remaining data: `NO` / table names:

## Go / No-Go

Release status: `GO` / `NO-GO`

NO-GO if any selected strict live-smoke target is `FAIL` or `SKIP`, if the final Kakao origin is not registered, if secondary upload read was required but not proven, or if smoke account cleanup leaves remaining data.

Notes:
