from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import importlib
import json
import os
import socket
import threading
import time
import unittest
import uuid
from contextlib import asynccontextmanager
from typing import Any
from unittest import mock

TEST_SECRET = "mcp-test-secret-that-is-at-least-thirty-two-bytes"


def load_gateway_module():
    try:
        return importlib.import_module("mcp_server")
    except ModuleNotFoundError as exc:
        raise AssertionError("the MCP gateway module is not implemented") from exc


def encode_segment(value: dict[str, object]) -> str:
    raw = json.dumps(value, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def decode_segment(value: str) -> dict[str, Any]:
    padding = "=" * (-len(value) % 4)
    return json.loads(base64.urlsafe_b64decode(f"{value}{padding}"))


def mint_assertion(
    *,
    secret: str = TEST_SECRET,
    now: int | None = None,
    issuer: str = "https://api.studytube.internal",
    audience: str = "studytube-mcp",
    lifetime_seconds: int = 60,
    scope: str = "studytube:mcp:invoke",
) -> str:
    issued_at = int(time.time()) if now is None else now
    header = encode_segment({"alg": "HS256", "typ": "JWT"})
    payload = encode_segment(
        {
            "iss": issuer,
            "aud": audience,
            "sub": "42",
            "iat": issued_at,
            "exp": issued_at + lifetime_seconds,
            "jti": str(uuid.uuid4()),
            "scope": scope,
            "run_id": "11111111-1111-4111-8111-111111111111",
            "attempt_id": "22222222-2222-4222-8222-222222222222",
        }
    )
    signing_input = f"{header}.{payload}"
    signature = hmac.new(
        secret.encode("utf-8"),
        signing_input.encode("ascii"),
        hashlib.sha256,
    ).digest()
    encoded_signature = base64.urlsafe_b64encode(signature).rstrip(b"=").decode("ascii")
    return f"{signing_input}.{encoded_signature}"


class GatewaySettingsProductionSecretTest(unittest.TestCase):
    def test_production_rejects_a_missing_or_weak_mcp_secret(self):
        gateway = load_gateway_module()
        for case, secret in (
            ("missing", None),
            ("short", "too-short"),
            ("placeholder", "replace-with-a-random-production-secret"),
        ):
            environment = {
                "NODE_ENV": "production",
                "INTERNAL_AI_API_KEY": "a" * 32,
                "AUTH_VERIFICATION_PEPPER": "b" * 32,
                "AUTH_RATE_LIMIT_PEPPER": "c" * 32,
            }
            if secret is not None:
                environment["MCP_SERVICE_ASSERTION_SECRET"] = secret

            with self.subTest(case=case):
                with mock.patch.dict(os.environ, environment, clear=True):
                    with self.assertRaisesRegex(
                        RuntimeError, "MCP_SERVICE_ASSERTION_SECRET"
                    ):
                        gateway.GatewaySettings.from_environment()

    def test_production_rejects_mcp_secret_reuse_across_core_boundaries(self):
        gateway = load_gateway_module()
        environment = {
            "NODE_ENV": "production",
            "INTERNAL_AI_API_KEY": "a" * 32,
            "AUTH_VERIFICATION_PEPPER": "b" * 32,
            "AUTH_RATE_LIMIT_PEPPER": "c" * 32,
            "MCP_SERVICE_ASSERTION_SECRET": TEST_SECRET,
        }

        for other_name in (
            "INTERNAL_AI_API_KEY",
            "AUTH_VERIFICATION_PEPPER",
            "AUTH_RATE_LIMIT_PEPPER",
        ):
            reused_environment = {
                **environment,
                "MCP_SERVICE_ASSERTION_SECRET": environment[other_name],
            }
            with self.subTest(other_name=other_name):
                with mock.patch.dict(
                    os.environ, reused_environment, clear=True
                ):
                    with self.assertRaisesRegex(
                        RuntimeError, "different production secrets"
                    ):
                        gateway.GatewaySettings.from_environment()

    def test_production_accepts_a_distinct_strong_mcp_secret(self):
        gateway = load_gateway_module()
        with mock.patch.dict(
            os.environ,
            {
                "NODE_ENV": "production",
                "INTERNAL_AI_API_KEY": "a" * 32,
                "AUTH_VERIFICATION_PEPPER": "b" * 32,
                "AUTH_RATE_LIMIT_PEPPER": "c" * 32,
                "MCP_SERVICE_ASSERTION_SECRET": TEST_SECRET,
            },
            clear=True,
        ):
            settings = gateway.GatewaySettings.from_environment()

        self.assertEqual(settings.service_assertion_secret, TEST_SECRET)

    def test_non_production_allows_an_unconfigured_mcp_secret(self):
        gateway = load_gateway_module()
        with mock.patch.dict(os.environ, {"NODE_ENV": "test"}, clear=True):
            settings = gateway.GatewaySettings.from_environment()

        self.assertEqual(settings.service_assertion_secret, "")


class ServiceAssertionVerifierTest(unittest.IsolatedAsyncioTestCase):
    async def test_accepts_a_short_lived_scoped_assertion_for_the_mcp_audience(self):
        gateway = load_gateway_module()
        settings = gateway.GatewaySettings.for_test(
            service_assertion_secret=TEST_SECRET
        )
        verifier = gateway.SignedServiceAssertionTokenVerifier(settings)

        access_token = await verifier.verify_token(mint_assertion())

        self.assertIsNotNone(access_token)
        assert access_token is not None
        self.assertEqual(access_token.subject, "42")
        self.assertEqual(access_token.scopes, ["studytube:mcp:invoke"])
        self.assertEqual(
            access_token.claims["run_id"],
            "11111111-1111-4111-8111-111111111111",
        )

    async def test_rejects_wrong_audience_expired_and_overlong_assertions(self):
        gateway = load_gateway_module()
        settings = gateway.GatewaySettings.for_test(
            service_assertion_secret=TEST_SECRET
        )
        verifier = gateway.SignedServiceAssertionTokenVerifier(settings)
        now = int(time.time())

        wrong_audience = await verifier.verify_token(
            mint_assertion(now=now, audience="studytube-api")
        )
        expired = await verifier.verify_token(mint_assertion(now=now - 120))
        overlong = await verifier.verify_token(
            mint_assertion(now=now, lifetime_seconds=600)
        )

        self.assertIsNone(wrong_audience)
        self.assertIsNone(expired)
        self.assertIsNone(overlong)

    async def test_rejects_a_tampered_signature_without_disclosing_the_secret(self):
        gateway = load_gateway_module()
        settings = gateway.GatewaySettings.for_test(
            service_assertion_secret=TEST_SECRET
        )
        verifier = gateway.SignedServiceAssertionTokenVerifier(settings)
        token = mint_assertion()
        tampered = f"{token[:-1]}{'A' if token[-1] != 'A' else 'B'}"

        self.assertIsNone(await verifier.verify_token(tampered))

    async def test_reuses_one_assertion_only_within_its_bounded_mcp_session_lifetime(self):
        gateway = load_gateway_module()
        settings = gateway.GatewaySettings.for_test(
            service_assertion_secret=TEST_SECRET
        )
        verifier = gateway.SignedServiceAssertionTokenVerifier(settings)
        issued_at = int(time.time())
        token = mint_assertion(now=issued_at, lifetime_seconds=60)

        self.assertIsNotNone(await verifier.verify_token(token))
        self.assertIsNotNone(await verifier.verify_token(token))
        with self.assertRaises(gateway.ServiceAssertionError):
            verifier.verify(token, now=issued_at + 66)


class RecordingTransport:
    def __init__(self, responses: list[Any]):
        self.responses = list(responses)
        self.requests: list[dict[str, Any]] = []

    async def request_json(self, **request: Any) -> Any:
        self.requests.append(request)
        if not self.responses:
            raise AssertionError("an unexpected outbound request was made")
        response = self.responses.pop(0)
        if isinstance(response, BaseException):
            raise response
        return response


class MCPGatewayBoundaryTest(unittest.IsolatedAsyncioTestCase):
    def settings(self, **overrides: Any):
        gateway = load_gateway_module()
        return gateway.GatewaySettings.for_test(
            service_assertion_secret=TEST_SECRET,
            nest_api_base_url="http://studytube-api.internal",
            **overrides,
        )

    def claims(self, settings: Any):
        gateway = load_gateway_module()
        return gateway.SignedServiceAssertionTokenVerifier(settings).verify(
            mint_assertion()
        )

    async def test_search_uses_only_the_authenticated_nest_boundary_and_audits_it(self):
        gateway = load_gateway_module()
        settings = self.settings()
        transport = RecordingTransport(
            [
                {
                    "schemaVersion": 1,
                    "query": "리액트 상태 관리",
                    "sources": [
                        {
                            "sourceKind": "post",
                            "sourceId": "7",
                            "visibility": "private",
                            "title": "상태 관리 강의",
                            "content": "useReducer와 상태 전이를 설명합니다.",
                            "score": 0.91,
                            "citation": {
                                "sourceUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                                "timestampSeconds": 123,
                            },
                        }
                    ],
                },
                {"accepted": True},
            ]
        )
        mcp_gateway = gateway.MCPGateway(settings, transport=transport)

        result = await mcp_gateway.search_studytube(
            query="리액트 상태 관리",
            limit=3,
            claims=self.claims(settings),
            request_id="call-17",
        )

        self.assertEqual(result["schemaVersion"], 1)
        self.assertEqual(result["sources"][0]["sourceId"], "7")
        search_request, audit_request = transport.requests
        self.assertEqual(
            search_request["url"],
            "http://studytube-api.internal/internal/mcp/search",
        )
        self.assertEqual(
            search_request["json_body"],
            {"schemaVersion": 1, "query": "리액트 상태 관리", "limit": 3},
        )
        self.assertNotIn("ownerId", json.dumps(search_request["json_body"]))
        self.assertTrue(
            search_request["headers"]["Authorization"].startswith("Bearer ")
        )
        downstream_token = search_request["headers"]["Authorization"].split(" ", 1)[1]
        encoded_header, encoded_payload, encoded_signature = downstream_token.split(".")
        downstream_payload = decode_segment(encoded_payload)
        expected_signature = hmac.new(
            TEST_SECRET.encode("utf-8"),
            f"{encoded_header}.{encoded_payload}".encode("ascii"),
            hashlib.sha256,
        ).digest()
        actual_signature = base64.urlsafe_b64decode(
            f"{encoded_signature}{'=' * (-len(encoded_signature) % 4)}"
        )
        self.assertTrue(hmac.compare_digest(expected_signature, actual_signature))
        self.assertEqual(downstream_payload["iss"], "studytube-mcp")
        self.assertEqual(downstream_payload["aud"], "studytube-api")
        self.assertEqual(downstream_payload["sub"], "42")
        self.assertLessEqual(downstream_payload["exp"] - downstream_payload["iat"], 60)
        self.assertEqual(
            audit_request["url"],
            "http://studytube-api.internal/internal/mcp/tool-calls",
        )
        self.assertEqual(audit_request["json_body"]["outcome"], "succeeded")
        self.assertEqual(
            audit_request["json_body"]["runId"], self.claims(settings).run_id
        )
        self.assertEqual(
            audit_request["json_body"]["attemptId"], self.claims(settings).attempt_id
        )
        self.assertEqual(
            audit_request["json_body"]["input"],
            {"query": "리액트 상태 관리", "limit": 3},
        )

    async def test_youtube_metadata_uses_a_fixed_oembed_origin_and_canonical_url(self):
        gateway = load_gateway_module()
        settings = self.settings()
        transport = RecordingTransport(
            [
                {
                    "title": "영상 제목",
                    "author_name": "채널 이름",
                    "thumbnail_url": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
                    "provider_name": "YouTube",
                },
                {"accepted": True},
            ]
        )
        mcp_gateway = gateway.MCPGateway(settings, transport=transport)

        result = await mcp_gateway.fetch_youtube_metadata(
            url="https://youtu.be/dQw4w9WgXcQ?t=123",
            claims=self.claims(settings),
            request_id="call-18",
        )

        self.assertEqual(result["videoId"], "dQw4w9WgXcQ")
        self.assertEqual(
            result["sourceUrl"],
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        )
        metadata_request = transport.requests[0]
        self.assertEqual(metadata_request["url"], "https://www.youtube.com/oembed")
        self.assertEqual(
            metadata_request["query"],
            {
                "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                "format": "json",
            },
        )
        self.assertIsNone(metadata_request["unix_socket"])

    async def test_rejects_non_https_host_confusion_credentials_and_invalid_video_ids(
        self,
    ):
        gateway = load_gateway_module()
        settings = self.settings()
        rejected = [
            "http://youtu.be/dQw4w9WgXcQ",
            "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
            "https://youtube.com@evil.example/watch?v=dQw4w9WgXcQ",
            "https://user:pass@youtube.com/watch?v=dQw4w9WgXcQ",
            "https://youtube.com/watch?v=too-short",
            "https://127.0.0.1/watch?v=dQw4w9WgXcQ",
        ]

        for index, url in enumerate(rejected):
            with self.subTest(url=url):
                transport = RecordingTransport([{"accepted": True}])
                mcp_gateway = gateway.MCPGateway(settings, transport=transport)
                with self.assertRaisesRegex(
                    gateway.GatewayInputError, "YouTube URL is invalid"
                ):
                    await mcp_gateway.fetch_youtube_metadata(
                        url=url,
                        claims=self.claims(settings),
                        request_id=f"rejected-{index}",
                    )
                self.assertEqual(len(transport.requests), 1)
                self.assertEqual(
                    transport.requests[0]["json_body"]["outcome"],
                    "invalid_schema",
                )
                self.assertNotIn(
                    "user:pass",
                    json.dumps(transport.requests[0]["json_body"]),
                )

    async def test_audits_timeout_outcome_before_returning_a_safe_error(self):
        gateway = load_gateway_module()
        settings = self.settings()
        transport = RecordingTransport(
            [
                gateway.GatewayTimeoutError("upstream request timed out"),
                {"accepted": True},
            ]
        )
        mcp_gateway = gateway.MCPGateway(settings, transport=transport)

        with self.assertRaisesRegex(
            gateway.GatewayTimeoutError, "upstream request timed out"
        ):
            await mcp_gateway.search_studytube(
                query="query",
                limit=3,
                claims=self.claims(settings),
                request_id="call-timeout",
            )

        self.assertEqual(transport.requests[1]["json_body"]["outcome"], "timeout")
        self.assertNotIn(TEST_SECRET, json.dumps(transport.requests[1]["json_body"]))

    async def test_fails_closed_when_the_audit_boundary_is_unavailable(self):
        gateway = load_gateway_module()
        settings = self.settings()
        transport = RecordingTransport(
            [
                {"schemaVersion": 1, "query": "query", "sources": []},
                gateway.GatewayDependencyError("audit unavailable"),
            ]
        )
        mcp_gateway = gateway.MCPGateway(settings, transport=transport)

        with self.assertRaisesRegex(
            gateway.GatewayDependencyError, "audit boundary is unavailable"
        ):
            await mcp_gateway.search_studytube(
                query="query",
                limit=3,
                claims=self.claims(settings),
                request_id="call-19",
            )

    def test_masks_secrets_recursively_before_audit_or_error_output(self):
        gateway = load_gateway_module()

        masked = gateway.mask_sensitive(
            {
                "Authorization": "Bearer secret-token",
                "nested": {"apiKey": "sk-secret", "safe": "value"},
                "cookie": "session=secret",
            }
        )

        self.assertEqual(masked["Authorization"], "[REDACTED]")
        self.assertEqual(masked["nested"]["apiKey"], "[REDACTED]")
        self.assertEqual(masked["nested"]["safe"], "value")
        self.assertEqual(masked["cookie"], "[REDACTED]")
        self.assertNotIn("secret", json.dumps(masked))


class OfficialMCPContractTest(unittest.IsolatedAsyncioTestCase):
    async def test_defaults_to_internal_service_auth_without_oauth_metadata(self):
        gateway = load_gateway_module()
        settings = gateway.GatewaySettings.for_test(
            service_assertion_secret=TEST_SECRET,
        )

        self.assertIsNone(settings.resource_server_url)

    async def test_registers_versioned_read_only_tools_without_identity_inputs(self):
        gateway = load_gateway_module()
        settings = gateway.GatewaySettings.for_test(
            service_assertion_secret=TEST_SECRET,
            nest_api_base_url="http://studytube-api.internal",
        )
        transport = RecordingTransport([])
        server = gateway.create_mcp_server(settings=settings, transport=transport)

        tools = {tool.name: tool for tool in await server.list_tools()}

        self.assertEqual(set(tools), {"search_studytube", "fetch_youtube_metadata"})
        search_schema = tools["search_studytube"].input_schema
        youtube_schema = tools["fetch_youtube_metadata"].input_schema
        self.assertEqual(set(search_schema["properties"]), {"query", "limit"})
        self.assertEqual(set(youtube_schema["properties"]), {"url"})
        serialized = json.dumps(
            {name: tool.model_dump(by_alias=True) for name, tool in tools.items()}
        ).lower()
        self.assertNotIn("ownerid", serialized)
        self.assertNotIn("cookie", serialized)
        self.assertEqual(
            tools["search_studytube"].meta,
            {
                "studytube/toolSchemaVersion": 1,
                "studytube/protocolVersion": "2026-07-28",
            },
        )
        self.assertTrue(tools["search_studytube"].annotations.read_only_hint)
        self.assertFalse(tools["search_studytube"].annotations.open_world_hint)
        self.assertTrue(tools["fetch_youtube_metadata"].annotations.open_world_hint)

    async def test_builds_an_internal_streamable_http_app_without_oauth_metadata(self):
        gateway = load_gateway_module()
        settings = gateway.GatewaySettings.for_test(
            service_assertion_secret=TEST_SECRET,
            nest_api_base_url="http://studytube-api.internal",
        )
        server = gateway.create_mcp_server(
            settings=settings, transport=RecordingTransport([])
        )

        app = gateway.create_streamable_http_app(
            server,
            path="/mcp",
            host="127.0.0.1",
        )

        route_paths = [route.path for route in app.routes]
        self.assertIn("/mcp", route_paths)
        self.assertNotIn("/.well-known/oauth-protected-resource/mcp", route_paths)
        self.assertIs(server.session_manager, server.session_manager)

    async def test_rejects_a_public_host_even_with_a_valid_service_assertion(self):
        import httpx2

        gateway = load_gateway_module()
        settings = gateway.GatewaySettings.for_test(
            service_assertion_secret=TEST_SECRET,
            nest_api_base_url="http://studytube-api.internal",
        )
        server = gateway.create_mcp_server(
            settings=settings,
            transport=RecordingTransport([]),
        )
        app = gateway.create_streamable_http_app(
            server,
            path="/mcp",
            host="127.0.0.1",
        )

        async with (
            server.session_manager.run(),
            httpx2.AsyncClient(
                transport=httpx2.ASGITransport(app=app),
                base_url="http://127.0.0.1",
            ) as client,
        ):
            response = await client.post(
                "/mcp",
                headers={
                    "Accept": "application/json, text/event-stream",
                    "Authorization": f"Bearer {mint_assertion()}",
                    "Content-Type": "application/json",
                    "Host": "studytube.page",
                },
                json={"jsonrpc": "2.0", "id": 2, "method": "server/discover"},
            )

        self.assertEqual(response.status_code, 421)

    async def test_serves_the_2026_protocol_over_authenticated_loopback_http(self):
        import httpx2
        import uvicorn
        from mcp import Client
        from mcp.client.streamable_http import streamable_http_client

        gateway = load_gateway_module()
        settings = gateway.GatewaySettings.for_test(
            service_assertion_secret=TEST_SECRET,
            nest_api_base_url="http://studytube-api.internal",
        )
        transport = RecordingTransport(
            [
                {"schemaVersion": 1, "query": "query", "sources": []},
                {"accepted": True},
            ]
        )
        server = gateway.create_mcp_server(settings=settings, transport=transport)
        app = gateway.create_streamable_http_app(
            server,
            path="/mcp",
            host="127.0.0.1",
        )
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        port = listener.getsockname()[1]
        uvicorn_server = uvicorn.Server(
            uvicorn.Config(
                app,
                log_level="critical",
                access_log=False,
                lifespan="on",
            )
        )
        server_thread = threading.Thread(
            target=lambda: uvicorn_server.run(sockets=[listener]),
            daemon=True,
        )
        server_thread.start()
        for _ in range(100):
            if uvicorn_server.started:
                break
            await asyncio.sleep(0.02)
        self.assertTrue(uvicorn_server.started)

        endpoint = f"http://127.0.0.1:{port}/mcp"

        @asynccontextmanager
        async def authenticated_transport():
            async with (
                httpx2.AsyncClient(
                    headers={"Authorization": f"Bearer {mint_assertion()}"},
                    timeout=5,
                ) as client,
                streamable_http_client(endpoint, http_client=client) as streams,
            ):
                yield streams

        try:
            async with httpx2.AsyncClient(timeout=5) as unauthenticated_client:
                unauthorized = await unauthenticated_client.post(
                    endpoint,
                    headers={
                        "Accept": "application/json, text/event-stream",
                        "Content-Type": "application/json",
                        "Cookie": "session=browser-cookie-must-not-authenticate",
                    },
                    json={"jsonrpc": "2.0", "id": 1, "method": "server/discover"},
                )
            self.assertEqual(unauthorized.status_code, 401)
            self.assertNotIn(
                "resource_metadata=",
                unauthorized.headers.get("www-authenticate", ""),
            )

            async with Client(
                authenticated_transport(), read_timeout_seconds=5
            ) as client:
                self.assertEqual(client.session.protocol_version, "2026-07-28")
                tools = await client.list_tools()
                self.assertEqual(
                    {tool.name for tool in tools.tools},
                    {"search_studytube", "fetch_youtube_metadata"},
                )
                result = await client.call_tool(
                    "search_studytube", {"query": "query", "limit": 3}
                )
                self.assertFalse(result.is_error)
                self.assertEqual(
                    result.structured_content,
                    {"schemaVersion": 1, "query": "query", "sources": []},
                )
        finally:
            uvicorn_server.should_exit = True
            server_thread.join(timeout=5)
            listener.close()

        self.assertFalse(server_thread.is_alive())
        self.assertEqual(len(transport.requests), 2)


if __name__ == "__main__":
    unittest.main()
