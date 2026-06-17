# agentic-board

This repository is organized as a multi-app workspace so NestJS, FastAPI, React, and PostgreSQL can live side by side without stepping on each other.

## Structure

```text
agentic-board/
  apps/
    nest-api/
    fastapi-api/
    web-react/
  docker-compose.yml
```

## Apps

- `apps/nest-api`: NestJS backend
- `apps/fastapi-api`: FastAPI backend
- `apps/web-react`: React frontend powered by Vite
- `docker-compose.yml`: local PostgreSQL container

## Quick start

### NestJS

```powershell
npm run nest:install
npm run nest:start
```

### FastAPI

```powershell
python -m venv apps/fastapi-api/.venv
.\apps\fastapi-api\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
cd apps/fastapi-api
uvicorn main:app --reload
```

### React

```powershell
npm run web:install
npm run web:dev
```

### PostgreSQL

```powershell
npm run db:up
```

Stop it with:

```powershell
npm run db:down
```
