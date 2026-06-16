from __future__ import annotations

from typing import Any

import httpx

from config import BACK_API_BASE_URL


class BackApiClient:
    def __init__(self, base_url: str = BACK_API_BASE_URL) -> None:
        self.base_url = base_url.rstrip("/")

    async def get_json(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            data = response.json()
        if isinstance(data, dict):
            return data
        return {"items": data}
