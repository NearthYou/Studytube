from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import math
import os
import re
import time
import uuid
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

from mcp.server import MCPServer
from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.auth.provider import AccessToken
from mcp.server.auth.settings import AuthSettings
from mcp.server.mcpserver import Context
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations
from pydantic import AnyHttpUrl
from starlette.applications import Starlette

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


class JsonTransport(Protocol):
    async def request_json(
        self,
        *,
        method: str,
        url: str,
        headers: Mapping[str, str],
        json_body: Mapping[str, Any] | None,
        query: Mapping[str, str] | None,
        timeout_seconds: float,
        unix_socket: str | None,
        max_response_bytes: int,
    ) -> Any: ...


class HttpxJsonTransport:
    async def request_json(
        self,
        *,
        method: str,
        url: str,
        headers: Mapping[str, str],
        json_body: Mapping[str, Any] | None,
        query: Mapping[str, str] | None,
        timeout_seconds: float,
        unix_socket: str | None,
        max_response_bytes: int,
    ) -> Any:
        if httpx is None:
            raise GatewayDependencyError("HTTP client dependency is unavailable")

        async def request() -> Any:
            transport = (
                httpx.AsyncHTTPTransport(uds=unix_socket) if unix_socket else None
            )
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(timeout_seconds),
                follow_redirects=False,
                trust_env=False,
                transport=transport,
            ) as client:
                response = await client.request(
                    method,
                    url,
                    headers=dict(headers),
                    json=dict(json_body) if json_body is not None else None,
                    params=dict(query) if query is not None else None,
                )
            if response.status_code in {408, 504}:
                raise GatewayTimeoutError("upstream request timed out")
            if response.status_code < 200 or response.status_code >= 300:
                raise GatewayDependencyError("upstream request failed")
            if len(response.content) > max_response_bytes:
                raise GatewayResponseError("upstream response is too large")
            try:
                return response.json()
            except ValueError as exc:
                raise GatewayResponseError("upstream response is invalid") from exc

        try:
            return await asyncio.wait_for(request(), timeout=timeout_seconds)
        except asyncio.TimeoutError as exc:
            raise GatewayTimeoutError("upstream request timed out") from exc
        except GatewayTimeoutError:
            raise
        except GatewayResponseError:
            raise
        except GatewayDependencyError:
            raise
        except Exception as exc:
            if httpx is not None and isinstance(exc, httpx.TimeoutException):
                raise GatewayTimeoutError("upstream request timed out") from exc
            raise GatewayDependencyError("upstream request failed") from exc


