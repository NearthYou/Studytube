from __future__ import annotations

import json
import os
import unittest
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from unittest.mock import patch

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from opentelemetry.sdk.trace.export import SpanExporter, SpanExportResult
from opentelemetry.trace import SpanKind

from telemetry import FastApiTelemetryRuntime, configure_fastapi_telemetry


class CollectingExporter(SpanExporter):
    def __init__(self, *, endpoint=None) -> None:
        self.endpoint = endpoint
        self.spans = []
        self.shutdown_calls = 0

    def export(self, spans):
        self.spans.extend(spans)
        return SpanExportResult.SUCCESS

    def shutdown(self) -> None:
        self.shutdown_calls += 1


class FastApiTelemetryTests(unittest.TestCase):
    def test_stays_disabled_without_an_otlp_endpoint(self):
        app = FastAPI()
        exporter_calls = []

        runtime = configure_fastapi_telemetry(
            app,
            environment={},
            exporter_factory=lambda: exporter_calls.append(True),
        )

        self.assertFalse(runtime.enabled)
        self.assertEqual(exporter_calls, [])
        self.assertFalse(getattr(app, "_is_instrumented_by_opentelemetry", False))

    def test_stays_disabled_when_the_sdk_is_disabled(self):
        exporter_calls = []

        runtime = configure_fastapi_telemetry(
            FastAPI(),
            environment={
                "OTEL_SDK_DISABLED": "TrUe",
                "OTEL_EXPORTER_OTLP_ENDPOINT": "https://collector.example",
            },
            exporter_factory=lambda: exporter_calls.append(True),
        )

        self.assertFalse(runtime.enabled)
        self.assertEqual(exporter_calls, [])

    def test_stays_disabled_when_trace_export_is_disabled(self):
        exporter_calls = []

        runtime = configure_fastapi_telemetry(
            FastAPI(),
            environment={
                "OTEL_TRACES_EXPORTER": "none",
                "OTEL_EXPORTER_OTLP_ENDPOINT": "https://collector.example",
            },
            exporter_factory=lambda: exporter_calls.append(True),
        )

        self.assertFalse(runtime.enabled)
        self.assertEqual(exporter_calls, [])

    def test_none_in_trace_exporter_list_takes_priority_over_otlp(self):
        exporter_calls = []

        runtime = configure_fastapi_telemetry(
            FastAPI(),
            environment={
                "OTEL_TRACES_EXPORTER": "otlp, NONE",
                "OTEL_EXPORTER_OTLP_ENDPOINT": "https://collector.example",
            },
            exporter_factory=lambda **_: exporter_calls.append(True),
        )

        self.assertFalse(runtime.enabled)
        self.assertEqual(exporter_calls, [])

    def test_stays_disabled_for_a_non_otlp_trace_exporter(self):
        exporter_calls = []

        runtime = configure_fastapi_telemetry(
            FastAPI(),
            environment={
                "OTEL_TRACES_EXPORTER": "console",
                "OTEL_EXPORTER_OTLP_ENDPOINT": "https://collector.example",
            },
            exporter_factory=lambda: exporter_calls.append(True),
        )

        self.assertFalse(runtime.enabled)
        self.assertEqual(exporter_calls, [])

    def test_enables_when_non_empty_trace_exporter_list_includes_otlp(self):
        exporter_endpoints = []

        def exporter_factory(*, endpoint=None):
            exporter_endpoints.append(endpoint)
            return CollectingExporter(endpoint=endpoint)

        runtime = configure_fastapi_telemetry(
            FastAPI(),
            environment={
                "OTEL_TRACES_EXPORTER": "console, OTLP",
                "OTEL_EXPORTER_OTLP_ENDPOINT": "https://collector.example/otel",
            },
            exporter_factory=exporter_factory,
        )
        self.addCleanup(runtime.shutdown)

        self.assertTrue(runtime.enabled)
        self.assertEqual(
            exporter_endpoints,
            ["https://collector.example/otel/v1/traces"],
        )

    def test_explicit_otlp_uses_safe_local_trace_endpoint_by_default(self):
        exporter_endpoints = []

        def exporter_factory(*, endpoint=None):
            exporter_endpoints.append(endpoint)
            return CollectingExporter(endpoint=endpoint)

        runtime = configure_fastapi_telemetry(
            FastAPI(),
            environment={"OTEL_TRACES_EXPORTER": "otlp"},
            exporter_factory=exporter_factory,
        )
        self.addCleanup(runtime.shutdown)

        self.assertTrue(runtime.enabled)
        self.assertEqual(
            exporter_endpoints,
            ["http://localhost:4318/v1/traces"],
        )

    def test_explicit_otlp_does_not_fallback_from_an_unsafe_endpoint(self):
        exporter_calls = []

        runtime = configure_fastapi_telemetry(
            FastAPI(),
            environment={
                "OTEL_TRACES_EXPORTER": "otlp",
                "OTEL_EXPORTER_OTLP_ENDPOINT": (
                    "http://collector.example:4318/otel"
                ),
            },
            exporter_factory=lambda **_: exporter_calls.append(True),
        )

        self.assertFalse(runtime.enabled)
        self.assertEqual(exporter_calls, [])

    def test_empty_trace_exporter_list_keeps_endpoint_driven_enablement(self):
        exporter_endpoints = []

        def exporter_factory(*, endpoint=None):
            exporter_endpoints.append(endpoint)
            return CollectingExporter(endpoint=endpoint)

        runtime = configure_fastapi_telemetry(
            FastAPI(),
            environment={
                "OTEL_TRACES_EXPORTER": " , ",
                "OTEL_EXPORTER_OTLP_ENDPOINT": "https://collector.example/otel",
            },
            exporter_factory=exporter_factory,
        )
        self.addCleanup(runtime.shutdown)

        self.assertTrue(runtime.enabled)
        self.assertEqual(
            exporter_endpoints,
            ["https://collector.example/otel/v1/traces"],
        )

    def test_stays_disabled_for_a_non_http_otlp_protocol(self):
        exporter_calls = []

        runtime = configure_fastapi_telemetry(
            FastAPI(),
            environment={
                "OTEL_EXPORTER_OTLP_ENDPOINT": "https://collector.example",
                "OTEL_EXPORTER_OTLP_TRACES_PROTOCOL": "grpc",
            },
            exporter_factory=lambda: exporter_calls.append(True),
        )

        self.assertFalse(runtime.enabled)
        self.assertEqual(exporter_calls, [])

    def test_rejects_plaintext_otlp_for_non_loopback_hosts(self):
        endpoints = (
            "http://collector.example:4318/v1/traces",
            "http://localhost.example:4318/v1/traces",
            "http://localhost.:4318/v1/traces",
            "http://127.0.0.1.example:4318/v1/traces",
            "http://2130706433:4318/v1/traces",
            "http://[::ffff:127.0.0.1]:4318/v1/traces",
        )

        for endpoint in endpoints:
            with self.subTest(endpoint=endpoint):
                exporter_calls = []

                def exporter_factory():
                    exporter_calls.append(True)
                    return CollectingExporter()

                runtime = configure_fastapi_telemetry(
                    FastAPI(),
                    environment={"OTEL_EXPORTER_OTLP_ENDPOINT": endpoint},
                    exporter_factory=exporter_factory,
                )
                self.addCleanup(runtime.shutdown)

                self.assertFalse(runtime.enabled)
                self.assertEqual(exporter_calls, [])

    def test_accepts_plaintext_otlp_only_for_canonical_loopback_hosts(self):
        endpoints = (
            "http://localhost:4318/v1/traces",
            "http://LOCALHOST:4318/v1/traces",
            "http://127.0.0.1:4318/v1/traces",
            "http://127.255.255.254:4318/v1/traces",
            "http://[::1]:4318/v1/traces",
            "https://collector.example/v1/traces",
        )

        for endpoint in endpoints:
            with self.subTest(endpoint=endpoint):
                runtime = configure_fastapi_telemetry(
                    FastAPI(),
                    environment={"OTEL_EXPORTER_OTLP_ENDPOINT": endpoint},
                    exporter_factory=CollectingExporter,
                )
                self.addCleanup(runtime.shutdown)

                self.assertTrue(runtime.enabled)

    def test_trace_specific_endpoint_takes_precedence_without_path_rewrite(self):
        exporter_endpoints = []

        def exporter_factory(*, endpoint=None):
            exporter_endpoints.append(endpoint)
            return CollectingExporter(endpoint=endpoint)

        runtime = configure_fastapi_telemetry(
            FastAPI(),
            environment={
                "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT": (
                    "https://trace.collector.example/custom/traces"
                ),
                "OTEL_EXPORTER_OTLP_ENDPOINT": (
                    "https://generic.collector.example/otel"
                ),
            },
            exporter_factory=exporter_factory,
        )
        self.addCleanup(runtime.shutdown)

        self.assertTrue(runtime.enabled)
        self.assertEqual(
            exporter_endpoints,
            ["https://trace.collector.example/custom/traces"],
        )

    def test_generic_endpoint_preserves_its_path_and_appends_the_trace_path(self):
        endpoint_cases = (
            (
                "https://collector.example",
                "https://collector.example/v1/traces",
            ),
            (
                "https://collector.example/otel",
                "https://collector.example/otel/v1/traces",
            ),
            (
                "https://collector.example/otel/",
                "https://collector.example/otel/v1/traces",
            ),
            (
                "http://127.42.0.5:4318/otel",
                "http://127.42.0.5:4318/otel/v1/traces",
            ),
        )

        for endpoint, expected_trace_endpoint in endpoint_cases:
            with self.subTest(endpoint=endpoint):
                exporter_endpoints = []

                def exporter_factory(*, endpoint=None):
                    exporter_endpoints.append(endpoint)
                    return CollectingExporter(endpoint=endpoint)

                runtime = configure_fastapi_telemetry(
                    FastAPI(),
                    environment={"OTEL_EXPORTER_OTLP_ENDPOINT": endpoint},
                    exporter_factory=exporter_factory,
                )
                self.addCleanup(runtime.shutdown)

                self.assertTrue(runtime.enabled)
                self.assertEqual(exporter_endpoints, [expected_trace_endpoint])

    def test_stays_disabled_for_invalid_or_empty_ports(self):
        invalid_environments = (
            {"OTEL_EXPORTER_OTLP_ENDPOINT": "https://collector.example:0"},
            {"OTEL_EXPORTER_OTLP_ENDPOINT": "https://collector.example:"},
            {"OTEL_EXPORTER_OTLP_ENDPOINT": "https://collector.example:not-a-port"},
            {"OTEL_EXPORTER_OTLP_ENDPOINT": "https://collector.example:65536"},
            {
                "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT": (
                    "https://trace.collector.example:not-a-port/v1/traces"
                ),
                "OTEL_EXPORTER_OTLP_ENDPOINT": "https://collector.example/otel",
            },
        )

        for environment in invalid_environments:
            with self.subTest(environment=environment):
                exporter_endpoints = []

                def exporter_factory(*, endpoint=None):
                    exporter_endpoints.append(endpoint)
                    return CollectingExporter(endpoint=endpoint)

                runtime = configure_fastapi_telemetry(
                    FastAPI(),
                    environment=environment,
                    exporter_factory=exporter_factory,
                )
                self.addCleanup(runtime.shutdown)

                self.assertFalse(runtime.enabled)
                self.assertEqual(exporter_endpoints, [])

    def test_production_exporter_uses_the_endpoint_from_the_validated_mapping(self):
        from opentelemetry.exporter.otlp.proto.http import trace_exporter

        exporter_endpoints = []

        def exporter_constructor(*, endpoint=None):
            exporter_endpoints.append(endpoint)
            return CollectingExporter(endpoint=endpoint)

        process_environment = {
            "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT": (
                "http://unvalidated-remote.example:4318/v1/traces"
            ),
            "OTEL_EXPORTER_OTLP_ENDPOINT": "http://unvalidated-remote.example:4318",
        }
        with patch.dict(os.environ, process_environment, clear=False), patch.object(
            trace_exporter,
            "OTLPSpanExporter",
            exporter_constructor,
        ):
            runtime = configure_fastapi_telemetry(
                FastAPI(),
                environment={
                    "OTEL_EXPORTER_OTLP_ENDPOINT": (
                        "https://validated.collector.example/otel"
                    ),
                },
            )
        self.addCleanup(runtime.shutdown)

        self.assertTrue(runtime.enabled)
        self.assertEqual(
            exporter_endpoints,
            ["https://validated.collector.example/otel/v1/traces"],
        )

    def test_stays_disabled_for_endpoint_credentials_query_or_fragment(self):
        endpoints = (
            "https://user:password@collector.invalid/v1/traces",
            "https://collector.invalid/v1/traces?token=endpoint-secret-canary",
            "https://collector.invalid/v1/traces#endpoint-secret-canary",
        )

        for endpoint in endpoints:
            with self.subTest(endpoint=endpoint):
                exporter_calls = []

                def exporter_factory():
                    exporter_calls.append(True)
                    return CollectingExporter()

                runtime = configure_fastapi_telemetry(
                    FastAPI(),
                    environment={"OTEL_EXPORTER_OTLP_TRACES_ENDPOINT": endpoint},
                    exporter_factory=exporter_factory,
                )
                self.addCleanup(runtime.shutdown)

                self.assertFalse(runtime.enabled)
                self.assertEqual(exporter_calls, [])

    def test_uses_the_incoming_traceparent_as_the_server_span_parent(self):
        app = FastAPI()

        @app.get("/items/{item_id}")
        def read_item(item_id: str):
            return {"itemId": item_id}

        exporter = CollectingExporter()
        runtime = configure_fastapi_telemetry(
            app,
            environment={
                "OTEL_EXPORTER_OTLP_ENDPOINT": "http://127.0.0.1:4318",
                "OTEL_SERVICE_NAME": "studytube-ai-test",
            },
            exporter_factory=lambda **_: exporter,
        )

        with TestClient(app) as client:
            response = client.get(
                "/items/42",
                headers={
                    "traceparent": (
                        "00-0af7651916cd43dd8448eb211c80319c-" "b7ad6b7169203331-01"
                    ),
                    "tracestate": "vendor=tracestate-secret-canary",
                },
            )
        runtime.shutdown()

        self.assertEqual(response.status_code, 200)
        server_spans = [span for span in exporter.spans if span.kind == SpanKind.SERVER]
        self.assertEqual(len(server_spans), 1)
        server_span = server_spans[0]
        self.assertEqual(
            server_span.context.trace_id,
            int("0af7651916cd43dd8448eb211c80319c", 16),
        )
        self.assertIsNotNone(server_span.parent)
        self.assertEqual(
            server_span.parent.span_id,
            int("b7ad6b7169203331", 16),
        )
        self.assertTrue(server_span.parent.is_remote)
        self.assertEqual(list(server_span.context.trace_state.items()), [])
        self.assertEqual(list(server_span.parent.trace_state.items()), [])

    def test_exports_no_query_header_cookie_or_session_secrets(self):
        app = FastAPI()

        @app.get("/privacy")
        def privacy_probe(request: Request):
            return {"queryStillReachedApplication": request.url.query}

        exporter = CollectingExporter()
        runtime = configure_fastapi_telemetry(
            app,
            environment={
                "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT": (
                    "http://127.0.0.1:4318/v1/traces"
                ),
            },
            exporter_factory=lambda **_: exporter,
        )

        with TestClient(app) as client:
            response = client.get(
                "/privacy?access_token=query-secret-canary",
                headers={
                    "authorization": "Bearer header-secret-canary",
                    "cookie": "session_id=cookie-secret-canary",
                    "user-agent": "user-agent-secret-canary",
                    "x-session-token": "session-secret-canary",
                },
            )
        runtime.shutdown()

        self.assertEqual(
            response.json(),
            {"queryStillReachedApplication": "access_token=query-secret-canary"},
        )
        server_span = next(
            span for span in exporter.spans if span.kind == SpanKind.SERVER
        )
        exported = json.dumps(
            {
                "attributes": dict(server_span.attributes),
                "events": [
                    {
                        "name": event.name,
                        "attributes": dict(event.attributes or {}),
                    }
                    for event in server_span.events
                ],
            },
            default=str,
            sort_keys=True,
        )
        for secret in (
            "query-secret-canary",
            "header-secret-canary",
            "cookie-secret-canary",
            "user-agent-secret-canary",
            "session-secret-canary",
        ):
            self.assertNotIn(secret, exported)
        self.assertNotIn("url.query", server_span.attributes)

    def test_shutdown_releases_the_exporter_once(self):
        class CountingProvider:
            def __init__(self) -> None:
                self.shutdown_calls = 0

            def shutdown(self) -> None:
                self.shutdown_calls += 1

        provider = CountingProvider()
        runtime = FastApiTelemetryRuntime(
            enabled=True,
            provider=provider,
        )

        runtime.shutdown()
        runtime.shutdown()

        self.assertEqual(provider.shutdown_calls, 1)

    def test_shutdown_uninstruments_once_when_provider_shutdown_fails(self):
        class FailingProvider:
            def __init__(self) -> None:
                self.shutdown_calls = 0

            def shutdown(self) -> None:
                self.shutdown_calls += 1
                raise RuntimeError("provider-secret-canary")

        class CountingInstrumentor:
            def __init__(self) -> None:
                self.uninstrument_calls = 0

            def uninstrument_app(self, app) -> None:
                self.uninstrument_calls += 1

        provider = FailingProvider()
        instrumentor = CountingInstrumentor()
        runtime = FastApiTelemetryRuntime(
            enabled=True,
            app=object(),
            provider=provider,
            instrumentor=instrumentor,
        )
        output = StringIO()
        shutdown_raised = False

        with redirect_stdout(output), redirect_stderr(output):
            try:
                runtime.shutdown()
            except RuntimeError:
                shutdown_raised = True
            runtime.shutdown()

        self.assertFalse(shutdown_raised)
        self.assertEqual(provider.shutdown_calls, 1)
        self.assertEqual(instrumentor.uninstrument_calls, 1)
        self.assertNotIn("provider-secret-canary", output.getvalue())

    def test_shutdown_swallows_uninstrumentation_failure_once(self):
        class CountingProvider:
            def __init__(self) -> None:
                self.shutdown_calls = 0

            def shutdown(self) -> None:
                self.shutdown_calls += 1

        class FailingInstrumentor:
            def __init__(self) -> None:
                self.uninstrument_calls = 0

            def uninstrument_app(self, app) -> None:
                self.uninstrument_calls += 1
                raise RuntimeError("uninstrument-secret-canary")

        provider = CountingProvider()
        instrumentor = FailingInstrumentor()
        runtime = FastApiTelemetryRuntime(
            enabled=True,
            app=object(),
            provider=provider,
            instrumentor=instrumentor,
        )
        output = StringIO()
        shutdown_raised = False

        with redirect_stdout(output), redirect_stderr(output):
            try:
                runtime.shutdown()
            except RuntimeError:
                shutdown_raised = True
            runtime.shutdown()

        self.assertFalse(shutdown_raised)
        self.assertEqual(provider.shutdown_calls, 1)
        self.assertEqual(instrumentor.uninstrument_calls, 1)
        self.assertNotIn("uninstrument-secret-canary", output.getvalue())

    def test_exports_exception_type_without_exception_secret_text(self):
        app = FastAPI()

        @app.get("/failure")
        def failure_probe():
            raise RuntimeError("session-secret-canary")

        exporter = CollectingExporter()
        runtime = configure_fastapi_telemetry(
            app,
            environment={
                "OTEL_EXPORTER_OTLP_ENDPOINT": "http://127.0.0.1:4318",
            },
            exporter_factory=lambda **_: exporter,
        )

        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.get("/failure")
        runtime.shutdown()

        self.assertEqual(response.status_code, 500)
        server_span = next(
            span for span in exporter.spans if span.kind == SpanKind.SERVER
        )
        exported_events = json.dumps(
            [
                {
                    "name": event.name,
                    "attributes": dict(event.attributes or {}),
                }
                for event in server_span.events
            ],
            default=str,
            sort_keys=True,
        )
        self.assertNotIn("session-secret-canary", exported_events)
        self.assertIn("RuntimeError", exported_events)


if __name__ == "__main__":
    unittest.main()
