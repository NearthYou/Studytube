from __future__ import annotations

import base64
import hashlib
import hmac
import json
import math
import os
import re
import time
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.auth.provider import AccessToken

MCP_INVOKE_SCOPE = "studytube:mcp:invoke"
DEFAULT_ASSERTION_ISSUER = "https://api.studytube.internal"
DEFAULT_ASSERTION_AUDIENCE = "studytube-mcp"
DEFAULT_NEST_API_BASE_URL = "http://127.0.0.1:3000"
DOWNSTREAM_ASSERTION_ISSUER = "studytube-mcp"
DOWNSTREAM_ASSERTION_AUDIENCE = "studytube-api"
DOWNSTREAM_ASSERTION_SCOPE = "studytube:internal:mcp"
TOOL_SCHEMA_VERSION = 1
YOUTUBE_OEMBED_URL = "https://www.youtube.com/oembed"
VIDEO_ID_PATTERN = re.compile(r"[A-Za-z0-9_-]{11}")
MAX_QUERY_LENGTH = 500
LEARNING_CAPABILITIES = frozenset(
    {
        "learning:evidence:search",
        "learning:state:read",
        "learning:metadata:verify",
        "learning:quiz:request",
        "learning:proposal:create",
    }
)
MAX_URL_LENGTH = 2048
MAX_AUDIT_VALUE_LENGTH = 4096
DEFAULT_MCP_ALLOWED_HOSTS = (
    "127.0.0.1:*",
    "localhost:*",
    "[::1]:*",
)

try:
    import httpx
except ModuleNotFoundError:  # pragma: no cover - dependency readiness guard
    httpx = None


class ServiceAssertionError(ValueError):
    """Raised for an invalid service identity assertion."""


class MCPGatewayError(RuntimeError):
    """Base class for safe, client-facing MCP gateway failures."""


class GatewayInputError(MCPGatewayError):
    pass


class GatewayTimeoutError(MCPGatewayError):
    pass


class GatewayDependencyError(MCPGatewayError):
    pass


class GatewayResponseError(MCPGatewayError):
    pass


@dataclass(frozen=True)
class GatewaySettings:
    service_assertion_secret: str
    assertion_issuer: str = DEFAULT_ASSERTION_ISSUER
    assertion_audience: str = DEFAULT_ASSERTION_AUDIENCE
    assertion_scope: str = MCP_INVOKE_SCOPE
    max_assertion_lifetime_seconds: int = 120
    assertion_clock_skew_seconds: int = 5
    nest_api_base_url: str = DEFAULT_NEST_API_BASE_URL
    nest_api_socket_path: str | None = None
    downstream_assertion_issuer: str = DOWNSTREAM_ASSERTION_ISSUER
    downstream_assertion_audience: str = DOWNSTREAM_ASSERTION_AUDIENCE
    downstream_assertion_scope: str = DOWNSTREAM_ASSERTION_SCOPE
    tool_timeout_seconds: float = 8.0
    audit_timeout_seconds: float = 3.0
    max_response_bytes: int = 1_000_000
    resource_server_url: str | None = None
    allowed_hosts: tuple[str, ...] = DEFAULT_MCP_ALLOWED_HOSTS

    @classmethod
    def from_environment(cls) -> GatewaySettings:
        settings = cls(
            service_assertion_secret=os.getenv(
                "MCP_SERVICE_ASSERTION_SECRET", ""
            ).strip(),
            assertion_issuer=os.getenv(
                "MCP_ASSERTION_ISSUER", DEFAULT_ASSERTION_ISSUER
            ).strip(),
            assertion_audience=os.getenv(
                "MCP_ASSERTION_AUDIENCE", DEFAULT_ASSERTION_AUDIENCE
            ).strip(),
            nest_api_base_url=os.getenv(
                "STUDYTUBE_INTERNAL_API_URL", DEFAULT_NEST_API_BASE_URL
            ).strip(),
            nest_api_socket_path=_optional_environment("STUDYTUBE_API_SOCKET_PATH"),
            tool_timeout_seconds=_bounded_float_environment(
                "MCP_TOOL_TIMEOUT_SECONDS", default=8.0, minimum=0.25, maximum=30.0
            ),
            audit_timeout_seconds=_bounded_float_environment(
                "MCP_AUDIT_TIMEOUT_SECONDS", default=3.0, minimum=0.25, maximum=10.0
            ),
            resource_server_url=_optional_environment("MCP_RESOURCE_SERVER_URL"),
            allowed_hosts=_comma_separated_environment(
                "MCP_ALLOWED_HOSTS", DEFAULT_MCP_ALLOWED_HOSTS
            ),
        )

        if os.getenv("NODE_ENV", "").strip().casefold() == "production":
            secret = settings.service_assertion_secret
            normalized = secret.casefold()
            if len(secret) < 32 or any(
                marker in normalized
                for marker in (
                    "change-me",
                    "replace-with",
                    "example",
                    "placeholder",
                )
            ):
                raise RuntimeError(
                    "MCP_SERVICE_ASSERTION_SECRET must be a non-placeholder "
                    "secret of at least 32 characters in production"
                )

            for other_name in (
                "INTERNAL_AI_API_KEY",
                "AUTH_VERIFICATION_PEPPER",
                "AUTH_RATE_LIMIT_PEPPER",
            ):
                if secret == os.getenv(other_name, "").strip():
                    raise RuntimeError(
                        "MCP_SERVICE_ASSERTION_SECRET and "
                        f"{other_name} must use different production secrets"
                    )

        return settings

    @classmethod
    def for_test(
        cls,
        *,
        service_assertion_secret: str,
        **overrides: Any,
    ) -> GatewaySettings:
        return cls(service_assertion_secret=service_assertion_secret, **overrides)