class MCPGateway:
    def __init__(
        self,
        settings: GatewaySettings,
        *,
        transport: JsonTransport | None = None,
    ) -> None:
        self.settings = settings
        self.transport = transport or HttpxJsonTransport()

    async def search_studytube(
        self,
        *,
        query: str,
        limit: int,
        claims: ServiceClaims,
        request_id: str,
    ) -> dict[str, Any]:
        _require_capability(claims, "learning:evidence:search")
        audit_input = {"requestedCount": limit}

        async def operation() -> dict[str, Any]:
            normalized_query = query.strip() if isinstance(query, str) else ""
            if not normalized_query or len(normalized_query) > MAX_QUERY_LENGTH:
                raise GatewayInputError(
                    f"query must contain between 1 and {MAX_QUERY_LENGTH} characters"
                )
            if (
                isinstance(limit, bool)
                or not isinstance(limit, int)
                or not 1 <= limit <= 10
            ):
                raise GatewayInputError("limit must be an integer between 1 and 10")
            response = await self._nest_request(
                path="/internal/mcp/search",
                body={
                    "schemaVersion": TOOL_SCHEMA_VERSION,
                    "query": normalized_query,
                    "limit": limit,
                },
                claims=claims,
                request_id=request_id,
                timeout_seconds=self.settings.tool_timeout_seconds,
            )
            return _validate_search_response(response, normalized_query, limit)

        return await self._run_audited(
            tool_name="search_studytube",
            audit_input=audit_input,
            claims=claims,
            request_id=request_id,
            operation=operation,
        )

    async def fetch_youtube_metadata(
        self,
        *,
        url: str,
        claims: ServiceClaims,
        request_id: str,
    ) -> dict[str, Any]:
        _require_capability(claims, "learning:metadata:verify")
        audit_input = {"resourceCount": 1}

        async def operation() -> dict[str, Any]:
            video_id, canonical_url = validate_youtube_url(url)
            response = await self.transport.request_json(
                method="GET",
                url=YOUTUBE_OEMBED_URL,
                headers={"Accept": "application/json"},
                json_body=None,
                query={"url": canonical_url, "format": "json"},
                timeout_seconds=self.settings.tool_timeout_seconds,
                unix_socket=None,
                max_response_bytes=self.settings.max_response_bytes,
            )
            return _validate_youtube_metadata(response, video_id, canonical_url)

        return await self._run_audited(
            tool_name="fetch_youtube_metadata",
            audit_input=audit_input,
            claims=claims,
            request_id=request_id,
            operation=operation,
        )

    async def invoke_learning_tool(
        self,
        *,
        tool_name: str,
        capability: str,
        body: Mapping[str, Any],
        claims: ServiceClaims,
        request_id: str,
    ) -> dict[str, Any]:
        _require_capability(claims, capability)

        async def operation() -> dict[str, Any]:
            path = (
                "/internal/mcp/learning/plan"
                if tool_name == "propose_next_learning"
                else f"/internal/mcp/learning/tools/{tool_name}"
            )
            response = await self._nest_request(
                path=path,
                body={"schemaVersion": TOOL_SCHEMA_VERSION, **dict(body)},
                claims=claims,
                request_id=request_id,
                timeout_seconds=self.settings.tool_timeout_seconds,
            )
            if not isinstance(response, Mapping) or response.get("schemaVersion") != 1:
                raise GatewayResponseError("learning tool response is invalid")
            return dict(response)

        return await self._run_audited(
            tool_name=tool_name,
            audit_input={"resourceCount": 1},
            claims=claims,
            request_id=request_id,
            operation=operation,
        )

    async def _run_audited(
        self,
        *,
        tool_name: str,
        audit_input: Mapping[str, Any],
        claims: ServiceClaims,
        request_id: str,
        operation: Callable[[], Awaitable[dict[str, Any]]],
    ) -> dict[str, Any]:
        started = time.perf_counter()
        result: dict[str, Any] | None = None
        failure: Exception | None = None
        outcome = "succeeded"
        try:
            result = await operation()
        except Exception as exc:  # noqa: BLE001 - every tool failure must be audited
            failure = exc
            outcome = _failure_outcome(exc)

        audit_output = (
            _summarize_tool_output(tool_name, result)
            if result is not None
            else {"outcome": outcome}
        )
        event = {
            "schemaVersion": TOOL_SCHEMA_VERSION,
            "runId": claims.run_id,
            "attemptId": claims.attempt_id,
            "requestId": _normalize_request_id(request_id, claims.request_jti),
            "toolName": tool_name,
            "inputSchemaVersion": TOOL_SCHEMA_VERSION,
            "outputSchemaVersion": TOOL_SCHEMA_VERSION if result is not None else None,
            "durationMs": max(0, round((time.perf_counter() - started) * 1000)),
            "outcome": outcome,
            "source": "mcp-streamable-http",
            "input": dict(audit_input),
            "output": audit_output,
        }
        try:
            audit_response = await self._nest_request(
                path="/internal/mcp/tool-calls",
                body=event,
                claims=claims,
                request_id=event["requestId"],
                timeout_seconds=self.settings.audit_timeout_seconds,
            )
            if (
                not isinstance(audit_response, Mapping)
                or audit_response.get("accepted") is not True
            ):
                raise GatewayResponseError("audit response is invalid")
        except Exception as exc:
            raise GatewayDependencyError("MCP audit boundary is unavailable") from exc

        if failure is not None:
            raise failure
        assert result is not None
        return result

    async def _nest_request(
        self,
        *,
        path: str,
        body: Mapping[str, Any],
        claims: ServiceClaims,
        request_id: str,
        timeout_seconds: float,
    ) -> Any:
        assertion = mint_downstream_assertion(self.settings, claims)
        return await self.transport.request_json(
            method="POST",
            url=f"{self.settings.nest_api_base_url.rstrip('/')}{path}",
            headers={
                "Accept": "application/json",
                "Authorization": f"Bearer {assertion}",
                "Content-Type": "application/json",
                "X-Request-Id": _normalize_request_id(request_id, claims.request_jti),
                "X-Studytube-Tool-Schema-Version": str(TOOL_SCHEMA_VERSION),
            },
            json_body=body,
            query=None,
            timeout_seconds=timeout_seconds,
            unix_socket=self.settings.nest_api_socket_path,
            max_response_bytes=self.settings.max_response_bytes,
        )


