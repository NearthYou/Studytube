from __future__ import annotations

import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException


WORKSPACE_ROOT = Path(__file__).resolve().parents[3]
MCP_SERVER_ROOT = WORKSPACE_ROOT / "mcp-server"
if str(MCP_SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(MCP_SERVER_ROOT))

from services.rag_sync_service import sync_post_documents


router = APIRouter(prefix="/rag", tags=["rag"])


@router.post("/sync/post/{post_id}")
async def sync_post_rag(post_id: int) -> dict[str, int]:
    try:
        return await sync_post_documents(post_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
