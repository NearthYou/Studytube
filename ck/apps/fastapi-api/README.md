# FastAPI API

This folder contains the FastAPI backend.

## Setup

```powershell
cd apps/fastapi-api
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Run

```powershell
cd apps/fastapi-api
.\.venv\Scripts\Activate.ps1
uvicorn main:app --reload
```

## Environment

Copy `.env.example` to `.env` when you are ready to wire the app to PostgreSQL.