def create_mcp_server(
    *,
    settings: GatewaySettings | None = None,
    transport: JsonTransport | None = None,
) -> MCPServer:
    resolved_settings = settings or GatewaySettings.from_environment()
    verifier = SignedServiceAssertionTokenVerifier(resolved_settings)
    gateway = MCPGateway(resolved_settings, transport=transport)
    server = MCPServer(
        name="studytube-mcp",
        title="StudyTube Learning Tools",
        description=(
            "Internal service-authenticated learning retrieval and YouTube "
            "metadata tools."
        ),
        instructions=(
            "Use cited StudyTube sources for grounded course creation. "
            "Caller identity is accepted only from a short-lived service "
            "assertion minted by the StudyTube API; this is not a user OAuth "
            "endpoint."
        ),
        version="1.0.0",
        token_verifier=verifier,
        auth=AuthSettings(
            issuer_url=AnyHttpUrl(resolved_settings.assertion_issuer),
            resource_server_url=(
                AnyHttpUrl(resolved_settings.resource_server_url)
                if resolved_settings.resource_server_url
                else None
            ),
            required_scopes=[resolved_settings.assertion_scope],
        ),
    )

    read_only_closed_world = ToolAnnotations(
        readOnlyHint=True,
        destructiveHint=False,
        idempotentHint=True,
        openWorldHint=False,
    )
    read_only_open_world = ToolAnnotations(
        readOnlyHint=True,
        destructiveHint=False,
        idempotentHint=True,
        openWorldHint=True,
    )
    tool_meta = {
        "studytube/toolSchemaVersion": TOOL_SCHEMA_VERSION,
        "studytube/protocolVersion": "2026-07-28",
    }

    @server.tool(
        name="search_studytube",
        description=(
            "Search the caller's authorized StudyTube learning sources and "
            "return timestamped citations."
        ),
        annotations=read_only_closed_world,
        meta=tool_meta,
        structured_output=True,
    )
    async def search_studytube(
        query: str,
        ctx: Context,
        limit: int = 5,
    ) -> dict[str, Any]:
        claims = _current_service_claims(verifier)
        return await gateway.search_studytube(
            query=query,
            limit=limit,
            claims=claims,
            request_id=_normalize_request_id(ctx.request_id, claims.request_jti),
        )

    @server.tool(
        name="fetch_youtube_metadata",
        description=(
            "Fetch title, channel, thumbnail, and canonical URL for one "
            "validated YouTube video URL."
        ),
        annotations=read_only_open_world,
        meta=tool_meta,
        structured_output=True,
    )
    async def fetch_youtube_metadata(
        url: str,
        ctx: Context,
    ) -> dict[str, Any]:
        claims = _current_service_claims(verifier)
        return await gateway.fetch_youtube_metadata(
            url=url,
            claims=claims,
            request_id=_normalize_request_id(ctx.request_id, claims.request_jti),
        )

    @server.tool(
        name="search_learning_evidence",
        description="Search evidence inside the signed learning context snapshot.",
        annotations=read_only_closed_world,
        meta=tool_meta,
        structured_output=True,
    )
    async def search_learning_evidence(
        query: str,
        ctx: Context,
        limit: int = 5,
    ) -> dict[str, Any]:
        claims = _current_service_claims(verifier)
        return await gateway.search_studytube(
            query=query,
            limit=limit,
            claims=claims,
            request_id=_normalize_request_id(ctx.request_id, claims.request_jti),
        )

    @server.tool(
        name="read_learning_state",
        description="Read bounded progress and note counts for the signed context.",
        annotations=read_only_closed_world,
        meta=tool_meta,
        structured_output=True,
    )
    async def read_learning_state(ctx: Context) -> dict[str, Any]:
        claims = _current_service_claims(verifier)
        return await gateway.invoke_learning_tool(
            tool_name="read_learning_state",
            capability="learning:state:read",
            body={},
            claims=claims,
            request_id=_normalize_request_id(ctx.request_id, claims.request_jti),
        )

    @server.tool(
        name="verify_learning_video_metadata",
        description="Validate one canonical YouTube ID using bounded topic tokens.",
        annotations=read_only_open_world,
        meta=tool_meta,
        structured_output=True,
    )
    async def verify_learning_video_metadata(
        video_id: str,
        topic_tokens: list[str],
        ctx: Context,
    ) -> dict[str, Any]:
        claims = _current_service_claims(verifier)
        _validate_topic_tokens(topic_tokens)
        if not isinstance(video_id, str) or not VIDEO_ID_PATTERN.fullmatch(video_id):
            raise GatewayInputError("canonical video id is invalid")
        return await gateway.fetch_youtube_metadata(
            url=f"https://www.youtube.com/watch?v={video_id}",
            claims=claims,
            request_id=_normalize_request_id(ctx.request_id, claims.request_jti),
        )

    @server.tool(
        name="request_learning_quiz",
        description="Create an idempotent quiz request for the signed watched range.",
        annotations=ToolAnnotations(
            readOnlyHint=False,
            destructiveHint=False,
            idempotentHint=True,
            openWorldHint=False,
        ),
        meta=tool_meta,
        structured_output=True,
    )
    async def request_learning_quiz(
        range_start_seconds: int,
        range_end_seconds: int,
        idempotency_key: str,
        ctx: Context,
    ) -> dict[str, Any]:
        claims = _current_service_claims(verifier)
        return await gateway.invoke_learning_tool(
            tool_name="request_learning_quiz",
            capability="learning:quiz:request",
            body={
                "rangeStartSeconds": range_start_seconds,
                "rangeEndSeconds": range_end_seconds,
                "idempotencyKey": idempotency_key,
            },
            claims=claims,
            request_id=_normalize_request_id(ctx.request_id, claims.request_jti),
        )

    @server.tool(
        name="propose_next_learning",
        description="Create a versioned Course change proposal without mutating a Course.",
        annotations=ToolAnnotations(
            readOnlyHint=False,
            destructiveHint=False,
            idempotentHint=True,
            openWorldHint=False,
        ),
        meta=tool_meta,
        structured_output=True,
    )
    async def propose_next_learning(
        objective: str,
        requested_step_count: int,
        ctx: Context,
    ) -> dict[str, Any]:
        claims = _current_service_claims(verifier)
        return await gateway.invoke_learning_tool(
            tool_name="propose_next_learning",
            capability="learning:proposal:create",
            body={
                "objective": objective,
                "requestedStepCount": requested_step_count,
            },
            claims=claims,
            request_id=_normalize_request_id(ctx.request_id, claims.request_jti),
        )

    return server


