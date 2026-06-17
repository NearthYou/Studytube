from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import time

from app.schemas.mcp import SeatLayoutMetadata, SeatLayoutResponse, SeatOption


MCP_CACHE_TTL_SECONDS = 600
EXTERNAL_SCOPE = [
    "극장 기본 정보",
    "층 / 공식 구역 정보",
    "AI 설명용 블록",
    "좌석 배치도 링크",
]
MAPPING_RULES = [
    "내부 theaters.name을 기준으로 외부 극장명을 정규화한다.",
    "공식 구역은 seatSection 후보로만 제공한다.",
    "왼쪽/중앙/오른쪽 블록은 AI 설명용이며 리뷰 저장값으로 강제하지 않는다.",
    "외부 조회가 실패하면 내부 작성 흐름을 막지 않고 fallback 레이아웃을 반환한다.",
]


@dataclass(frozen=True)
class SeatLayoutDefinition:
    canonical_name: str
    aliases: tuple[str, ...]
    floors: tuple[str, ...]
    sections_by_floor: dict[str, tuple[str, ...]]
    seat_map_url: str | None = None


def _sections(*values: str) -> tuple[str, ...]:
    return values


SEAT_LAYOUTS: tuple[SeatLayoutDefinition, ...] = (
    SeatLayoutDefinition(
        canonical_name="세종문화회관 대극장",
        aliases=("세종문화회관", "세종문화회관 대극장", "세종 대극장"),
        floors=("1층", "2층", "3층"),
        sections_by_floor={
            "1층": _sections("A", "B", "C", "D", "E"),
            "2층": _sections("A", "B", "C", "D", "E", "F", "G"),
            "3층": _sections("A", "B", "C", "D", "E", "F", "G", "H"),
        },
        seat_map_url="https://www.sejongpac.or.kr/portal/main/contents.do?menuNo=200195",
    ),
    SeatLayoutDefinition(
        canonical_name="세종문화회관 M씨어터",
        aliases=("세종문화회관 M씨어터", "세종 M씨어터"),
        floors=("1층", "2층"),
        sections_by_floor={
            "1층": _sections("A", "B", "C"),
            "2층": _sections("A", "B", "C"),
        },
        seat_map_url="https://www.sejongpac.or.kr/portal/main/contents.do?menuNo=200195",
    ),
    SeatLayoutDefinition(
        canonical_name="세종문화회관 S씨어터",
        aliases=("세종문화회관 S씨어터", "세종 S씨어터"),
        floors=("1층",),
        sections_by_floor={"1층": _sections("A", "B", "C")},
        seat_map_url="https://www.sejongpac.or.kr/portal/main/contents.do?menuNo=200195",
    ),
    SeatLayoutDefinition(
        canonical_name="블루스퀘어 신한카드홀",
        aliases=("블루스퀘어", "블루스퀘어 신한카드홀", "신한카드홀"),
        floors=("1층", "2층", "3층"),
        sections_by_floor={
            "1층": _sections("A", "B", "C"),
            "2층": _sections("A", "B", "C"),
            "3층": _sections("A", "B", "C"),
        },
        seat_map_url="https://www.bluesquare.kr",
    ),
    SeatLayoutDefinition(
        canonical_name="TOM 1관",
        aliases=("TOM", "TOM 1관", "티오엠", "티오엠 1관"),
        floors=("1층", "2층"),
        sections_by_floor={
            "1층": _sections("A", "B", "C", "D"),
            "2층": _sections("A", "B", "C"),
        },
        seat_map_url="https://www.towntom.com",
    ),
    SeatLayoutDefinition(
        canonical_name="TOM 2관",
        aliases=("TOM 2관", "티오엠 2관"),
        floors=("1층", "2층"),
        sections_by_floor={
            "1층": _sections("A", "B", "C"),
            "2층": _sections("A", "B", "C"),
        },
        seat_map_url="https://www.towntom.com",
    ),
)

