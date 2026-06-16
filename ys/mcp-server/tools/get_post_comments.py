from __future__ import annotations

from typing import Any

from clients.back_api_client import BackApiClient


async def get_post_comments(post_id: int) -> dict[str, Any]:
    client = BackApiClient()
    response = await client.get_json(f"/posts/{post_id}/comments")
    return response
