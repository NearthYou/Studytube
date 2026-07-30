from __future__ import annotations

import os
from collections.abc import Callable, Mapping
from ipaddress import IPv6Address, ip_address
from threading import Lock
from typing import Any
from urllib.parse import urlsplit, urlunsplit

_SENSITIVE_ATTRIBUTE_PARTS = frozenset(
    {
        "apikey",
        "authorization",
        "cookie",
        "cookies",
        "password",
        "passwd",
        "secret",
        "session",
        "token",
    }
)
_DEFAULT_OTLP_TRACE_ENDPOINT = "http://localhost:4318/v1/traces"


class SanitizingSpanExporter:
    def __init__(self, delegate: Any) -> None:
        self._delegate = delegate

    def export(self, spans: Any) -> Any:
        return self._delegate.export(tuple(_sanitize_span(span) for span in spans))

    def shutdown(self) -> None:
        self._delegate.shutdown()

    def force_flush(self, timeout_millis: int = 30000) -> bool:
        force_flush = getattr(self._delegate, "force_flush", None)
        if force_flush is None:
            return True
        return bool(force_flush(timeout_millis))


def _sanitize_span(span: Any) -> Any:
    from opentelemetry.sdk.trace import Event, ReadableSpan
    from opentelemetry.trace import Link, Status

    events = tuple(
        Event(
            name=event.name,
            attributes=_sanitize_attributes(event.attributes),
            timestamp=event.timestamp,
        )
        for event in span.events
    )
    links = tuple(
        Link(
            context=_sanitize_span_context(link.context),
            attributes=_sanitize_attributes(link.attributes),
        )
        for link in span.links
    )
    status = span.status
    if status is not None and status.description:
        status = Status(status.status_code)
    return ReadableSpan(
        name=span.name,
        context=_sanitize_span_context(span.context),
        parent=_sanitize_span_context(span.parent),
        resource=span.resource,
        attributes=_sanitize_attributes(span.attributes),
        events=events,
        links=links,
        kind=span.kind,
        status=status,
        start_time=span.start_time,
        end_time=span.end_time,
        instrumentation_scope=span.instrumentation_scope,
    )


def _sanitize_span_context(context: Any) -> Any:
    if context is None:
        return None
    from opentelemetry.trace import SpanContext, TraceState

    return SpanContext(
        trace_id=context.trace_id,
        span_id=context.span_id,
        is_remote=context.is_remote,
        trace_flags=context.trace_flags,
        trace_state=TraceState(),
    )


def _sanitize_attributes(attributes: Any) -> dict[str, Any]:
    sanitized: dict[str, Any] = {}
    for raw_key, raw_value in dict(attributes or {}).items():
        key = str(raw_key)
        normalized = key.casefold().replace("-", "_")
        if normalized in {"exception.message", "exception.stacktrace"}:
            continue
        parts = set(normalized.replace(".", "_").split("_"))
        if "query" in parts or parts.intersection(_SENSITIVE_ATTRIBUTE_PARTS):
            continue
        if normalized.startswith(("http.request.header.", "http.response.header.")):
            continue
        if "user_agent" in normalized:
            continue
        if isinstance(raw_value, str) and (
            "url" in parts or normalized in {"http.target", "http.route"}
        ):
            raw_value = _strip_query_and_fragment(raw_value)
        sanitized[key] = raw_value
    return sanitized


def _strip_query_and_fragment(value: str) -> str:
    query_index = value.find("?")
    fragment_index = value.find("#")
    indexes = [index for index in (query_index, fragment_index) if index >= 0]
    return value[: min(indexes)] if indexes else value


def _is_safe_otlp_endpoint(endpoint: str) -> bool:
    try:
        parsed = urlsplit(endpoint)
        hostname = parsed.hostname
        port = parsed.port
    except ValueError:
        return False
    scheme = parsed.scheme.casefold()
    if not (
        scheme in {"http", "https"}
        and hostname
        and parsed.username is None
        and parsed.password is None
        and not parsed.query
        and not parsed.fragment
    ):
        return False
    if port == 0 or parsed.netloc.endswith(":"):
        return False
    if scheme == "https":
        return True
    if hostname.casefold() == "localhost":
        return True
    try:
        address = ip_address(hostname)
    except ValueError:
        return False
    if address.version == 4:
        return address.is_loopback
    return address == IPv6Address("::1")


