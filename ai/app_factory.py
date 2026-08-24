from __future__ import annotations

from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
import hmac
import os
from typing import Any, Callable

from mcp_server import (
    GatewaySettings,
    create_mcp_server,
    create_streamable_http_app,
)
from telemetry import configure_fastapi_telemetry

try:
    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse
except ModuleNotFoundError:  # pragma: no cover - local dependency readiness guard
    class FastAPI:  # type: ignore[override]
        def __init__(self, *_args: Any, **_kwargs: Any) -> None:
            self.routes: list[Any] = []

        def get(self, *_args: Any, **_kwargs: Any):
            return _identity_decorator

        def post(self, *_args: Any, **_kwargs: Any):
            return _identity_decorator

        def middleware(self, *_args: Any, **_kwargs: Any):
            return _identity_decorator

        def mount(self, *_args: Any, **_kwargs: Any) -> None:
            return None

    def _identity_decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        return func

    Request = Any  # type: ignore[misc,assignment]
    JSONResponse = None

try:
    import psycopg
except ModuleNotFoundError:  # pragma: no cover - local dependency readiness guard
    psycopg = None


DEFAULT_DATABASE_URL = "postgresql://app:app@localhost:5432/app_dev"


@dataclass(frozen=True)
class FeatureHandlers:
    embedding: Callable[[dict[str, Any]], dict[str, Any]]
    youtube_lookup: Callable[[dict[str, Any]], dict[str, Any]]
    youtube_captions: Callable[[dict[str, Any]], dict[str, Any]]
    youtube_transcribe: Callable[[dict[str, Any]], dict[str, Any]]
    live_caption_transcribe: Callable[[dict[str, Any]], dict[str, Any]]
    youtube_summary: Callable[[dict[str, Any]], dict[str, Any]]
    study_plan: Callable[[dict[str, Any]], dict[str, Any]]
    quiz_generation: Callable[[dict[str, Any]], dict[str, Any]]
    caption_health: Callable[[], dict[str, bool]]
    openai_configured: Callable[[], bool]


@dataclass(frozen=True)
class ApplicationRuntime:
    app: Any
    mcp_server: Any
    mcp_application: Any
    telemetry_runtime: Any
    application_lifespan: Callable[..., Any]
    require_internal_service_key: Callable[..., Any]
    health: Callable[..., Any]
    database_health: Callable[..., Any]
    embeddings_endpoint: Callable[..., Any]
    youtube_lookup_endpoint: Callable[..., Any]
    youtube_captions_endpoint: Callable[..., Any]
    youtube_transcribe_endpoint: Callable[..., Any]
    live_caption_transcribe_endpoint: Callable[..., Any]
    youtube_summary_endpoint: Callable[..., Any]
    study_plan_endpoint: Callable[..., Any]
    quiz_generation_endpoint: Callable[..., Any]


def require_production_internal_key() -> None:
    if os.getenv("NODE_ENV", "").strip().lower() != "production":
        return

    key = os.getenv("INTERNAL_AI_API_KEY", "").strip()
    normalized = key.casefold()
    if len(key) < 32 or any(
        marker in normalized
        for marker in ("change-me", "replace-with", "example", "placeholder")
    ):
        raise RuntimeError(
            "INTERNAL_AI_API_KEY must be a non-placeholder secret of at least "
            "32 characters in production"
        )


def is_mcp_protocol_path(path: str) -> bool:
    return path == "/mcp" or path.startswith("/mcp/")


