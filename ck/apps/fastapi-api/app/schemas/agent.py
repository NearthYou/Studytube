from typing import Literal

from pydantic import BaseModel, Field

Priority = Literal[
    "view",
    "sound",
    "comfort",
    "expression",
    "stageVisibility",
    "lowObstruction",
]


class SeatRecommendationRequest(BaseModel):
    question: str = Field(min_length=2)
    theater_name: str | None = Field(default=None, alias="theaterName")
    musical_title: str | None = Field(default=None, alias="musicalTitle")
    season_label: str | None = Field(default=None, alias="seasonLabel")
    priorities: list[Priority] = Field(default_factory=list)
    budget: int | None = None
    limit: int = Field(default=5, ge=1, le=10)
    use_rag: bool = Field(default=True, alias="useRag")

    model_config = {"populate_by_name": True}


class AgentFilters(BaseModel):
    theater_name: str | None = Field(default=None, alias="theaterName")
    musical_title: str | None = Field(default=None, alias="musicalTitle")
    season_label: str | None = Field(default=None, alias="seasonLabel")
    seat_floor: str | None = Field(default=None, alias="seatFloor")
    seat_section: str | None = Field(default=None, alias="seatSection")
    seat_row: str | None = Field(default=None, alias="seatRow")
    seat_number: str | None = Field(default=None, alias="seatNumber")
    side: Literal["left", "center", "right"] | None = None
    priorities: list[Priority]
    budget: int | None = None

    model_config = {"populate_by_name": True}


class EvidenceReview(BaseModel):
    id: str
    theater_name: str = Field(alias="theaterName")
    musical_title: str = Field(alias="musicalTitle")
    season_label: str | None = Field(default=None, alias="seasonLabel")
    seat: str
    ratings: dict[str, int]
    tags: list[str]
    content: str

    model_config = {"populate_by_name": True}


class SeatRecommendationResponse(BaseModel):
    recommendation: str
    official_section: str | None = Field(default=None, alias="officialSection")
    descriptive_block: str | None = Field(default=None, alias="descriptiveBlock")
    direction: str
    reasons: list[str]
    cautions: list[str]
    evidence_reviews: list[EvidenceReview] = Field(alias="evidenceReviews")
    filters: AgentFilters
    mcp_status: str = Field(alias="mcpStatus")
    rag_status: str = Field(alias="ragStatus")
    rag_answer: str | None = Field(default=None, alias="ragAnswer")

    model_config = {"populate_by_name": True}