def _resolve_otlp_trace_endpoint(
    environment: Mapping[str, str],
    *,
    default_endpoint: str | None = None,
) -> str | None:
    trace_endpoint = environment.get("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "").strip()
    if trace_endpoint:
        return trace_endpoint if _is_safe_otlp_endpoint(trace_endpoint) else None
    generic_endpoint = environment.get("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip()
    if not generic_endpoint:
        return default_endpoint
    if not _is_safe_otlp_endpoint(generic_endpoint):
        return None
    parsed = urlsplit(generic_endpoint)
    base_path = parsed.path.rstrip("/")
    trace_path = f"{base_path}/v1/traces" if base_path else "/v1/traces"
    return urlunsplit(parsed._replace(path=trace_path))


class FastApiTelemetryRuntime:
    def __init__(
        self,
        *,
        enabled: bool,
        app: Any = None,
        provider: Any = None,
        instrumentor: Any = None,
    ) -> None:
        self.enabled = enabled
        self._app = app
        self._provider = provider
        self._instrumentor = instrumentor
        self._shutdown_lock = Lock()
        self._is_shutdown = False

    def shutdown(self) -> None:
        with self._shutdown_lock:
            if self._is_shutdown:
                return
            self._is_shutdown = True
        try:
            if self._provider is not None:
                self._provider.shutdown()
        except Exception:
            pass
        try:
            if self._instrumentor is not None and self._app is not None:
                self._instrumentor.uninstrument_app(self._app)
        except Exception:
            pass


def configure_fastapi_telemetry(
    app: Any,
    *,
    environment: Mapping[str, str] = os.environ,
    exporter_factory: Callable[..., Any] | None = None,
) -> FastApiTelemetryRuntime:
    if environment.get("OTEL_SDK_DISABLED", "").strip().casefold() in {
        "1",
        "on",
        "true",
        "yes",
    }:
        return FastApiTelemetryRuntime(enabled=False)
    trace_exporters = [
        exporter.strip().casefold()
        for exporter in environment.get("OTEL_TRACES_EXPORTER", "").split(",")
        if exporter.strip()
    ]
    if "none" in trace_exporters:
        return FastApiTelemetryRuntime(enabled=False)
    if trace_exporters and "otlp" not in trace_exporters:
        return FastApiTelemetryRuntime(enabled=False)
    protocol = (
        environment.get("OTEL_EXPORTER_OTLP_TRACES_PROTOCOL", "").strip()
        or environment.get("OTEL_EXPORTER_OTLP_PROTOCOL", "").strip()
    ).casefold()
    if protocol not in {"", "http/protobuf"}:
        return FastApiTelemetryRuntime(enabled=False)
    endpoint = _resolve_otlp_trace_endpoint(
        environment,
        default_endpoint=(
            _DEFAULT_OTLP_TRACE_ENDPOINT if "otlp" in trace_exporters else None
        ),
    )
    if endpoint is None:
        return FastApiTelemetryRuntime(enabled=False)

    from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
        OTLPSpanExporter,
    )
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    exporter_builder = exporter_factory or OTLPSpanExporter
    exporter = exporter_builder(endpoint=endpoint)
    service_name = environment.get("OTEL_SERVICE_NAME", "").strip() or "studytube-ai"
    provider = TracerProvider(
        resource=Resource({"service.name": service_name}),
        shutdown_on_exit=False,
    )
    provider.add_span_processor(BatchSpanProcessor(SanitizingSpanExporter(exporter)))
    FastAPIInstrumentor.instrument_app(
        app,
        tracer_provider=provider,
        http_capture_headers_server_request=[r"(?!)"],
        http_capture_headers_server_response=[r"(?!)"],
        http_capture_headers_sanitize_fields=[r".*"],
        exclude_spans=["receive", "send"],
    )
    return FastApiTelemetryRuntime(
        enabled=True,
        app=app,
        provider=provider,
        instrumentor=FastAPIInstrumentor,
    )
