from __future__ import annotations

import hmac
import logging
import sys
from pathlib import Path

from fastapi import APIRouter, Header, HTTPException


WORKSPACE_ROOT = Path(__file__).resolve().parents[3]
MCP_SERVER_ROOT = WORKSPACE_ROOT / "mcp-server"
if str(MCP_SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(MCP_SERVER_ROOT))

from services.rag_sync_service import sync_post_documents
from app.settings import INTERNAL_API_TOKEN


router = APIRouter(prefix="/rag", tags=["rag"])
logger = logging.getLogger(__name__)


@router.post("/sync/post/{post_id}")
async def sync_post_rag(
    post_id: int,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, int]:
    if INTERNAL_API_TOKEN and not hmac.compare_digest(
        x_internal_token or "",
        INTERNAL_API_TOKEN,
    ):
        raise HTTPException(status_code=403, detail="Forbidden.")

    try:
        return await sync_post_documents(post_id)
    except Exception as exc:
        logger.exception("RAG sync failed for post_id=%s", post_id)
        raise HTTPException(status_code=500, detail="RAG sync failed.") from exc
