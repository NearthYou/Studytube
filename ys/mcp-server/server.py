from __future__ import annotations

from mcp.server.fastmcp import FastMCP

from tools.get_post_comments import get_post_comments as _get_post_comments
from tools.get_post_detail import get_post_detail as _get_post_detail
from tools.get_weather import get_weather as _get_weather
from tools.search_posts import search_posts as _search_posts

mcp = FastMCP("Tripy Travel MCP Server")


@mcp.tool()
async def search_posts(
    query: str,
    region: str = "",
    budget: str = "",
    theme: str = "",
    season: str = "",
    companion: str = "",
    limit: int = 5,
):
    return await _search_posts(
        query=query,
        region=region,
        budget=budget,
        theme=theme,
        season=season,
        companion=companion,
        limit=limit,
    )


@mcp.tool()
async def get_post_detail(post_id: int):
    return await _get_post_detail(post_id=post_id)


@mcp.tool()
async def get_post_comments(post_id: int):
    return await _get_post_comments(post_id=post_id)


@mcp.tool()
async def get_weather(region: str = "", travel_date: str = ""):
    return await _get_weather(region=region, travel_date=travel_date)


if __name__ == "__main__":
    mcp.run()