@dataclass(frozen=True)
class ServiceClaims:
    subject: str
    run_id: str
    attempt_id: str
    lease_token: str
    context_snapshot_id: str
    capabilities: tuple[str, ...]
    request_jti: str
    issued_at: int
    expires_at: int
    scopes: tuple[str, ...]
    raw: dict[str, Any]

def _decode_base64url(value: str) -> bytes:
    try:
        if not value.isascii():
            raise ValueError
        padding = "=" * (-len(value) % 4)
        decoded = base64.b64decode(f"{value}{padding}", altchars=b"-_", validate=True)
        canonical = base64.urlsafe_b64encode(decoded).rstrip(b"=").decode("ascii")
        if canonical != value:
            raise ValueError
        return decoded
    except (ValueError, TypeError) as exc:
        raise ServiceAssertionError("service assertion is invalid") from exc


def _decode_json_segment(value: str) -> dict[str, Any]:
    try:
        decoded = _decode_base64url(value)
        parsed = json.loads(decoded.decode("utf-8"), object_pairs_hook=_unique_object)
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
        raise ServiceAssertionError("service assertion is invalid") from exc
    if not isinstance(parsed, dict):
        raise ServiceAssertionError("service assertion is invalid")
    return parsed


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate assertion claim")
        result[key] = value
    return result


def _required_string(payload: dict[str, Any], key: str, *, maximum: int) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value or len(value) > maximum:
        raise ServiceAssertionError("service assertion is invalid")
    return value


def _required_integer(payload: dict[str, Any], key: str) -> int:
    value = payload.get(key)
    if isinstance(value, bool) or not isinstance(value, int):
        raise ServiceAssertionError("service assertion is invalid")
    return value


def _required_uuid(payload: dict[str, Any], key: str) -> str:
    value = _required_string(payload, key, maximum=64)
    try:
        parsed = uuid.UUID(value)
    except ValueError as exc:
        raise ServiceAssertionError("service assertion is invalid") from exc
    return str(parsed)


def _audience_contains(value: Any, expected: str) -> bool:
    if isinstance(value, str):
        return value == expected
    if isinstance(value, list) and all(isinstance(item, str) for item in value):
        return expected in value
    return False


