# Nest API

This folder contains the existing NestJS backend for the `agentic-board` workspace.

## Run

```powershell
cd apps/nest-api
npm install
npm run start:dev
```

## Test

```powershell
cd apps/nest-api
npm test
npm run test:e2e
```

## Google OAuth

Google login uses the existing httpOnly auth cookies. Configure these values in
`apps/nest-api/.env` before using the Google button:

```env
GOOGLE_OAUTH_CLIENT_ID="your-google-client-id"
GOOGLE_OAUTH_CLIENT_SECRET="your-google-client-secret"
GOOGLE_OAUTH_REDIRECT_URI="http://localhost:3000/auth/google/callback"
GOOGLE_OAUTH_STATE_SECRET="a-long-random-state-secret"
WEB_APP_ORIGIN="http://localhost:5173"
```

In Google Cloud Console, add the same redirect URI:
`http://localhost:3000/auth/google/callback`.
