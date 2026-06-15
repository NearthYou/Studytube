# Tail Talk production stabilization

This directory contains deploy-time helpers that are safe to commit. Secrets
still belong only in the EC2 `.env.production` file.

## Required EC2 env values

Copy `deploy/env.production.example` to `.env.production` on the EC2 host and
fill these production-only values:

```env
DATABASE_URL=postgres://tailtalk:PASSWORD@RDS_ENDPOINT:5432/tailtalk?sslmode=require&uselibpqcompat=true
JWT_SECRET=at-least-32-characters
VITE_KAKAO_MAP_JS_KEY=Kakao JavaScript key
VITE_ENABLED_SOCIAL_PROVIDERS=kakao
MAIL_HOST=smtp provider host
MAIL_PORT=587
MAIL_SECURE=false
MAIL_USER=smtp user
MAIL_PASSWORD=smtp app password
MAIL_FROM="Tail Talk <noreply@pongki.shop>"
TOUR_API_SERVICE_KEY=TourAPI key
```

`VITE_ENABLED_SOCIAL_PROVIDERS` is a comma-separated allow-list. Keep only
providers that are fully configured. For the current production setup use
`kakao`; later values can be `kakao,google` or `kakao,google,naver`.

Kakao requires two separate app settings:

- Kakao Login redirect URI:
  `https://pongki.shop/api/auth/social/kakao/callback`
- Kakao JavaScript key Web platform domains:
  `https://pongki.shop` and `https://www.pongki.shop`

Any change to `VITE_*` values requires rebuilding the frontend image because
Vite embeds these values at build time.

## Category seed

Run once against the RDS `tailtalk` database:

```bash
PSQL_URL=$(sed -n 's/^DATABASE_URL=//p' .env.production | sed 's/^"//; s/"$//; s/[?&]uselibpqcompat=true//; s/?&/?/; s/&$//; s/?$//')
psql "$PSQL_URL" -f deploy/seed-categories.sql
```

Success check:

```bash
curl -i https://pongki.shop/api/categories
```

The response must include the four category values `daily`, `walk`, `care`,
and `question`.

## Host Nginx

Use `deploy/pongki-host-nginx-notes.md` as the checklist for EC2 host Nginx
headers and `server_tokens off`.

## Production smoke

After `git pull` and Docker rebuild, run the live smoke from the EC2 repo:

```bash
RUN_LIVE_SMOKE=true \
LIVE_SMOKE_TARGETS=frontend,frontend-api,backend,auth,agent,crud,upload,tourapi,kakao-map,frontend-bundle,security,cors \
FRONTEND_URL=https://pongki.shop \
BACKEND_URL=https://pongki.shop \
node scripts/live-smoke.mjs
```

Common failures:

| Failure text | Likely cause | Fix |
| --- | --- | --- |
| `domain mismatched` | Kakao JavaScript key Web platform domain is missing | Add `https://pongki.shop` and `https://www.pongki.shop` in Kakao Developers, then rebuild frontend |
| `frontend bundle does not contain configured VITE_KAKAO_MAP_JS_KEY` | `.env.production` changed but frontend image was not rebuilt | `docker compose ... build --no-cache frontend` and recreate |
| `categories seed is incomplete` | RDS category seed was not run | Run the category seed command above |
| `http://tong.visitkorea.or.kr` | TourAPI images were not normalized to HTTPS | Rebuild backend with the latest mapper |
| `X-Powered-By` | Backend image or host proxy is still exposing Express metadata | Rebuild backend and reload host Nginx |
| `missing security headers` | Host Nginx security headers were not applied | Apply `deploy/pongki-host-nginx-notes.md`, then reload Nginx |
| social button mismatch | `VITE_ENABLED_SOCIAL_PROVIDERS` does not match configured providers | Set it to `kakao` for current production and rebuild frontend |