def _parse_scopes(value: Any) -> list[str]:
    if isinstance(value, str):
        scopes = value.split()
    elif isinstance(value, list) and all(isinstance(item, str) for item in value):
        scopes = value
    else:
        raise ServiceAssertionError("service assertion is invalid")
    if not scopes or any(not scope or len(scope) > 128 for scope in scopes):
        raise ServiceAssertionError("service assertion is invalid")
    return list(dict.fromkeys(scopes))


def _parse_capabilities(value: Any) -> list[str]:
    if not isinstance(value, list) or not value:
        raise ServiceAssertionError("service assertion is invalid")
    if any(not isinstance(item, str) or item not in LEARNING_CAPABILITIES for item in value):
        raise ServiceAssertionError("service assertion is invalid")
    capabilities = list(dict.fromkeys(value))
    if len(capabilities) != len(value):
        raise ServiceAssertionError("service assertion is invalid")
    return capabilities


def _validate_topic_tokens(value: Any) -> list[str]:
    if not isinstance(value, list) or len(value) > 8:
        raise GatewayInputError("topic tokens are invalid")
    tokens: list[str] = []
    for item in value:
        if (
            not isinstance(item, str)
            or not 1 <= len(item) <= 32
            or not re.fullmatch(r"[A-Za-z0-9_-]+", item)
        ):
            raise GatewayInputError("topic tokens are invalid")
        tokens.append(item)
    return tokens


def _require_capability(claims: ServiceClaims, capability: str) -> None:
    if capability not in claims.capabilities:
        raise GatewayInputError("tool capability is not authorized")


def mint_downstream_assertion(
    settings: GatewaySettings,
    claims: ServiceClaims,
    *,
    now: int | None = None,
) -> str:
    secret = settings.service_assertion_secret
    if len(secret.encode("utf-8")) < 32:
        raise GatewayDependencyError("service assertion signing is unavailable")
    issued_at = int(time.time()) if now is None else now
    header = _encode_json_segment({"alg": "HS256", "typ": "JWT"})
    payload = _encode_json_segment(
        {
            "iss": settings.downstream_assertion_issuer,
            "aud": settings.downstream_assertion_audience,
            "sub": claims.subject,
            "iat": issued_at,
            "exp": issued_at + min(60, settings.max_assertion_lifetime_seconds),
            "jti": str(uuid.uuid4()),
            "scope": settings.downstream_assertion_scope,
            "run_id": claims.run_id,
            "attempt_id": claims.attempt_id,
            "lease_token": claims.lease_token,
            "context_snapshot_id": claims.context_snapshot_id,
            "capabilities": list(claims.capabilities),
            "actor_jti": claims.request_jti,
        }
    )
    signing_input = f"{header}.{payload}"
    signature = hmac.new(
        secret.encode("utf-8"), signing_input.encode("ascii"), hashlib.sha256
    ).digest()
    return f"{signing_input}.{_encode_base64url(signature)}"


def validate_youtube_url(value: Any) -> tuple[str, str]:
    if not isinstance(value, str) or not value or len(value) > MAX_URL_LENGTH:
        raise GatewayInputError("YouTube URL is invalid")
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError as exc:
        raise GatewayInputError("YouTube URL is invalid") from exc
    if (
        parsed.scheme != "https"
        or parsed.username is not None
        or parsed.password is not None
        or port not in {None, 443}
        or parsed.fragment
    ):
        raise GatewayInputError("YouTube URL is invalid")

    host = (parsed.hostname or "").lower().rstrip(".")
    allowed_hosts = {
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "music.youtube.com",
        "youtu.be",
    }
    if host not in allowed_hosts:
        raise GatewayInputError("YouTube URL is invalid")

    video_id: str | None = None
    path_parts = [part for part in parsed.path.split("/") if part]
    if host == "youtu.be":
        if len(path_parts) == 1:
            video_id = path_parts[0]
    elif parsed.path.rstrip("/") == "/watch":
        values = parse_qs(parsed.query, keep_blank_values=True).get("v", [])
        if len(values) == 1:
            video_id = values[0]
    elif len(path_parts) == 2 and path_parts[0] in {"embed", "live", "shorts"}:
        video_id = path_parts[1]

    if video_id is None or re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id) is None:
        raise GatewayInputError("YouTube URL is invalid")
    canonical_url = urlunsplit(
        ("https", "www.youtube.com", "/watch", urlencode({"v": video_id}), "")
    )
    return video_id, canonical_url