def create_streamable_http_app(
    server: MCPServer,
    *,
    path: str = "/mcp",
    host: str = "127.0.0.1",
    allowed_hosts: tuple[str, ...] | None = None,
) -> Starlette:
    hosts = allowed_hosts or DEFAULT_MCP_ALLOWED_HOSTS
    return server.streamable_http_app(
        streamable_http_path=path,
        json_response=True,
        stateless_http=True,
        max_request_body_size=64 * 1024,
        transport_security=TransportSecuritySettings(
            enable_dns_rebinding_protection=True,
            allowed_hosts=list(hosts),
            allowed_origins=[],
        ),
        host=host,
    )


class SignedServiceAssertionTokenVerifier:
    """Verify short-lived HS256 assertions issued by the StudyTube API.

    The bearer assertion may authenticate multiple requests in one stateless MCP
    session until it expires. Its jti is an audit correlation value, not a
    one-time nonce. Every downstream Nest request receives a newly minted jti.
    """

    def __init__(self, settings: GatewaySettings):
        self.settings = settings

    async def verify_token(self, token: str) -> AccessToken | None:
        try:
            claims = self.verify(token)
        except ServiceAssertionError:
            return None

        return AccessToken(
            token=token,
            client_id=self.settings.assertion_issuer,
            scopes=list(claims.scopes),
            expires_at=claims.expires_at,
            resource=self.settings.assertion_audience,
            subject=claims.subject,
            claims=claims.raw,
        )

    def verify(self, token: str, *, now: int | None = None) -> ServiceClaims:
        secret = self.settings.service_assertion_secret
        if len(secret.encode("utf-8")) < 32:
            raise ServiceAssertionError("service assertion verification is unavailable")
        if not isinstance(token, str) or not token or len(token) > 8192:
            raise ServiceAssertionError("service assertion is invalid")

        parts = token.split(".")
        if len(parts) != 3 or any(not part for part in parts):
            raise ServiceAssertionError("service assertion is invalid")
        encoded_header, encoded_payload, encoded_signature = parts
        header = _decode_json_segment(encoded_header)
        payload = _decode_json_segment(encoded_payload)
        if header.get("alg") != "HS256" or header.get("typ") != "JWT":
            raise ServiceAssertionError("service assertion is invalid")

        signing_input = f"{encoded_header}.{encoded_payload}".encode("ascii")
        expected_signature = hmac.new(
            secret.encode("utf-8"), signing_input, hashlib.sha256
        ).digest()
        supplied_signature = _decode_base64url(encoded_signature)
        if not hmac.compare_digest(supplied_signature, expected_signature):
            raise ServiceAssertionError("service assertion is invalid")

        verified_at = int(time.time()) if now is None else now
        issuer = _required_string(payload, "iss", maximum=512)
        if issuer != self.settings.assertion_issuer:
            raise ServiceAssertionError("service assertion is invalid")
        if not _audience_contains(payload.get("aud"), self.settings.assertion_audience):
            raise ServiceAssertionError("service assertion is invalid")

        issued_at = _required_integer(payload, "iat")
        expires_at = _required_integer(payload, "exp")
        not_before = payload.get("nbf", issued_at)
        if isinstance(not_before, bool) or not isinstance(not_before, int):
            raise ServiceAssertionError("service assertion is invalid")
        skew = self.settings.assertion_clock_skew_seconds
        if issued_at > verified_at + skew or not_before > verified_at + skew:
            raise ServiceAssertionError("service assertion is invalid")
        if expires_at <= verified_at - skew or expires_at <= issued_at:
            raise ServiceAssertionError("service assertion is invalid")
        if expires_at - issued_at > self.settings.max_assertion_lifetime_seconds:
            raise ServiceAssertionError("service assertion is invalid")

        scopes = _parse_scopes(payload.get("scope"))
        if self.settings.assertion_scope not in scopes:
            raise ServiceAssertionError("service assertion is invalid")

        subject = _required_string(payload, "sub", maximum=256)
        request_jti = _required_string(payload, "jti", maximum=128)
        run_id = _required_uuid(payload, "run_id")
        attempt_id = _required_uuid(payload, "attempt_id")
        lease_token = _required_uuid(payload, "lease_token")
        context_snapshot_id = _required_uuid(payload, "context_snapshot_id")
        capabilities = _parse_capabilities(payload.get("capabilities"))

        return ServiceClaims(
            subject=subject,
            run_id=run_id,
            attempt_id=attempt_id,
            lease_token=lease_token,
            context_snapshot_id=context_snapshot_id,
            capabilities=tuple(capabilities),
            request_jti=request_jti,
            issued_at=issued_at,
            expires_at=expires_at,
            scopes=tuple(scopes),
            raw=dict(payload),
        )


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