def create_application(handlers: FeatureHandlers) -> ApplicationRuntime:
    mcp_settings = GatewaySettings.from_environment()
    mcp_server = create_mcp_server(settings=mcp_settings)
    mcp_application = create_streamable_http_app(
        mcp_server,
        path="/mcp",
        host=os.getenv("MCP_BIND_HOST", "127.0.0.1").strip() or "127.0.0.1",
        allowed_hosts=mcp_settings.allowed_hosts,
    )
    telemetry_runtime = None

    @asynccontextmanager
    async def application_lifespan(_app: FastAPI):
        try:
            require_production_internal_key()
            async with mcp_server.session_manager.run():
                yield
        finally:
            if telemetry_runtime is not None:
                telemetry_runtime.shutdown()

    app = FastAPI(title="StudyTube AI Service", lifespan=application_lifespan)
    telemetry_runtime = configure_fastapi_telemetry(app)

    @app.middleware("http")
    async def require_internal_service_key(request: Request, call_next):
        expected = os.getenv("INTERNAL_AI_API_KEY", "").strip()
        if expected and request.method != "GET" and not is_mcp_protocol_path(
            request.url.path
        ):
            provided = request.headers.get("x-internal-api-key", "")
            if not hmac.compare_digest(provided, expected):
                return JSONResponse(
                    status_code=401,
                    content={"detail": "Internal service authentication required"},
                )
        return await call_next(request)

    @app.get("/health")
    def health():
        return {
            "service": "ai",
            "status": "ok",
            "llmModel": os.getenv("LLM_MODEL", "gpt-4o-mini"),
            "embeddingModel": os.getenv(
                "EMBEDDING_MODEL", "text-embedding-3-small"
            ),
            "openaiConfigured": handlers.openai_configured(),
            "youtubeCaptions": handlers.caption_health(),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    @app.get("/health/db")
    def database_health():
        if psycopg is None:
            return {
                "service": "ai",
                "status": "degraded",
                "database": "unavailable",
                "message": "psycopg is not installed in this Python environment.",
            }

        database_url = os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)
        try:
            with psycopg.connect(database_url, connect_timeout=3) as conn:
                with conn.cursor() as cursor:
                    cursor.execute("SELECT 1 AS ok")
                    row = cursor.fetchone()
            return {
                "service": "ai",
                "status": "ok" if row and row[0] == 1 else "unknown",
                "database": "postgresql + pgvector",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as exc:
            return {
                "service": "ai",
                "status": "degraded",
                "database": "postgresql",
                "message": str(exc),
            }

    @app.post("/embeddings")
    def embeddings_endpoint(payload: dict[str, Any]):
        return handlers.embedding(payload)

    @app.post("/youtube/lookup")
    def youtube_lookup_endpoint(payload: dict[str, Any]):
        return handlers.youtube_lookup(payload)

    @app.post("/youtube/captions")
    def youtube_captions_endpoint(payload: dict[str, Any]):
        return handlers.youtube_captions(payload)

    @app.post("/youtube/transcribe")
    def youtube_transcribe_endpoint(payload: dict[str, Any]):
        return handlers.youtube_transcribe(payload)

    @app.post("/live-captions/transcribe")
    def live_caption_transcribe_endpoint(payload: dict[str, Any]):
        return handlers.live_caption_transcribe(payload)

    @app.post("/youtube/summary")
    def youtube_summary_endpoint(payload: dict[str, Any]):
        return handlers.youtube_summary(payload)

    @app.post("/agent/study-plan")
    def study_plan_endpoint(payload: dict[str, Any]):
        return handlers.study_plan(payload)

    @app.post("/quiz/generate")
    def quiz_generation_endpoint(payload: dict[str, Any]):
        return handlers.quiz_generation(payload)

    app.mount("/", mcp_application)
    return ApplicationRuntime(
        app=app,
        mcp_server=mcp_server,
        mcp_application=mcp_application,
        telemetry_runtime=telemetry_runtime,
        application_lifespan=application_lifespan,
        require_internal_service_key=require_internal_service_key,
        health=health,
        database_health=database_health,
        embeddings_endpoint=embeddings_endpoint,
        youtube_lookup_endpoint=youtube_lookup_endpoint,
        youtube_captions_endpoint=youtube_captions_endpoint,
        youtube_transcribe_endpoint=youtube_transcribe_endpoint,
        live_caption_transcribe_endpoint=live_caption_transcribe_endpoint,
        youtube_summary_endpoint=youtube_summary_endpoint,
        study_plan_endpoint=study_plan_endpoint,
        quiz_generation_endpoint=quiz_generation_endpoint,
    )
