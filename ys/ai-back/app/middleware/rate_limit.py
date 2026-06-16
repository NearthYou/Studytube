from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response


@dataclass(frozen=True)
class RateLimitRule:
    name: str
    method: str | None
    path_prefix: str
    window_seconds: int
    max_requests: int


@dataclass
class RateLimitBucket:
    count: int
    reset_at: float


def _positive_int(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, ""))
    except ValueError:
        return default

    return value if value > 0 else default


class InMemoryRateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app) -> None:  # type: ignore[no-untyped-def]
        super().__init__(app)
        self._buckets: dict[str, RateLimitBucket] = {}
        self._last_cleanup_at = time.monotonic()
        self._rules = [
            RateLimitRule(
                name="agent",
                method="POST",
                path_prefix="/agent/",
                window_seconds=60,
                max_requests=_positive_int("AI_RATE_LIMIT_AGENT_MAX", 20),
            ),
            RateLimitRule(
                name="default",
                method=None,
                path_prefix="/",
                window_seconds=60,
                max_requests=_positive_int("AI_RATE_LIMIT_DEFAULT_MAX", 120),
            ),
        ]

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        rule = self._match_rule(request)
        if rule is None:
            return await call_next(request)

        now = time.monotonic()
        self._cleanup(now)

        key = f"{rule.name}:{request.client.host if request.client else 'unknown'}"
        bucket = self._buckets.get(key)

        if bucket is None or bucket.reset_at <= now:
            self._buckets[key] = RateLimitBucket(
                count=1,
                reset_at=now + rule.window_seconds,
            )
            return await call_next(request)

        bucket.count += 1
        if bucket.count > rule.max_requests:
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests. Try again later."},
            )

        return await call_next(request)

    def _match_rule(self, request: Request) -> RateLimitRule | None:
        method = request.method.upper()
        path = request.url.path

        for rule in self._rules:
            if rule.method and rule.method != method:
                continue
            if path.startswith(rule.path_prefix):
                return rule

        return None

    def _cleanup(self, now: float) -> None:
        if now - self._last_cleanup_at < 60:
            return

        self._last_cleanup_at = now
        expired_keys = [
            key for key, bucket in self._buckets.items() if bucket.reset_at <= now
        ]
        for key in expired_keys:
            del self._buckets[key]
