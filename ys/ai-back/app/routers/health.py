from fastapi import APIRouter

from app.mcp.client import travel_mcp_client

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/health/mcp")
async def mcp_health_check() -> dict[str, object]:
    async with travel_mcp_client() as client:
        tools = await client.list_tools()

    return {
        "status": "ok",
        "tools": tools,
    }
