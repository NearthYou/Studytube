from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv


AI_BACK_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = AI_BACK_ROOT.parent
DEFAULT_DEV_DATABASE_URL = "postgresql://postgres:1234@localhost:5433/travel_app"
DEFAULT_DEV_BACK_API_BASE_URL = "http://127.0.0.1:3000/api"
DEFAULT_DEV_CORS_ORIGINS = ("http://localhost:5173", "http://127.0.0.1:5173")
PLACEHOLDER_API_KEYS = {"your-openai-api-key"}
PLACEHOLDER_INTERNAL_TOKENS = {
    "change-this-internal-token",
    "change-this-local-internal-token",
}
MIN_INTERNAL_TOKEN_LENGTH = 32

load_dotenv(AI_BACK_ROOT / ".env", override=False)
load_dotenv(WORKSPACE_ROOT / "back" / ".env", override=False)


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


def get_csv_setting(name: str, dev_default: tuple[str, ...]) -> list[str]:
    value = os.getenv(name, "").strip()

    if value:
        items = [item.strip() for item in value.split(",") if item.strip()]
        if is_production() and "*" in items:
            raise RuntimeError(f"{name} cannot include * in production.")
        return items

    if is_production():
        raise RuntimeError(f"{name} is required in production.")

    return list(dev_default)


def get_api_key(*names: str) -> str:
    for name in names:
        value = os.getenv(name, "").strip()
        if not value:
            continue
        if is_production() and value in PLACEHOLDER_API_KEYS:
            raise RuntimeError(f"{name} must be changed in production.")
        return value

    if is_production():
        raise RuntimeError(f"{names[0]} is required in production.")

    return ""


def get_internal_api_token() -> str:
    value = os.getenv("INTERNAL_API_TOKEN", "").strip()

    if value:
        if is_production() and value in PLACEHOLDER_INTERNAL_TOKENS:
            raise RuntimeError("INTERNAL_API_TOKEN must be changed in production.")
        if is_production() and len(value) < MIN_INTERNAL_TOKEN_LENGTH:
            raise RuntimeError(
                f"INTERNAL_API_TOKEN must be at least {MIN_INTERNAL_TOKEN_LENGTH} characters in production.",
            )
        return value

    if is_production():
        raise RuntimeError("INTERNAL_API_TOKEN is required in production.")

    return ""


def _is_dev_database_url(value: str) -> bool:
    return value == DEFAULT_DEV_DATABASE_URL or "YOUR_PASSWORD" in value


def _is_local_url(value: str) -> bool:
    normalized = value.lower()
    return normalized.startswith("http://localhost") or normalized.startswith(
        "http://127.0.0.1",
    )


DATABASE_URL = get_setting("DATABASE_URL", DEFAULT_DEV_DATABASE_URL)
BACK_API_BASE_URL = get_setting("BACK_API_BASE_URL", DEFAULT_DEV_BACK_API_BASE_URL)
CORS_ORIGINS = get_csv_setting("CORS_ORIGINS", DEFAULT_DEV_CORS_ORIGINS)
OPENAI_API_KEY = get_api_key("OPENAI_API_KEY", "GPT_API_KEY")
INTERNAL_API_TOKEN = get_internal_api_token()
GPT_MODEL = os.getenv("GPT_MODEL", "gpt-4.1-mini").strip() or "gpt-4.1-mini"
