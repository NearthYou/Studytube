from datetime import datetime, timezone
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
import psycopg

AI_DIR = Path(__file__).resolve().parent
ROOT_DIR = AI_DIR.parent

load_dotenv(ROOT_DIR / ".env")
load_dotenv(AI_DIR / ".env", override=True)

DEFAULT_DATABASE_URL = "postgresql://app:app@localhost:5432/app_dev"

app = FastAPI(title="AI Study Service")


@app.get("/health")
def health():
    return {
        "service": "ai",
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/health/db")
def database_health():
    database_url = os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)

    try:
        with psycopg.connect(database_url, connect_timeout=3) as conn:
            with conn.cursor() as cursor:
                cursor.execute("SELECT 1 AS ok")
                row = cursor.fetchone()

        return {
            "service": "ai",
            "status": "ok" if row and row[0] == 1 else "unknown",
            "database": "postgresql",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as exc:
        return {
            "service": "ai",
            "status": "degraded",
            "database": "postgresql",
            "message": str(exc),
        }