def mask_sensitive(value: Any, *, key: str = "") -> Any:
    normalized_key = re.sub(r"[^a-z0-9]", "", key.lower())
    sensitive_keys = (
        "authorization",
        "cookie",
        "password",
        "secret",
        "token",
        "apikey",
        "assertion",
    )
    if normalized_key and any(marker in normalized_key for marker in sensitive_keys):
        return "[REDACTED]"
    if isinstance(value, Mapping):
        return {
            str(item_key): mask_sensitive(item_value, key=str(item_key))
            for item_key, item_value in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [mask_sensitive(item) for item in value[:100]]
    if isinstance(value, str):
        masked = re.sub(
            r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+",
            "Bearer [REDACTED]",
            value,
        )
        masked = re.sub(r"(?<=://)[^/@\s]+@", "[REDACTED]@", masked)
        return masked[:MAX_AUDIT_VALUE_LENGTH]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return str(type(value).__name__)


def _encode_base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _encode_json_segment(value: Mapping[str, Any]) -> str:
    raw = json.dumps(
        value, separators=(",", ":"), sort_keys=True, ensure_ascii=True
    ).encode("utf-8")
    return _encode_base64url(raw)


def _validate_search_response(value: Any, query: str, limit: int) -> dict[str, Any]:
    if (
        not isinstance(value, Mapping)
        or value.get("schemaVersion") != TOOL_SCHEMA_VERSION
    ):
        raise GatewayResponseError("StudyTube search response is invalid")
    sources = value.get("sources")
    if not isinstance(sources, list) or len(sources) > limit:
        raise GatewayResponseError("StudyTube search response is invalid")
    normalized_sources = [_validate_search_source(source) for source in sources]
    return {
        "schemaVersion": TOOL_SCHEMA_VERSION,
        "query": query,
        "sources": normalized_sources,
    }


def _validate_search_source(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise GatewayResponseError("StudyTube search response is invalid")
    source_kind = value.get("sourceKind")
    source_id = value.get("sourceId")
    visibility = value.get("visibility")
    title = value.get("title")
    content = value.get("content")
    score = value.get("score")
    citation = value.get("citation")
    if source_kind not in {"post", "course_step"}:
        raise GatewayResponseError("StudyTube search response is invalid")
    if isinstance(source_id, bool) or not isinstance(source_id, (str, int)):
        raise GatewayResponseError("StudyTube search response is invalid")
    if visibility not in {"private", "public"}:
        raise GatewayResponseError("StudyTube search response is invalid")
    if not isinstance(title, str) or not title or len(title) > 500:
        raise GatewayResponseError("StudyTube search response is invalid")
    if not isinstance(content, str) or len(content) > 12_000:
        raise GatewayResponseError("StudyTube search response is invalid")
    if isinstance(score, bool) or not isinstance(score, (int, float)):
        raise GatewayResponseError("StudyTube search response is invalid")
    if not math.isfinite(float(score)):
        raise GatewayResponseError("StudyTube search response is invalid")
    if not isinstance(citation, Mapping):
        raise GatewayResponseError("StudyTube search response is invalid")
    source_url = citation.get("sourceUrl")
    timestamp = citation.get("timestampSeconds")
    if not _is_safe_public_url(source_url):
        raise GatewayResponseError("StudyTube search response is invalid")
    if timestamp is not None and (
        isinstance(timestamp, bool)
        or not isinstance(timestamp, (int, float))
        or not math.isfinite(float(timestamp))
        or timestamp < 0
    ):
        raise GatewayResponseError("StudyTube search response is invalid")
    return {
        "sourceKind": source_kind,
        "sourceId": str(source_id),
        "visibility": visibility,
        "title": title,
        "content": content,
        "score": float(score),
        "citation": {
            "sourceUrl": source_url,
            "timestampSeconds": timestamp,
        },
    }


def _validate_youtube_metadata(
    value: Any, video_id: str, canonical_url: str
) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise GatewayResponseError("YouTube metadata response is invalid")
    title = value.get("title")
    channel = value.get("author_name")
    thumbnail = value.get("thumbnail_url")
    provider = value.get("provider_name")
    if not isinstance(title, str) or not title or len(title) > 500:
        raise GatewayResponseError("YouTube metadata response is invalid")
    if not isinstance(channel, str) or not channel or len(channel) > 500:
        raise GatewayResponseError("YouTube metadata response is invalid")
    if provider != "YouTube" or not _is_allowed_thumbnail_url(thumbnail):
        raise GatewayResponseError("YouTube metadata response is invalid")
    return {
        "schemaVersion": TOOL_SCHEMA_VERSION,
        "provider": "YouTube",
        "videoId": video_id,
        "sourceUrl": canonical_url,
        "title": title,
        "channelName": channel,
        "thumbnailUrl": thumbnail,
    }


def _is_safe_public_url(value: Any) -> bool:
    if not isinstance(value, str) or not value or len(value) > MAX_URL_LENGTH:
        return False
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError:
        return False
    return bool(
        parsed.scheme == "https"
        and parsed.hostname
        and parsed.username is None
        and parsed.password is None
        and port in {None, 443}
    )


def _is_allowed_thumbnail_url(value: Any) -> bool:
    if not _is_safe_public_url(value):
        return False
    host = (urlsplit(value).hostname or "").lower().rstrip(".")
    return host == "img.youtube.com" or host.endswith(".ytimg.com")


def _failure_outcome(error: Exception) -> str:
    if isinstance(error, GatewayInputError):
        return "invalid_schema"
    if isinstance(error, GatewayTimeoutError):
        return "timeout"
    return "failed"


def _summarize_tool_output(
    tool_name: str, result: Mapping[str, Any] | None
) -> dict[str, Any]:
    if result is None:
        return {}
    if tool_name == "search_studytube":
        sources = result.get("sources")
        return {
            "schemaVersion": result.get("schemaVersion"),
            "sourceCount": len(sources) if isinstance(sources, list) else 0,
        }
    if tool_name == "fetch_youtube_metadata":
        return {
            "schemaVersion": result.get("schemaVersion"),
            "videoId": result.get("videoId"),
        }
    return {"schemaVersion": result.get("schemaVersion")}


def _normalize_request_id(value: Any, fallback: str) -> str:
    normalized = str(value).strip() if value is not None else ""
    if not normalized:
        normalized = fallback
    return normalized[:128]


def _current_service_claims(
    verifier: SignedServiceAssertionTokenVerifier,
) -> ServiceClaims:
    access_token = get_access_token()
    if access_token is None:
        raise ServiceAssertionError("service assertion is required")
    return verifier.verify(access_token.token)


def _optional_environment(name: str) -> str | None:
    value = os.getenv(name, "").strip()
    return value or None


def _bounded_float_environment(
    name: str,
    *,
    default: float,
    minimum: float,
    maximum: float,
) -> float:
    try:
        value = float(os.getenv(name, str(default)))
    except ValueError:
        return default
    if not math.isfinite(value):
        return default
    return max(minimum, min(maximum, value))


def _comma_separated_environment(
    name: str, default: tuple[str, ...]
) -> tuple[str, ...]:
    raw = os.getenv(name, "")
    values = tuple(item.strip() for item in raw.split(",") if item.strip())
    return values or default
