from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv


ROOT_DIR = Path(__file__).resolve().parents[1]
load_dotenv(ROOT_DIR / "ai-back" / ".env", override=False)
load_dotenv(ROOT_DIR / "back" / ".env", override=False)


DEFAULT_DEV_DATABASE_URL = "postgresql://postgres:1234@localhost:5433/travel_app"
DEFAULT_DEV_BACK_API_BASE_URL = "http://127.0.0.1:3000/api"
PLACEHOLDER_API_KEYS = {"your-openai-api-key"}


def is_production() -> bool:
    return any(
        os.getenv(key, "").strip().lower() == "production"
        for key in ("APP_ENV", "ENV", "NODE_ENV")
    )


def get_setting(name: str, dev_default: str | None = None) -> str:
    value = os.getenv(name, "").strip()

    if value:
        if is_production() and name == "DATABASE_URL" and _is_dev_database_url(value):
            raise RuntimeError("DATABASE_URL must be changed in production.")
        if is_production() and name == "BACK_API_BASE_URL" and _is_local_url(value):
            raise RuntimeError("BACK_API_BASE_URL must not use localhost in production.")
        return value

    if is_production():
        raise RuntimeError(f"{name} is required in production.")

    if dev_default is None:
        raise RuntimeError(f"{name} is required.")

    return dev_default


def get_openai_api_key() -> str:
    value = os.getenv("OPENAI_API_KEY", "").strip() or os.getenv(
        "GPT_API_KEY",
        "",
    ).strip()

    if value:
        if is_production() and value in PLACEHOLDER_API_KEYS:
            raise RuntimeError("OPENAI_API_KEY must be changed in production.")
        return value

    if is_production():
        raise RuntimeError("OPENAI_API_KEY is required in production.")

    return ""


def _is_dev_database_url(value: str) -> bool:
    return value == DEFAULT_DEV_DATABASE_URL or "YOUR_PASSWORD" in value


def _is_local_url(value: str) -> bool:
    normalized = value.lower()
    return normalized.startswith("http://localhost") or normalized.startswith(
        "http://127.0.0.1",
    )


BACK_API_BASE_URL = get_setting("BACK_API_BASE_URL", DEFAULT_DEV_BACK_API_BASE_URL)
DATABASE_URL = get_setting("DATABASE_URL", DEFAULT_DEV_DATABASE_URL)
OPENAI_API_KEY = get_openai_api_key()
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")
EMBEDDING_DIMENSIONS = int(os.getenv("EMBEDDING_DIMENSIONS", "1536"))
