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
from mcp.server.auth.provider import AccessToken
from mcp.server.auth.settings import AuthSettings
from mcp.server.mcpserver import Context
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations
from pydantic import AnyHttpUrl
from starlette.applications import Starlette

import mcp_support as _support

globals().update(
    {
        name: value
        for name, value in vars(_support).items()
        if not name.startswith("__")
    }
)

try:
    import httpx
except ModuleNotFoundError:  # pragma: no cover - dependency readiness guard
    httpx = None

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
