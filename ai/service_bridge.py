from __future__ import annotations

from dataclasses import dataclass
import os
from typing import Any

import study_generation


@dataclass(frozen=True)
class ServiceBridgeRuntime:
    namespace: Any


_runtime: ServiceBridgeRuntime | None = None


def configure_service_bridge(runtime: ServiceBridgeRuntime) -> None:
    global _runtime
    _runtime = runtime


def service_bridge_runtime() -> ServiceBridgeRuntime:
    if _runtime is None:
        raise RuntimeError("Service bridge runtime is not configured")
    return _runtime


def youtube_caption_runtime_health() -> dict[str, bool]:
    namespace = service_bridge_runtime().namespace
    return {
        "ytDlpAvailable": bool(namespace.yt_dlp_commands()),
        "poTokenConfigured": namespace.explicit_youtube_subtitle_po_token()
        is not None,
        "autoPoTokenEnabled": namespace.truthy_env_default(
            "YOUTUBE_AUTO_SUBTITLE_PO_TOKEN", True
        ),
        "bgutilConfigured": bool(namespace.youtube_bgutil_server_home()),
        "proxyConfigured": bool(os.getenv("YOUTUBE_PROXY_URL", "").strip()),
        "cookiesConfigured": bool(
            os.getenv("YOUTUBE_COOKIES_FILE", "").strip()
            or os.getenv("YOUTUBE_COOKIES_FROM_BROWSER", "").strip()
        ),
    }


def handle_mcp_request(payload: dict[str, Any]) -> dict[str, Any]:
    namespace = service_bridge_runtime().namespace
    request_id = payload.get("id")
    method = payload.get("method")
    params = payload.get("params") or {}
    if payload.get("jsonrpc") != "2.0":
        return json_rpc_error(request_id, -32600, "Invalid JSON-RPC version")
    if method == "youtube.lookup":
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": namespace.lookup_youtube(params),
        }
    return json_rpc_error(request_id, -32601, f"Unknown MCP method: {method}")


def build_study_plan(payload: dict[str, Any]) -> dict[str, Any]:
    namespace = service_bridge_runtime().namespace
    return study_generation.build_study_plan(payload, namespace.lookup_youtube)


def json_rpc_error(request_id: Any, code: int, message: str) -> dict[str, Any]:
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "error": {"code": code, "message": message},
    }