FALLBACK_LAYOUT = SeatLayoutDefinition(
    canonical_name="기본 좌석 메타데이터",
    aliases=("fallback",),
    floors=("1층", "2층", "3층"),
    sections_by_floor={
        "1층": tuple(),
        "2층": tuple(),
        "3층": tuple(),
    },
)


class SeatMetadataCache:
    def __init__(self) -> None:
        self._items: dict[str, tuple[float, SeatLayoutResponse]] = {}

    def get(self, key: str) -> SeatLayoutResponse | None:
        cached = self._items.get(key)
        if cached is None:
            return None

        expires_at, value = cached
        if expires_at < time.time():
            self._items.pop(key, None)
            return None

        return value.model_copy(update={"cached": True})

    def set(self, key: str, value: SeatLayoutResponse) -> SeatLayoutResponse:
        self._items[key] = (time.time() + MCP_CACHE_TTL_SECONDS, value)
        return value

    def clear(self) -> int:
        cleared = len(self._items)
        self._items.clear()
        return cleared


cache = SeatMetadataCache()


def list_supported_theaters() -> list[str]:
    return [layout.canonical_name for layout in SEAT_LAYOUTS]


def get_seat_layout(theater_name: str, simulate_failure: bool = False) -> SeatLayoutResponse:
    normalized_name = _normalize(theater_name)
    cache_key = f"{normalized_name}:failure={simulate_failure}"
    cached = cache.get(cache_key)
    if cached:
        return cached

    try:
        if simulate_failure:
            raise RuntimeError("simulated external metadata failure")

        layout = _find_layout(theater_name)
        response = _to_response(
            requested_name=theater_name,
            layout=layout,
            status="ok",
            source="local-mcp-seat-metadata",
            is_fallback=False,
        )
    except Exception:
        response = _to_response(
            requested_name=theater_name,
            layout=FALLBACK_LAYOUT,
            status="fallback",
            source="fallback-seat-metadata",
            is_fallback=True,
        )

    return cache.set(cache_key, response)


def refresh_cache() -> int:
    return cache.clear()


def _find_layout(theater_name: str) -> SeatLayoutDefinition:
    normalized_name = _normalize(theater_name)

    for layout in SEAT_LAYOUTS:
        if normalized_name == _normalize(layout.canonical_name):
            return layout

        if any(normalized_name in _normalize(alias) or _normalize(alias) in normalized_name for alias in layout.aliases):
            return layout

    raise KeyError(theater_name)


def _to_response(
    requested_name: str,
    layout: SeatLayoutDefinition,
    status: str,
    source: str,
    is_fallback: bool,
) -> SeatLayoutResponse:
    floors = [_option(floor, floor) for floor in layout.floors]
    sections_by_floor = {
        floor: [_option(section, f"{section}구역") for section in layout.sections_by_floor.get(floor, tuple())]
        for floor in layout.floors
    }
    ai_blocks_by_floor = {floor: _ai_blocks() for floor in layout.floors}

    return SeatLayoutResponse(
        theaterName=requested_name,
        canonicalTheaterName=layout.canonical_name,
        source=source,
        status=status,
        cached=False,
        isFallback=is_fallback,
        updatedAt=datetime.now(timezone.utc).isoformat(),
        floors=floors,
        sectionsByFloor=sections_by_floor,
        aiBlocksByFloor=ai_blocks_by_floor,
        seatMapUrl=layout.seat_map_url,
        metadata=SeatLayoutMetadata(
            externalScope=EXTERNAL_SCOPE,
            mappingRules=MAPPING_RULES,
            cacheTtlSeconds=MCP_CACHE_TTL_SECONDS,
        ),
    )


def _ai_blocks() -> list[SeatOption]:
    return [
        _option("left", "왼쪽블록"),
        _option("center", "중앙블록"),
        _option("right", "오른쪽블록"),
    ]


def _option(value: str, label: str) -> SeatOption:
    return SeatOption(value=value, label=label)


def _normalize(value: str) -> str:
    return "".join(value.lower().split())
