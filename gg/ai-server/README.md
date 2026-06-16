# AI Server

FastAPI 기반 AI 서버입니다.

## 실행

```bash
cd ai-server
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

## 공개 상태 확인

```bash
curl http://localhost:8000/health
```

## 내부 상태 확인

NestJS 같은 내부 서버가 호출하는 health check입니다.

```bash
curl http://localhost:8000/internal/health \
  -H "X-Internal-Token: change-me"
```

`X-Internal-Token` 값은 `AI_INTERNAL_TOKEN` 환경변수와 같아야 합니다.
