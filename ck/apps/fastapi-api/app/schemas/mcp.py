from pydantic import BaseModel, Field


class SeatOption(BaseModel):
    value: str
    label: str


class SeatLayoutMetadata(BaseModel):
    external_scope: list[str] = Field(alias="externalScope")
    mapping_rules: list[str] = Field(alias="mappingRules")
    cache_ttl_seconds: int = Field(alias="cacheTtlSeconds")

    model_config = {"populate_by_name": True}


class SeatLayoutResponse(BaseModel):
    theater_name: str = Field(alias="theaterName")
    canonical_theater_name: str = Field(alias="canonicalTheaterName")
    source: str
    status: str
    cached: bool
    is_fallback: bool = Field(alias="isFallback")
    updated_at: str = Field(alias="updatedAt")
    floors: list[SeatOption]
    sections_by_floor: dict[str, list[SeatOption]] = Field(alias="sectionsByFloor")
    ai_blocks_by_floor: dict[str, list[SeatOption]] = Field(alias="aiBlocksByFloor")
    seat_map_url: str | None = Field(default=None, alias="seatMapUrl")
    metadata: SeatLayoutMetadata

    model_config = {"populate_by_name": True}


class CacheRefreshResponse(BaseModel):
    refreshed: bool
    cleared_keys: int = Field(alias="clearedKeys")

    model_config = {"populate_by_name": True}
