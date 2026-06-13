from __future__ import annotations

import json
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator

from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client


WORKSPACE_ROOT = Path(__file__).resolve().parents[3]
MCP_SERVER_PATH = WORKSPACE_ROOT / "mcp-server" / "server.py"


class TravelMCPClient:
    def __init__(self) -> None:
        self._stdio_context = None
        self._session_context = None
        self._session: ClientSession | None = None

    async def __aenter__(self) -> "TravelMCPClient":
        env = {
            "PYTHONIOENCODING": "utf-8",
            "BACK_API_BASE_URL": os.getenv("BACK_API_BASE_URL", "http://127.0.0.1:3000/api"),
        }
        server_params = StdioServerParameters(
            command=sys.executable,
            args=[str(MCP_SERVER_PATH)],
            env=env,
            cwd=str(WORKSPACE_ROOT),
        )

        self._stdio_context = stdio_client(server_params)
        read_stream, write_stream = await self._stdio_context.__aenter__()
        self._session_context = ClientSession(read_stream, write_stream)
        self._session = await self._session_context.__aenter__()
        await self._session.initialize()
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        if self._session_context is not None:
            await self._session_context.__aexit__(exc_type, exc, tb)
        if self._stdio_context is not None:
            await self._stdio_context.__aexit__(exc_type, exc, tb)

    async def call_tool(self, name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
        if self._session is None:
            raise RuntimeError("MCP session is not initialized.")

        result = await self._session.call_tool(name, arguments=arguments or {})

        if result.structuredContent is not None:
            return result.structuredContent

        text_parts: list[str] = []
        for entry in result.content:
            if getattr(entry, "type", None) == "text":
                text_parts.append(entry.text)

        raw_text = "\n".join(text_parts).strip()
        if not raw_text:
            return {}

        try:
            parsed = json.loads(raw_text)
        except json.JSONDecodeError:
            return {"text": raw_text}

        if isinstance(parsed, dict):
            return parsed

        return {"items": parsed}

    async def list_tools(self) -> list[str]:
        if self._session is None:
            raise RuntimeError("MCP session is not initialized.")

        result = await self._session.list_tools()
        return [tool.name for tool in result.tools]


@asynccontextmanager
async def travel_mcp_client() -> AsyncIterator[TravelMCPClient]:
    async with TravelMCPClient() as client:
        yield client
