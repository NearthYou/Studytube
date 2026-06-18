from fastapi import APIRouter, Query

from app.schemas.mcp import CacheRefreshResponse, SeatLayoutResponse
from app.services.seat_metadata_service import get_seat_layout, refresh_cache

router = APIRouter(prefix="/mcp", tags=["mcp"])


@router.get("/seat-layouts/{theater_name}", response_model=SeatLayoutResponse)
def seat_layout(
    theater_name: str,
    simulate_failure: bool = Query(default=False, alias="simulateFailure"),
):
    return get_seat_layout(theater_name, simulate_failure=simulate_failure)


@router.post("/cache/refresh", response_model=CacheRefreshResponse)
def refresh_mcp_cache():
    return CacheRefreshResponse(refreshed=True, clearedKeys=refresh_cache())
