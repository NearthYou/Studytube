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
VITE_ENABLED_SOCIAL_PROVIDERS=
MAIL_HOST=smtp provider host
MAIL_PORT=587
MAIL_SECURE=false
MAIL_USER=smtp user
MAIL_PASSWORD=smtp app password
MAIL_FROM="Tail Talk <noreply@pongki.shop>"
TOUR_API_SERVICE_KEY=TourAPI key
```

Leave `VITE_ENABLED_SOCIAL_PROVIDERS` empty until a provider is fully
configured. Later, use comma-separated ids such as `kakao` or `kakao,google`.

## Category seed

Run once against the RDS `tailtalk` database:

```bash
psql "$DATABASE_URL" -f deploy/seed-categories.sql
```

Success check:

```bash
curl -i https://pongki.shop/api/categories
```

## Host Nginx

Use `deploy/pongki-host-nginx-notes.md` as the checklist for EC2 host Nginx
headers and `server_tokens off`.
